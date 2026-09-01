import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AccountContextService } from '../services/account-context.service';
import {
  BehaviorEngineService,
  Behavior,
  BehaviorEvidence,
  BehaviorPattern,
} from '../services/behavior-engine.service';

/**
 * TradingBehaviorEngineComponent — 🧠 AURA's behavior analysis surface.
 *
 * The ACTIVE ACCOUNT is the single source of truth held by the shared
 * AccountContextService — driven by the main dashboard header (and the AURA
 * page header). This component has NO account selector of its own. When the
 * shared account changes the entire engine reloads for the newly active
 * account, with a loading state so stale data is never shown.
 *
 * Every number rendered is backend-computed (GET /behavior-engine/dashboard),
 * which derives statistics from the account's actual trades/evidence — the UI
 * never invents figures and the LLM never writes objective numbers.
 */
@Component({
  selector: 'app-behavior-engine',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatTooltipModule, MatProgressSpinnerModule],
  templateUrl: './behavior-engine.component.html',
  styleUrl: './behavior-engine.component.scss',
})
export class TradingBehaviorEngineComponent implements OnInit, OnDestroy {
  readonly Math = Math;
  readonly engine = inject(BehaviorEngineService);
  readonly accountContext = inject(AccountContextService);

  readonly detailOpen = signal(false);
  readonly detailBehavior = signal<Behavior | null>(null);
  readonly detailEvidence = signal<BehaviorEvidence[]>([]);
  readonly expandedPatterns = signal<Record<string, boolean>>({});
  readonly expandedBehaviors = signal<Record<string, boolean>>({});

  private loadedAccountId: string | null = null;

  constructor() {
    // Single reactive reload path: whenever the shared account context changes
    // (dashboard header / AURA header switch), reload the ENTIRE engine for the
    // newly active account. The loading state is set before any await so stale
    // data from the previous account is never displayed.
    effect(() => {
      const accountId = this.accountContext.selectedAccountId();
      if (accountId && accountId !== this.loadedAccountId) {
        this.loadedAccountId = accountId;
        this.detailOpen.set(false);
        this.detailEvidence.set([]);
        this.expandedPatterns.set({});
        this.expandedBehaviors.set({});
        void this.engine.loadAll(accountId);
      }
    }, { allowSignalWrites: true });
  }

  /** Account name shown in the "Analyzing: …" context indicator. */
  get selectedAccountName(): string {
    return this.accountContext.selectedAccount()?.name ?? '';
  }

  get selectedAccountId(): string | null {
    return this.accountContext.selectedAccountId();
  }

  /** Live dashboard payload (computed server-side, never fabricated locally). */
  readonly dashboard = computed(() => this.engine.dashboard());
  readonly summary = computed(() => this.dashboard()?.data_summary ?? null);
  readonly behaviors = computed(() => this.dashboard()?.behaviors ?? []);
  readonly score = computed(() => this.dashboard()?.score ?? null);
  readonly patterns = computed(() => this.dashboard()?.patterns ?? []);
  readonly week = computed(() => this.dashboard()?.week ?? null);
  readonly brief = computed(() => this.dashboard()?.brief ?? null);

  /** ENGINE STATUS: derived label + tone, from the backend payload. */
  readonly engineStatus = computed(() => {
    const status = this.dashboard()?.engine_status ?? 'needs_more_data';
    const map: Record<string, { label: string; tone: string }> = {
      learning: { label: 'Learning', tone: 'info' },
      analyzing: { label: 'Analyzing', tone: 'busy' },
      up_to_date: { label: 'Up to date', tone: 'ok' },
      needs_more_data: { label: 'Needs more data', tone: 'warn' },
      analysis_unavailable: { label: 'Analysis unavailable', tone: 'muted' },
    };
    return map[status] ?? { label: 'Learning', tone: 'info' };
  });

  /** True when there are genuinely no behaviors to show yet. */
  readonly hasNoBehaviors = computed(
    () => this.behaviors().filter((b) => b.status !== 'ARCHIVED').length === 0
  );

  /** Sorted behavior cards — negatives first by impact, then positives. */
  readonly behaviorCards = computed(() =>
    [...this.behaviors()]
      .filter((b) => b.status !== 'ARCHIVED')
      .sort((a, b) => {
        if (a.behavior_type !== b.behavior_type) return a.behavior_type === 'negative' ? -1 : 1;
        return Math.abs(b.estimated_impact_pnl ?? 0) - Math.abs(a.estimated_impact_pnl ?? 0);
      })
      .slice(0, 6)
  );

  /** Patterns worth showing: non-empty evidence. */
  readonly visiblePatterns = computed(() =>
    this.patterns().filter((p) => {
      const ev = Array.isArray(p.evidence) ? p.evidence : [];
      return ev.length > 0;
    })
  );

