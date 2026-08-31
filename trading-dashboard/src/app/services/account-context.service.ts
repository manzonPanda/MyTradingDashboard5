import { Injectable, computed, inject, signal } from '@angular/core';
import { Account, SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';

/**
 * AccountContextService — single source of truth for the trading account the
 * user is currently working with on AI surfaces (AURA chat now, the Trading
 * Behavior Engine in Phase 2).
 *
 * The selection is persisted to `user_settings.default_account_id` — the SAME
 * column the dashboard restores its own selectedAccount from — so the AI
 * surfaces and the dashboard stay in sync through the database without the
 * dashboard needing a refactor in Phase 1.
 *
 * Every AI request carries the selected account id; the backend verifies that
 * this account belongs to the authenticated JWT user before querying anything.
 */
@Injectable({ providedIn: 'root' })
export class AccountContextService {
  private readonly supabaseService = inject(SupabaseService);
  private readonly authService = inject(AuthService);

  private readonly accountsSignal = signal<Account[]>([]);
  private readonly selectedAccountIdSignal = signal<string | null>(null);
  private readonly isLoadingSignal = signal(false);
  private loadPromise: Promise<void> | null = null;

  readonly accounts = this.accountsSignal.asReadonly();
  readonly selectedAccountId = this.selectedAccountIdSignal.asReadonly();
  readonly selectedAccount = computed(
    () => this.accountsSignal().find((account) => account.id === this.selectedAccountIdSignal()) ?? null
  );
  readonly isLoading = this.isLoadingSignal.asReadonly();

  /** Load accounts + persisted selection once per session (idempotent). */
  async ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.load().catch((err) => {
        console.error('[AccountContext] Load failed:', err);
        this.loadPromise = null; // allow retry on next call
      });
    }
    return this.loadPromise;
  }

  private async load(): Promise<void> {
    const userId = this.authService.user()?.id;
    if (!userId) return;

    this.isLoadingSignal.set(true);
    try {
      const accounts = await this.supabaseService.getAccounts();

      // The saved default may be stale (account deleted) — fall back sanely.
      let savedId: string | null = null;
      try {
        const settings = await this.supabaseService.getUserSettings(userId);
        savedId = settings?.default_account_id ?? null;
      } catch {
        savedId = null;
      }

      const validSavedId = (accounts ?? []).some((account) => account.id === savedId)
        ? savedId
        : null;
      const initialId = validSavedId ?? (accounts ?? [])[0]?.id ?? null;

      this.accountsSignal.set(accounts ?? []);
      this.selectedAccountIdSignal.set(initialId);
    } finally {
      this.isLoadingSignal.set(false);
    }
  }

  /**
   * Select an account and persist it as the user's default account.
   * Switching this selection switches the account context of every AI request.
   */
  async selectAccount(accountId: string): Promise<void> {
    if (!accountId || accountId === this.selectedAccountIdSignal()) return;
    this.selectedAccountIdSignal.set(accountId);

    const userId = this.authService.user()?.id;
    if (!userId) return;
    try {
      await this.supabaseService.updateUserSettings(userId, { default_account_id: accountId });
    } catch (err) {
      // Non-fatal: the in-memory selection still drives AI requests.
      console.error('[AccountContext] Persisting selected account failed:', err);
    }
  }

  /**
   * Apply an account selection made by ANOTHER owner of the shared state — the
   * main dashboard header is the single source of truth for the active account.
   * Updates the in-memory reference ONLY (no user_settings write), because the
   * dashboard already persisted the same value through its own path. Keeps the
   * AURA chat + Trading Behavior Engine instantly in sync with the dashboard
   * without creating a second source of truth.
   */
  setAccountContext(accountId: string | null): void {
    this.selectedAccountIdSignal.set(accountId);
  }
}
