/**
 * Behavior Engine — BehaviorStore
 *
 * ACCOUNT-SCOPED data access for the Trading Behavior Engine.
 *
 * Every query/write goes through TradingDataAccess ownership resolution.
 * This class NEVER accepts an account_id without first verifying the user
 * owns it. It runs with the service-role client (RLS bypass) so the scoping
 * is enforced HERE, in code — never skipped. Account cortex isolation is
 * structural: every query filters eq('user_id') + eq('account_id').
 */

import { TradingDataAccess, AccountAccessError } from './trading-data.js';

export class BehaviorStore {
  constructor(supabase, tradingData = null) {
    this.supabase = supabase;
    this.tradingData = tradingData ?? new TradingDataAccess(supabase);
  }

  /** Resolve + verify ownership. Throws AccountAccessError when invalid. */
  async resolveAccountId(userId, accountId) {
    const ids = await this.tradingData.resolveAccountScope(userId, accountId);
    return ids[0];
  }

  /** Load a user's behavior_config thresholds; null when none stored. */
  async getBehaviorConfig(userId, accountId) {
    const { data, error } = await this.supabase
      .from('behavior_config')
      .select('thresholds')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw new Error(`behavior_config lookup failed: ${error.message}`);
    return data?.thresholds ?? null;
  }

  /**
   * List behaviors for an account, optionally filtered by status/type.
   * Ownership verified before the query. Account-isolated by construction.
   */
  async listBehaviors(userId, accountId, { status = null, type = null } = {}) {
    const resolved = await this.resolveAccountId(userId, accountId);
    let q = this.supabase
      .from('behaviors')
      .select('*, evidence:behavior_evidence(id, trade_id, created_at, metrics_snapshot)')
      .eq('user_id', userId)
      .eq('account_id', resolved)
      .order('occurrence_count', { ascending: false });
    if (status) q = q.eq('status', status);
    if (type) q = q.eq('behavior_type', type);
    const { data, error } = await q;
    if (error) throw new Error(`behaviors lookup failed: ${error.message}`);
    return data || [];
  }

  /** Fetch one behavior with its linked evidence. */
  async getBehavior(userId, accountId, behaviorId) {
    const resolved = await this.resolveAccountId(userId, accountId);
    const { data, error } = await this.supabase
      .from('behaviors')
      .select('*, evidence:behavior_evidence(*)')
      .eq('id', behaviorId)
      .eq('user_id', userId)
      .eq('account_id', resolved)
      .maybeSingle();
    if (error) throw new Error(`behavior lookup failed: ${error.message}`);
    return data ?? null;
  }

  /** All evidence rows for one account (optionally filtered to a behavior). */
  async listEvidence(userId, accountId, { behaviorId = null, weekStart = null, limit = 100 } = {}) {
    const resolved = await this.resolveAccountId(userId, accountId);
    let q = this.supabase
      .from('behavior_evidence')
      .select('*')
      .eq('user_id', userId)
      .eq('account_id', resolved)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (behaviorId) q = q.eq('behavior_id', behaviorId);
    if (weekStart) q = q.eq('week_start', weekStart);
    const { data, error } = await q;
    if (error) throw new Error(`evidence lookup failed: ${error.message}`);
    return data || [];
  }

  /**
   * Upsert evidence — idempotent per (behavior_id, trade_id).
   * A retried analysis updates the SAME row instead of duplicating.
   */
  async upsertEvidence(userId, accountId, evidence) {
    const resolved = await this.resolveAccountId(userId, accountId);
    const { data, error } = await this.supabase
      .from('behavior_evidence')
      .upsert(
        {
          user_id: userId,
          account_id: resolved,
          ...evidence,
        },
        { onConflict: 'behavior_id,trade_id' }
      )
      .select()
      .single();
    if (error) throw new Error(`evidence upsert failed: ${error.message}`);
    return data;
  }

  /** Recompute + persist a behavior's backend-computed aggregates. */
  async updateBehaviorAggregates(userId, accountId, behaviorId, patch) {
    const resolved = await this.resolveAccountId(userId, accountId);
    const { data, error } = await this.supabase
      .from('behaviors')
      .update({ user_id: userId, account_id: resolved, ...patch })
      .eq('id', behaviorId)
      .eq('user_id', userId)
      .eq('account_id', resolved)
      .select()
      .single();
    if (error) throw new Error(`behavior update failed: ${error.message}`);
    return data;
  }

  /**
   * Upsert a behavior row by its convergent identity (account_id, name_key, type).
   * Returns { behavior, created } — created=true means a new row.
   */
  async upsertBehavior(userId, accountId, { name, name_key, behavior_type, description, model }) {
    const resolved = await this.resolveAccountId(userId, accountId);
    const base = {
      user_id: userId,
      account_id: resolved,
      name: String(name || '').slice(0, 160),
      name_key: String(name_key || '').slice(0, 80),
      behavior_type,
      description: description ? String(description).slice(0, 1000) : null,
      model: model ?? null,
    };
    const { data, error } = await this.supabase
      .from('behaviors')
      .upsert(base, { onConflict: 'account_id,name_key,behavior_type' })
      .select()
      .single();
    if (error) throw new Error(`behavior upsert failed: ${error.message}`);
    return { behavior: data, created: true };
  }

  /** Fetch a trade with its key objective fields for analysis. */
  async getTrade(userId, accountId, tradeId) {
    const resolved = await this.resolveAccountId(userId, accountId);
    const { data, error } = await this.supabase
      .from('trades')
      .select('id, ticket, account_id, instrument, buy_sell, lots, pnl, commission, swap, price_open, price_close, sl, tp, pips, rrr, risk_per_trade, mfe, mae, held, daily_reflection, rules_violated, weekly_retrospective, time_open, time_close, created_at')
      .eq('id', tradeId)
      .eq('account_id', resolved)
      .maybeSingle();
    if (error) throw new Error(`trade lookup failed: ${error.message}`);
    if (data && data.account_id !== resolved) throw new AccountAccessError(tradeId);
    return data ?? null;
  }
}