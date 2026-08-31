/**
 * Trading Data Access — SECURITY LAYER for all trade queries
 *
 * The `trades` table has NO user_id column; row ownership is
 * `trades.account_id → accounts.user_id`. Every trade query in the backend
 * MUST therefore be scoped through this module:
 *
 *   1. resolveAccountScope(userId, accountId|null)
 *        - accountId given  → ownership is VERIFIED (throws AccountAccessError
 *          if the account does not belong to the JWT user) → [accountId]
 *        - accountId absent → all account ids owned by the user
 *        - user owns no accounts → [] and callers MUST short-circuit to an
 *          empty result (never query unscoped).
 *
 *   2. assertAccountOwnership(userId, accountId)
 *        - hard check used by HTTP routes before any work happens.
 *
 * Account-id lists are cached briefly per user to avoid one extra accounts
 * query per tool call. Ownership checks are NEVER cached.
 */

export class AccountAccessError extends Error {
  constructor(accountId) {
    super('The requested trading account does not belong to the authenticated user.');
    this.name = 'AccountAccessError';
    this.statusCode = 403;
    this.accountId = accountId;
  }
}

const SCOPE_CACHE_TTL_MS = 60_000;

export class TradingDataAccess {
  constructor(supabase) {
    this.supabase = supabase;
    // userId → { accountIds, expiresAt }
    this._scopeCache = new Map();
  }

  /**
   * All account ids owned by the user (short-TTL cached).
   * @returns {Promise<string[]>}
   */
  async getUserAccountIds(userId) {
    const cached = this._scopeCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.accountIds;
    }

    const { data, error } = await this.supabase
      .from('accounts')
      .select('id')
      .eq('user_id', userId);

    if (error) throw new Error(`Account scope lookup failed: ${error.message}`);

    const accountIds = (data || []).map((row) => row.id);
    this._scopeCache.set(userId, {
      accountIds,
      expiresAt: Date.now() + SCOPE_CACHE_TTL_MS,
    });
    return accountIds;
  }

  /**
   * Hard ownership check. Throws AccountAccessError when the account does not
   * exist or belongs to a different user. Returns the account row.
   */
  async assertAccountOwnership(userId, accountId) {
    if (!accountId || typeof accountId !== 'string') {
      throw new AccountAccessError(accountId);
    }

    const { data, error } = await this.supabase
      .from('accounts')
      .select('id, user_id, name, platform, phase')
      .eq('id', accountId)
      .maybeSingle();

    if (error) throw new Error(`Account lookup failed: ${error.message}`);
    if (!data || data.user_id !== userId) throw new AccountAccessError(accountId);
    return data;
  }

  /**
   * Resolve the account-id list a trade query may touch for this user.
   * NEVER returns an unscoped signal — an empty array means "query nothing".
   *
   * @param {string} userId - authenticated user id (from the verified JWT)
   * @param {string|null} accountId - optional specific account requested
   * @returns {Promise<string[]>}
   */
  async resolveAccountScope(userId, accountId = null) {
    if (accountId) {
      const account = await this.assertAccountOwnership(userId, accountId);
      return [account.id];
    }
    return this.getUserAccountIds(userId);
  }
}
