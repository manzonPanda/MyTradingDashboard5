/**
 * Deterministic behavior analysis is deliberately independent of the LLM.
 * It derives only observable patterns from account-scoped trade facts and
 * persists auditable evidence. Reflections can enrich AI interpretation later,
 * but are never required here.
 */
import { computePatterns, weekStart } from './dashboard-stats.js';
import { computeTradeMetrics } from './stats.js';
import { evidenceConfidence } from './confidence.js';
import { recomputeBehavior } from './analysis-service.js';
import { resolveThresholds } from './thresholds.js';

const PATTERNS = {
  post_loss_reentry: { name: 'Rapid re-entry after a loss', type: 'negative', confidence: 0.72 },
  loss_streaks: { name: 'Consecutive losing streaks', type: 'negative', confidence: 0.7 },
};

export class DeterministicBehaviorService {
  constructor({ supabase, store, tradingData }) {
    this.supabase = supabase;
    this.store = store;
    this.tradingData = tradingData;
  }

  async analyzeAccount(userId, accountId) {
    const [resolvedId] = await this.tradingData.resolveAccountScope(userId, accountId);
    if (!resolvedId) throw new Error('Account is not accessible.');
    const { data: trades, error } = await this.supabase
      .from('trades')
      .select('id, ticket, account_id, instrument, buy_sell, lots, pnl, commission, swap, price_open, price_close, sl, tp, pips, rrr, risk_per_trade, mfe, mae, held, daily_reflection, rules_violated, weekly_retrospective, time_open, time_close, created_at')
      .eq('account_id', resolvedId)
      .order('time_open', { ascending: true });
    if (error) throw new Error(`deterministic trade lookup failed: ${error.message}`);

    const byId = new Map((trades || []).map((trade) => [trade.id, trade]));
    let evidenceWritten = 0;
    const touched = new Map();
    for (const pattern of computePatterns(trades || [])) {
      const definition = PATTERNS[pattern.id];
      if (!definition) continue; // neutral statistics stay dashboard-only facts.
      const { behavior } = await this.store.upsertBehavior(userId, resolvedId, {
        name: definition.name,
        name_key: pattern.id,
        behavior_type: definition.type,
        description: pattern.description,
        model: null,
      });
      touched.set(behavior.id, behavior);
      const groups = pattern.id === 'loss_streaks' ? pattern.evidence.flat() : pattern.evidence;
      for (const item of groups) {
        const trade = [...byId.values()].find((row) => String(row.ticket) === String(item.ticket));
        if (!trade) continue;
        await this.store.upsertEvidence(userId, resolvedId, {
          behavior_id: behavior.id,
          analysis_id: null,
          trade_id: trade.id,
          trade_ticket: trade.ticket ?? null,
          trade_time_open: trade.time_open ?? null,
          week_start: weekStart(trade.time_open || trade.created_at),
          reflection_excerpt: null,
          reason: pattern.id === 'post_loss_reentry'
            ? `Opened ${item.delay_min} minutes after loss on trade #${item.prior_ticket ?? 'unknown'}.`
            : 'Part of an objective sequence of two or more consecutive losses.',
          metrics_snapshot: computeTradeMetrics(trade),
          evidence_confidence: evidenceConfidence(definition.confidence),
        });
        evidenceWritten += 1;
      }
    }
    const thresholds = resolveThresholds(await this.store.getBehaviorConfig(userId, resolvedId));
    for (const behavior of touched.values()) await recomputeBehavior(this.store, userId, resolvedId, behavior, thresholds);
    return { accountId: resolvedId, tradeCount: (trades || []).length, evidenceWritten, behaviorCount: touched.size };
  }
}
