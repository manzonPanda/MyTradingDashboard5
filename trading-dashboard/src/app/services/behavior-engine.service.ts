import { Injectable, inject, signal, computed } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { environment } from '../../environments/environment';

/**
 * BehaviorEngineService — Angular data layer for the Trading Behavior Engine.
 *
 * All requests carry the user's JWT AND the selected accountId; the backend
 * verifies ownership server-side (never trusts the frontend id) and scopes
 * every query to that account.
 */

export interface BehaviorEvidence {
  id: string;
  behavior_id: string;
  trade_id: string | null;
  trade_ticket: number | null;
  trade_time_open: string | null;
  reflection_excerpt: string | null;
  reason: string;
  metrics_snapshot: {
    pnl?: number;
    r_multiple?: number | null;
    instrument?: string;
    buy_sell?: string;
    held?: string | null;
    session?: string | null;
    rules_violated?: string | null;
  } | null;
  confidence: number;
  created_at: string;
}

export interface Behavior {
  id: string;
  account_id: string;
  name: string;
  name_key: string;
  behavior_type: 'positive' | 'negative';
  description: string | null;
  status: 'DETECTED' | 'EMERGING' | 'RECURRING' | 'ESTABLISHED' | 'RULE_CANDIDATE' | 'RESOLVED' | 'ARCHIVED';
  occurrence_count: number;
  confidence: number;
  estimated_impact_pnl: number | null;
  estimated_impact_r: number | null;
  first_detected_at: string;
  last_detected_at: string;
  created_at: string;
  updated_at: string;
  evidence?: BehaviorEvidence[];
  evidence_count?: number;
}

export interface TradingRule {
  id: string;
  account_id: string;
  rule: string;
  rationale: string | null;
  source_behavior_id: string | null;
  evidence_summary: {
    occurrences?: number;
    journal_reflections?: number;
    weeks_evidenced?: number;
    confidence?: number;
  } | null;
  confidence: number;
  status: 'candidate' | 'active' | 'archived';
  created_at: string;
}

export interface BehaviorAlert {
  id: string;
  account_id: string;
  behavior_id: string | null;
  trade_id: string | null;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  status: 'new' | 'read' | 'dismissed';
  dedupe_key: string;
  created_at: string;
  behavior?: Pick<Behavior, 'name' | 'name_key' | 'behavior_type'> | null;
}

export interface TradingBrief {
  id: string;
  account_id: string;
  week_start: string;
  week_end: string;
  payload: {
    summary?: string;
    biggest_leak?: { name: string; impact: number; occurrences: number; note?: string } | null;
    strongest_behavior?: { name: string; impact: number; occurrences: number; note?: string } | null;
    what_changed?: string[] | null;
    focus?: string | null;
    alerts_digest?: string[] | null;
  };
  generated_at: string;
}

export interface BehaviorPatternEvidence {
  previous_pnl?: number;
  delay_min?: number;
  result_pnl?: number;
  result_r?: number;
  ticket?: number | null;
  time_open?: string | null;
  instrument?: string | null;
  lot?: number;
  prior_ticket?: number | null;
  prior_time_close?: string | null;
  pnl?: number;
  r?: number;
  risk?: number;
  lots?: number;
}

export interface BehaviorPatternEvidenceGroup {
  ticket?: number | null;
  time_open?: string | null;
  pnl?: number;
  r?: number;
  instrument?: string | null;
  lots?: number;
}

export interface BehaviorPattern {
  id: string;
  title: string;
  direction: 'negative' | 'positive' | 'neutral';
  occurrences: number;
  description: string;
  detail: {
    window_min?: number;
    avg_delay_min?: number;
    normal_delay_min?: number | null;
    avg_result_pnl?: number;
    avg_result_r?: number;
    count?: number;
    max_streak?: number;
    total_pnl?: number;
    avg_r?: number;
    avg_risk?: number;
    sessions?: Array<{ session: string; label: string; trades: number; pnl: number }>;
  };
  evidence: BehaviorPatternEvidence[];
}

export interface WeekStats {
  trade_count: number;
  win_rate: number;
  avg_pnl: number;
  avg_r_per_trade: number;
  avg_risk_per_trade: number;
  max_loss_streak: number;
  total_pnl: number;
  avg_hold_seconds: number;
  avg_entry_delay_min: number;
  risk_after_2_wins: number;
  risk_after_2_wins_n: number;
  risk_normal: number;
  risk_normal_n: number;
}

