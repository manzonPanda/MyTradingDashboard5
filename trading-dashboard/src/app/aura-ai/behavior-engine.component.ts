import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, inject, signal, effect } from '@angular/core';
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
} from '../services/behavior-engine.service';

/**
 * TradingBehaviorEngineComponent — 🧠 AURA's behavior analysis surface.
 *
 * The ACTIVE ACCOUNT is the single source of truth held by the shared
 * AccountContextService — driven by the main dashboard header (and the AURA
 * page header). This component has NO account selector of its own. When the
 * shared account changes the entire engine reloads for the newly active
 * account, with a loading state so stale data is never shown.
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
  readonly engine = inject(BehaviorEngineService);
  readonly accountContext = inject(AccountContextService);

  readonly detailOpen = signal(false);
  readonly detailBehavior = signal<Behavior | null>(null);
  readonly detailEvidence = signal<BehaviorEvidence[]>([]);

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

  /** Any rendered Overall content (leaks/edge/emerging/rules). */
  get hasOverallData(): boolean {
    return (
      this.engine.leaks().length > 0 ||
      this.engine.edge().length > 0 ||
      this.engine.emerging().length > 0 ||
      this.engine.activeRules().length > 0
    );
  }

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
}