  /** Week-over-week deltas that are actually non-zero and meaningful. */
  readonly weekChanges = computed(() => {
    const w = this.week();
    if (!w || !w.current || !w.previous) return [];
    const out: Array<{ key: string; label: string; current: number; previous: number; delta: number; unit: string; negative: boolean }> = [];
    const push = (key: string, label: string, unit: string, negativeIsBad: boolean, scale = 1) => {
      const c = w.current[key as keyof typeof w.current];
      const p = w.previous[key as keyof typeof w.previous];
      if (typeof c === 'number' && typeof p === 'number') {
        const cur = c * scale;
        const prev = p * scale;
        if (Math.abs(cur - prev) >= 0.001) {
          out.push({ key, label, current: cur, previous: prev, delta: cur - prev, unit, negative: negativeIsBad });
        }
      }
    };
    push('win_rate', 'Win rate', '%', true, 100);
    push('avg_entry_delay_min', 'Avg entry delay', 'min', false);
    push('avg_hold_seconds', 'Avg hold time', 'sec', false);
    push('avg_risk_per_trade', 'Avg risk per trade', '$', false);
    push('total_pnl', 'Total P&L', '$', true);
    const extra = w.extra_changes;
    if (extra.risk_after_2_wins.delta !== 0 && (extra.risk_after_2_wins.current || 0) > 0) {
      out.push({
        key: 'risk_after_2_wins',
        label: 'Risk after 2+ consecutive wins',
        current: extra.risk_after_2_wins.current,
        previous: extra.risk_after_2_wins.previous,
        delta: extra.risk_after_2_wins.delta,
        unit: '$',
        negative: true,
      });
    }
    if (w.current.max_loss_streak !== w.previous.max_loss_streak) {
      out.push({
        key: 'max_loss_streak',
        label: 'Longest loss streak',
        current: w.current.max_loss_streak,
        previous: w.previous.max_loss_streak,
        delta: w.current.max_loss_streak - w.previous.max_loss_streak,
        unit: 'trades',
        negative: true,
      });
    }
    return out;
  });
async ngOnInit(): Promise<void> {
    await this.accountContext.ensureLoaded();
    const accountId = this.accountContext.selectedAccountId();
    if (accountId && accountId !== this.loadedAccountId) {
      this.loadedAccountId = accountId;
      void this.engine.loadAll(accountId);
    }
  }

  ngOnDestroy(): void {
    this.detailOpen.set(false);
  }

  reload(): void {
    const accountId = this.accountContext.selectedAccountId();
    if (accountId) void this.engine.loadAll(accountId);
  }

  statusEmoji(status: string): string {
    const map: Record<string, string> = {
      DETECTED: '👀', EMERGING: '🟡', RECURRING: '🔴', ESTABLISHED: '🟢', RULE_CANDIDATE: '📜', RESOLVED: '✔️', ARCHIVED: '📦',
    };
    return map[status] ?? '•';
  }

  togglePattern(id: string): void {
    this.expandedPatterns.update((s) => ({ ...s, [id]: !s[id] }));
  }

  isPatternExpanded(id: string): boolean {
    return !!this.expandedPatterns()[id];
  }

  toggleBehavior(id: string): void {
    this.expandedBehaviors.update((s) => ({ ...s, [id]: !s[id] }));
  }

  isBehaviorExpanded(id: string): boolean {
    return !!this.expandedBehaviors()[id];
  }

  /** Find a pattern by id (template-safe). */
  findPattern(id: string): BehaviorPattern | null {
    return this.patterns().find((p) => p.id === id) ?? null;
  }

  /** First positive behavior (template-safe edge insight). */
  positiveBehavior(): Behavior | null {
    return this.behaviorCards().find((b) => b.behavior_type === 'positive') ?? null;
  }

  /** First negative behavior (template-safe leak insight). */
  negativeBehavior(): Behavior | null {
    return this.behaviorCards().find((b) => b.behavior_type === 'negative') ?? null;
  }

  /** Evidence rows belonging to a behavior (from the /behaviors response). */
  behaviorEvidence(id: string): BehaviorEvidence[] {
    return this.engine.behaviors().find((x) => x.id === id)?.evidence ?? [];
  }

  async openDetail(behavior: Behavior): Promise<void> {
    this.detailOpen.set(true);
    this.detailBehavior.set(behavior);
    const accountId = this.accountContext.selectedAccountId();
    if (!accountId) return;
    const evidence = await this.engine.getEvidence(accountId, behavior.id);
    this.detailEvidence.set(evidence);
  }

  closeDetail(): void {
    this.detailOpen.set(false);
  }

  async dismissAlert(alert: { id: string }): Promise<void> {
    const accountId = this.accountContext.selectedAccountId();
    if (!accountId) return;
    await this.engine.dismissAlert(accountId, alert.id);
  }
// ─── Formatters (presentation only — numbers come from the backend) ─────

  /** Format P&L with sign. */
  fmtPnl(v: number | null | undefined): string {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n)) return '—';
    const sign = n > 0 ? '+' : '';
    return `${sign}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }

  /** Format numeric counts / money without sign. */
  fmtNumber(v: number | null | undefined): string {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  /** Format a confidence 0..1 to a percentage. */
  fmtPct(v: number | null | undefined): string {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n)) return '—';
    return `${Math.round(n * 100)}%`;
  }

  /** Format a timestamp as a short human date. */
  fmtDate(v: string | null | undefined): string {
    if (!v) return '—';
    const d = new Date(v);
    if (!Number.isFinite(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /** Format a seconds value as a human duration like "4m 31s". */
  fmtDuration(seconds: number | null | undefined): string {
    const s = Math.round(Number(seconds ?? 0));
    if (!Number.isFinite(s) || s < 0) return '—';
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  }
}