export interface WeekView {
  week_start: string;
  week_end: string;
  current: WeekStats;
  previous: WeekStats;
  changes: Record<string, { current: number; previous: number; delta: number }>;
  extra_changes: {
    avg_hold_seconds: { current: number; previous: number; delta: number };
    avg_entry_delay_min: { current: number; previous: number; delta: number };
    risk_after_2_wins: { current: number; previous: number; delta: number };
    risk_normal: { current: number; previous: number };
  };
  has_week_trades: boolean;
  has_previous_trades: boolean;
}

export interface BehaviorScore {
  score: number | null;
  available: boolean;
  reason: string;
  occurrences?: number;
  recent_occurrences?: number;
  delta?: number | null;
}

export interface DataSummary {
  trade_count: number;
  closed_trades: number;
  winning_trades: number;
  losing_trades: number;
  reflection_count: number;
  first_trade_at: string | null;
  last_trade_at: string | null;
  behavior_count: number;
  evidence_count: number;
  analysis_count_done: number;
  analysis_count_total: number;
  last_analysis_at: string | null;
  last_analysis_status: string | null;
  last_analysis_error: string | null;
}

export type EngineStatus = 'learning' | 'analyzing' | 'up_to_date' | 'needs_more_data' | 'analysis_unavailable';

export interface BehaviorDashboard {
  account_id: string;
  generated_at: string;
  engine_status: EngineStatus;
  data_summary: DataSummary;
  score: BehaviorScore;
  behaviors: Array<Behavior & { evidence_count?: number }>;
  week: WeekView;
  patterns: BehaviorPattern[];
  brief: TradingBrief | null;
}

export type EngineTab = 'overall' | 'week' | 'insights';

@Injectable({ providedIn: 'root' })
export class BehaviorEngineService {
  private readonly supabaseService = inject(SupabaseService);
  private readonly backendUrl = environment.backendUrlAura;

  readonly behaviors = signal<Behavior[]>([]);
  readonly rules = signal<TradingRule[]>([]);
  readonly alerts = signal<BehaviorAlert[]>([]);
  readonly brief = signal<TradingBrief | null>(null);
  readonly dashboard = signal<BehaviorDashboard | null>(null);
  readonly isLoading = signal(false);
  readonly lastError = signal<string | null>(null);
  readonly activeTab = signal<EngineTab>('overall');

  /** Guards against a stale account response overwriting the active account. */
  private loadToken = 0;

  // Derived views — leak/edge rankings are backend-computed; frontend only sorts.
  readonly leaks = computed(() =>
    this.behaviors()
      .filter((b) => b.behavior_type === 'negative' && b.status !== 'ARCHIVED' && b.status !== 'RESOLVED')
      .sort((a, b) => (b.estimated_impact_pnl ?? 0) - (a.estimated_impact_pnl ?? 0))
  );
  readonly edge = computed(() =>
    this.behaviors()
      .filter((b) => b.behavior_type === 'positive' && b.status !== 'ARCHIVED' && b.status !== 'RESOLVED')
      .sort((a, b) => (b.estimated_impact_pnl ?? 0) - (a.estimated_impact_pnl ?? 0))
  );
  readonly emerging = computed(() =>
    this.behaviors().filter((b) => b.status === 'DETECTED' || b.status === 'EMERGING')
  );
  readonly activeRules = computed(() =>
    this.rules().filter((r) => r.status === 'active' || r.status === 'candidate')
  );

