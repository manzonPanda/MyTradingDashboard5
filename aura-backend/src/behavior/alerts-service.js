/**
 * Behavior Engine — Alerts Service
 *
 * Generates behavior alerts from ACTUAL account behavior with built-in
 * anti-spam:
 *   - every alert carries a deterministic dedupe_key; the DB unique
 *     (account_id, dedupe_key) makes duplicate alerts impossible;
 *   - a per-account rolling window cap (alertMaxPerWindow in behavior_config)
 *     limits alert volume;
 *   - severity is derived from backend facts (occurrence delta, impact, R).
 *
 * The LLM may phrase the message text; the TRIGGER conditions are pure
 * backend logic. This module never calls the LLM directly — the analysis
 * pipeline passes the pre-computed alert candidates here.
 */

import { resolveThresholds } from '../behavior/thresholds.js';

export class AlertsService {
  constructor(supabase, tradingData) {
    this.supabase = supabase;
    this.tradingData = tradingData;
  }

  async resolveAccountId(userId, accountId) {
    const ids = await this.tradingData.resolveAccountScope(userId, accountId);
    return ids[0];
  }

  /** Count alerts created for the account inside the rolling window. */
  async countRecent(userId, accountId, windowDays) {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await this.supabase
      .from('behavior_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .gte('created_at', since);
    if (error) throw new Error(`alert count failed: ${error.message}`);
    return count ?? 0;
  }

  /**
   * Create an alert if the dedupe key is new AND the window cap allows it.
   * Returns the inserted row or null (deduped / capped).
   * The unique (account_id, dedupe_key) constraint remains the final guard.
   */
  async createAlert(userId, accountId, candidate) {
    const resolved = await this.resolveAccountId(userId, accountId);
    const thresholds = resolveThresholds(candidate.thresholds);

    // Dedupe check — deterministic anti-spam.
    const existing = await this.supabase
      .from('behavior_alerts')
      .select('id')
      .eq('account_id', resolved)
      .eq('dedupe_key', candidate.dedupe_key)
      .maybeSingle();
    if (existing.data) return null;

    // Rolling-window volume cap.
    const recent = await this.countRecent(userId, resolved, thresholds.alertWindowDays);
    if (recent >= thresholds.alertMaxPerWindow) return null;

    const { data, error } = await this.supabase
      .from('behavior_alerts')
      .insert({
        user_id: userId,
        account_id: resolved,
        alert_type: candidate.alert_type,
        severity: candidate.severity,
        status: 'new',
        message: String(candidate.message || '').slice(0, 1000),
        behavior_id: candidate.behavior_id ?? null,
        trade_id: candidate.trade_id ?? null,
        analysis_id: candidate.analysis_id ?? null,
        dedupe_key: candidate.dedupe_key,
      })
      .select()
      .single();
    if (error) {
      // Race with another worker inserting the same dedupe key → treat as dedupe.
      if (/(duplicate|unique)/i.test(error.message || '')) return null;
      throw new Error(`alert create failed: ${error.message}`);
    }
    return data;
  }

  /** List alerts for an account (new first). */
  async listAlerts(userId, accountId, { status = 'new', limit = 20 } = {}) {
    const resolved = await this.resolveAccountId(userId, accountId);
    let q = this.supabase
      .from('behavior_alerts')
      .select('*')
      .eq('user_id', userId)
      .eq('account_id', resolved)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw new Error(`alert list failed: ${error.message}`);
    return data || [];
  }

  /** Mark one alert read/dismissed (ownership-checked). */
  async updateStatus(userId, accountId, alertId, status) {
    const resolved = await this.resolveAccountId(userId, accountId);
    if (!['new', 'read', 'dismissed'].includes(status)) {
      throw new Error(`invalid alert status: ${status}`);
    }
    const { data, error } = await this.supabase
      .from('behavior_alerts')
      .update({ status })
      .eq('id', alertId)
      .eq('user_id', userId)
      .eq('account_id', resolved)
      .select()
      .single();
    if (error) throw new Error(`alert update failed: ${error.message}`);
    return data;
  }

  /**
   * Post-analysis alert candidates (pure backend logic, no LLM):
   *  - recurrence: a RECURRING/ESTABLISHED behavior gained a new occurrence
   *  - post-loss entry: the analyzed trade opened < 30 min after a prior loss
   * Dedupe keys make these fire at most once per (behavior, trade) / week.
   */
  postAnalysisCandidates({ accountId, analysis, behavior, trade, priorTrade }) {
    const out = [];

    if (behavior && ['RECURRING', 'ESTABLISHED', 'RULE_CANDIDATE'].includes(behavior.status)) {
      out.push({
        alert_type: 'recurrence',
        severity: behavior.status === 'RECURRING' ? 'warning' : 'critical',
        behavior_id: behavior.id,
        trade_id: trade?.id ?? null,
        analysis_id: analysis?.id ?? null,
        dedupe_key: `recurrence:${behavior.id}:${trade?.id ?? 'na'}`,
        message: `A.U.R.A. detected another ${behavior.name} occurrence (${behavior.occurrence_count} total).`,
      });
    }

    if (trade && priorTrade && Number(priorTrade.pnl) < 0) {
      const priorClose = priorTrade.time_close ? new Date(priorTrade.time_close).getTime() : null;
      const open = trade.time_open ? new Date(trade.time_open).getTime() : null;
      if (priorClose && open && open - priorClose < 30 * 60 * 1000) {
        out.push({
          alert_type: 'post_loss_entry',
          severity: 'warning',
          behavior_id: behavior?.id ?? null,
          trade_id: trade.id,
          analysis_id: analysis?.id ?? null,
          dedupe_key: `post_loss_entry:${accountId}:${this.weekStart(trade.time_open)}`,
          message: `Entered a new trade within 30 minutes after a loss (${priorTrade.instrument || 'prior trade'}).`,
        });
      }
    }

    return out;
  }

  weekStart(input) {
    const d = new Date(input);
    const day = (d.getUTCDay() + 6) % 7; // Monday = 0
    d.setUTCDate(d.getUTCDate() - day);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }
}