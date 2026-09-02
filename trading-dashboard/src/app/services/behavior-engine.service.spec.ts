import { TestBed } from '@angular/core/testing';
import { SupabaseService } from './supabase.service';
import { BehaviorEngineService } from './behavior-engine.service';

type FetchResponse = { ok: boolean; status: number; json: () => Promise<any> };
const API_MARKER = '/api/behavior-engine';

function dashboardFor(accountId: string, tradeCount: number, ai_status = 'not_requested') {
  return {
    account_id: accountId,
    generated_at: new Date().toISOString(),
    engine_status: 'learning',
    ai_status,
    data_summary: {
      trade_count: tradeCount, closed_trades: tradeCount, winning_trades: 1,
      losing_trades: 1, reflection_count: 0, first_trade_at: null,
      last_trade_at: null, behavior_count: 1, evidence_count: 2,
      analysis_count_done: 0, analysis_count_total: 0, last_analysis_at: null,
      last_analysis_status: null, last_analysis_error: null,
    },
    score: { available: true, value: 0, tier: 'neutral' },
    behaviors: [{ id: `${accountId}-beh`, account_id: accountId, name_key: 'loss_streaks', name: 'Losing streaks', behavior_type: 'negative', status: 'DETECTED', occurrence_count: 1, confidence: 0.7, estimated_impact_pnl: -100, estimated_impact_r: -1, first_detected_at: null, last_detected_at: null, created_at: null, updated_at: null }],
    week: {}, patterns: [], brief: null,
  };
}

function parseRequest(url: string): { path: string; accountId: string } {
  const qidx = url.indexOf('?');
  const baseUrl = qidx >= 0 ? url.slice(0, qidx) : url;
  const params = new URLSearchParams(qidx >= 0 ? url.slice(qidx + 1) : '');
  const mi = baseUrl.indexOf(API_MARKER);
  const path = mi >= 0 ? baseUrl.slice(mi + API_MARKER.length) : '';
  return { path, accountId: params.get('accountId') || 'unknown' };
}

function makeRealtimeChannel(name: string, r: { ch: any[]; f: any[]; rm: any[] }) {
  const chan: any = {
    _name: name,
    filters: [] as any[],
    on(_e: string, opts: any) { r.f.push(opts?.filter); chan.filters.push(opts); return chan; },
    subscribe() { r.ch.push(chan); chan._on = true; return chan; },
    unsubscribe() { return chan; },
  };
  return chan;
}

function makeFakeSupabaseClient(r: { ch: any[]; f: any[]; rm: any[] }) {
  const sess = Promise.resolve({ data: { session: { access_token: 'tok' } }, error: null });
  return {
    auth: { getSession: () => sess },
    channel: (name: string) => makeRealtimeChannel(name, r),
    removeChannel: (ch: any) => { r.rm.push(ch); return Promise.resolve(); },
    from: () => ({ select: () => ({}) }),
  };
}

function defResp(acct: string, path: string, ai?: string): any {
  const tc = acct === 'acct-a' ? 24 : 12;
  if (path === '/dashboard') return dashboardFor(acct, tc, ai);
  if (path === '/behaviors') return [];
  if (path === '/rules') return [];
  if (path === '/alerts') return [];
  if (path === '/brief') return null;
  return {};
}