  private async getAuthHeaders(): Promise<HeadersInit> {
    const { data } = await this.supabaseService.client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Not authenticated');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }

  private getApiBase(): string {
    return `${this.backendUrl}/api/behavior-engine`;
  }

  private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = await this.getAuthHeaders();
    const response = await fetch(`${this.getApiBase()}${path}`, { ...init, headers });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error ?? `Request failed (${response.status})`);
    }
    return response.json() as Promise<T>;
  }

  // ─── API methods ───────────────────────────────────────────────

  async loadAll(accountId: string): Promise<void> {
    const token = ++this.loadToken;
    this.isLoading.set(true);
    this.lastError.set(null);
    // Enter the loading state BEFORE touching the data signals so the UI can
    // render the loader immediately; the response below is only applied if a
    // newer load (different account) hasn't replaced it.
    try {
      const [dashboardRes, behaviors, rules, alerts, brief] = await Promise.allSettled([
        this.fetchJson<BehaviorDashboard>(`/dashboard?accountId=${accountId}`),
        this.fetchJson<Behavior[]>(`/behaviors?accountId=${accountId}`),
        this.fetchJson<TradingRule[]>(`/rules?accountId=${accountId}`),
        this.fetchJson<BehaviorAlert[]>(`/alerts?accountId=${accountId}`),
        this.fetchJson<TradingBrief | null>(`/brief?accountId=${accountId}`),
      ]);
      if (token !== this.loadToken) return; // superseded by a newer load
      this.behaviors.set(behaviors.status === 'fulfilled' ? behaviors.value : []);
      this.rules.set(rules.status === 'fulfilled' ? rules.value : []);
      this.alerts.set(alerts.status === 'fulfilled' ? alerts.value : []);
      this.brief.set(brief.status === 'fulfilled' ? brief.value : null);
      this.dashboard.set(dashboardRes.status === 'fulfilled' ? dashboardRes.value : null);
      const failed = [dashboardRes, behaviors, rules, alerts, brief].find((r) => r.status === 'rejected');
      if (failed) throw (failed as PromiseRejectedResult).reason;
    } catch (err) {
      if (token !== this.loadToken) return; // superseded — ignore the error too
      const msg = err instanceof Error ? err.message : 'Failed to load Behavior Engine data.';
      this.lastError.set(msg);
      console.error('[BehaviorEngine] loadAll failed:', err);
    } finally {
      if (token === this.loadToken) this.isLoading.set(false);
    }
  }

  async getBehaviorDetail(accountId: string, behaviorId: string): Promise<Behavior | null> {
    try {
      return await this.fetchJson<Behavior>(`/behaviors/${behaviorId}?accountId=${accountId}`);
    } catch (err) {
      console.error('[BehaviorEngine] getBehaviorDetail failed:', err);
      return null;
    }
  }

  async getEvidence(accountId: string, behaviorId?: string): Promise<BehaviorEvidence[]> {
    const qs = new URLSearchParams({ accountId });
    if (behaviorId) qs.set('behaviorId', behaviorId);
    try {
      return await this.fetchJson<BehaviorEvidence[]>(`/evidence?${qs}`);
    } catch (err) {
      console.error('[BehaviorEngine] getEvidence failed:', err);
      return [];
    }
  }

  async dismissAlert(accountId: string, alertId: string): Promise<boolean> {
    try {
      await this.fetchJson(`/alerts/${alertId}/dismiss?accountId=${accountId}`, { method: 'PATCH' });
      this.alerts.update((list) => list.filter((a) => a.id !== alertId));
      return true;
    } catch (err) {
      console.error('[BehaviorEngine] dismissAlert failed:', err);
      return false;
    }
  }

  /** Trigger an on-demand analysis (e.g. after saving a trade/reflection). */
  async requestAnalysis(accountId: string, tradeId?: string): Promise<boolean> {
    try {
      await this.fetchJson('/analyze', {
        method: 'POST',
        body: JSON.stringify({ accountId, tradeId: tradeId ?? null, trigger: tradeId ? 'trade_saved' : 'manual' }),
      });
      return true;
    } catch (err) {
      console.error('[BehaviorEngine] requestAnalysis failed:', err);
      return false;
    }
  }

  /**
   * Fire-and-forget notification that a trade (with its Daily Reflection)
   * was saved. Enqueues an AI analysis job on the backend without blocking
   * the save UX. Silent on failure — the job is retried server-side.
   */
  notifyTradeSaved(accountId: string, tradeId: string): void {
    void this.fetchJson('/webhook/trade-saved', {
      method: 'POST',
      body: JSON.stringify({ accountId, tradeId }),
    }).catch((err) => {
      // Non-fatal: saving a trade must never fail because of AI analysis.
      console.error('[BehaviorEngine] notifyTradeSaved (non-blocking) failed:', err);
    });
  }

  setTab(tab: EngineTab): void {
    this.activeTab.set(tab);
  }
}