describe('BehaviorEngineService — account-switch isolation', () => {
  let service: BehaviorEngineService;
  let r: { ch: any[]; f: any[]; rm: any[] };
  let fetchSpy: jasmine.Spy;
  let supabaseClient: any;
  const mockSupabase = { get client() { return supabaseClient; } } as unknown as SupabaseService;

  beforeEach(() => {
    r = { ch: [], f: [], rm: [] };
    supabaseClient = makeFakeSupabaseClient(r);
    fetchSpy = jasmine.createSpy('fetch').and.callFake((_i: any, _n?: any) => {
      const url: string = typeof _i === 'string' ? _i : ((_i as any)?.url || '');
      const { path, accountId } = parseRequest(url);
      const body = defResp(accountId, path);
      const res: FetchResponse = { ok: true, status: 200, json: async () => body };
      return Promise.resolve(res);
    });
    spyOn(window, 'fetch').and.callFake((_u: any, _i?: any) => fetchSpy(_u, _i) as any);
    TestBed.configureTestingModule({ providers: [{ provide: SupabaseService, useValue: mockSupabase }] });
    service = TestBed.inject(BehaviorEngineService);
  });

  afterEach(() => { service.stopRealtime(); });

    it('1/2/3 — loads Account A, then switching fully replaces with Account B data', async () => {
    await service.loadAll('acct-a');
    expect(service.dashboard()?.account_id).toBe('acct-a');
    expect(service.dashboard()?.data_summary.trade_count).toBe(24);
    // After acct-a load: exactly one active realtime channel, scoped to acct-a.
    expect(r.ch.length).toBe(1);
    expect(r.ch[0]._name).toBe('behavior-engine:acct-a');

    await service.loadAll('acct-b');
    expect(service.dashboard()?.account_id).toBe('acct-b');
    expect(service.dashboard()?.data_summary.trade_count).toBe(12);
    expect(service.dashboard()?.data_summary.behavior_count).toBe(1);

    // Switching tears down acct-a's channel and subscribes to acct-b only.
    expect(r.rm.length).toBe(1);
    expect(r.rm[0]._name).toBe('behavior-engine:acct-a');
    expect(r.ch.length).toBe(2);
    expect(r.ch[1]._name).toBe('behavior-engine:acct-b');
    // The active (current) channel's filters are scoped to acct-b only.
    const activeFilters = (r.ch[1].filters as Array<{ filter?: string }>).map((o) => o.filter || '');
    expect(activeFilters.every((f) => f.includes('acct-b'))).toBeTrue();
    expect(activeFilters.some((f) => f.includes('acct-a'))).toBeFalse();
  });

  it('4/5 — a stale (older) account response is discarded by the loadToken guard', async () => {
    const loadA = service.loadAll('acct-a');
    const loadB = service.loadAll('acct-b');
    await loadB;
    await loadA;
    expect(service.dashboard()?.account_id).toBe('acct-b');
    expect(service.dashboard()?.data_summary.trade_count).toBe(12);
  });

  it('6/7 — switching accounts removes the previous realtime subscription exactly once', async () => {
    await service.loadAll('acct-a');
    // First load: nothing to remove yet, exactly one acct-a channel created.
    expect(r.ch.length).toBe(1);
    expect(r.rm.length).toBe(0);

    await service.loadAll('acct-b');
    // The acct-a channel is torn down exactly once; acct-b channel created.
    expect(r.rm.length).toBe(1);
    expect(r.rm[0]._name).toBe('behavior-engine:acct-a');
    expect(r.ch.length).toBe(2);
    expect(r.ch[1]._name).toBe('behavior-engine:acct-b');
  });

  it('8 — LLM-unavailable surfaces only as ai_status, never as an empty dashboard', async () => {
    fetchSpy.and.callFake((_i: any, _n?: any) => {
      const url: string = typeof _i === 'string' ? _i : ((_i as any)?.url || '');
      const { path, accountId } = parseRequest(url);
      const ai = accountId === 'acct-b' ? 'unavailable' : undefined;
      const body = defResp(accountId, path, ai);
      const res: FetchResponse = { ok: true, status: 200, json: async () => body };
      return Promise.resolve(res);
    });
    await service.loadAll('acct-b');
    expect(service.dashboard()?.data_summary.trade_count).toBe(12);
    expect(service.dashboard()?.data_summary.reflection_count).toBe(0);
    expect(service.dashboard()?.ai_status).toBe('unavailable');
    expect(service.dashboard()?.behaviors.length).toBe(1);
  });

  it('10 — duplicate loadAll calls are idempotent (no duplicate realtime channels)', async () => {
    await service.loadAll('acct-b');
    const n = r.ch.length;
    await service.loadAll('acct-b');
    // Re-loading the SAME account tears down the old channel and creates exactly
    // one new one (never accumulates). rm===1 (the first acct-b channel removed).
    expect(r.ch.length).toBe(n + 1);
    expect(r.rm.length).toBe(1);
    expect(r.rm[0]._name).toBe('behavior-engine:acct-b');
    expect(r.ch[1]._name).toBe('behavior-engine:acct-b');
  });
});
