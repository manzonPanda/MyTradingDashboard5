/**
 * Behavior Engine — Analysis Service (worker + orchestration)
 *
 * Binds together:
 *   AnalysisJobStore   (queued→running→done|failed|skipped)
 *   BehaviorStore      (account-scoped reads/writes)
 *   LLM provider       (interpretation only)
 *   schema validator   (strict gate; one repair retry)
 *
 * RETRY / FAILURE RULES
 *   - Invalid JSON/schema → ONE repair retry → still invalid → failed.
 *   - LLM timeout/rate-limit/provider failure → requeue with tracked
 *     attempts; exhausted attempts → failed. Trade saving is never blocked.
 *   - Skipped = "nothing to analyze" (e.g. empty reflection / missing trade).
 *
 * IDEMPOTENCY
 *   - Re-processing the same trade converges on unique(behavior_id, trade_id);
 *     no duplicate behaviors or evidence rows.
 */

import { BehaviorStore } from '../data/behavior-store.js';
import { AnalysisJobStore } from '../data/analysis-job-store.js';
import { TradingDataAccess, AccountAccessError } from '../data/trading-data.js';
import { validateAnalysisPayload, buildRepairPrompt, BehaviorValidationError } from './schema.js';
import { normalizeBehaviorName, computeTradeMetrics } from './stats.js';
import { evidenceConfidence, blendConfidence, consistencyFactor, finalConfidence } from './confidence.js';
import { computeStatus, resolveIfInactive } from './lifecycle.js';
import { resolveThresholds } from './thresholds.js';
import { LLMError } from '../ai/provider.js';

export const ANALYSIS_PROMPT_VERSION = 'behavior-analysis-prompt.v1';

const MAX_PROMPT_CHARS = 6000;

/**
 * Build the incremental analysis prompt. NEVER sends full history — only the
 * current trade, its reflection, behavior summaries, and recent evidence, all
 * token-budgeted. Trade facts are backend-computed and labelled authoritative.
 */
export function buildAnalysisPrompt({ trade, behaviorSummaries, recentEvidence }) {
  const metrics = computeTradeMetrics(trade);
  const summary = {
    trade: {
      id: trade.id,
      ticket: trade.ticket ?? null,
      instrument: metrics.instrument,
      buy_sell: metrics.buy_sell,
      lots: metrics.lots,
      pnl: metrics.pnl,
      r_multiple: metrics.r_multiple,
      risk_per_trade: metrics.risk_per_trade,
      mfe: metrics.mfe,
      mae: metrics.mae,
      held: metrics.held,
      time_open: metrics.time_open,
      rules_violated: metrics.rules_violated,
    },
    daily_reflection: (trade.daily_reflection || '').slice(0, 2000),
    existing_behaviors: (behaviorSummaries || []).slice(0, 20).map((b) => ({
      id: b.id,
      name: b.name,
      name_key: b.name_key,
      behavior_type: b.behavior_type,
      status: b.status,
      occurrence_count: b.occurrence_count,
    })),
    recent_evidence: (recentEvidence || []).slice(0, 15).map((e) => ({
      id: e.id,
      behavior_id: e.behavior_id,
      trade_id: e.trade_id,
      reason: e.reason,
      reflection_excerpt: e.reflection_excerpt,
    })),
  };

  const system = [
    'You are A.U.R.A., a trading behavior analyst. Interpret ONE trade and its Daily Reflection and identify any behavioral patterns it demonstrates.',
    '',
    'RULES',
    '- Trade facts below are backend-computed and authoritative. NEVER invent or restate objective statistics (occurrence counts, totals, P&L beyond what is given).',
    '- Base every observation strictly on the trade facts + Daily Reflection + listed existing behaviors/evidence. If a new observation matches an existing behavior, REUSE its exact behavior_name.',
    '- A losing trade can be a GOOD trade (process followed); a winning trade can be a BAD trade (rules broken). Judge behavior/process, NOT outcome.',
    '- Do not use generic categories (discipline, execution, risk, patience). Name the SPECIFIC behavior.',
    '- confidence = how sure you are this behavior is present in THIS trade (0..1), not a success predictor.',
    '',
    'Respond ONLY with JSON, no markdown fences, matching EXACTLY:',
    '{ "observations": [ { "behavior_name": string, "type": "positive"|"negative", "description": string|null, "confidence": number 0..1, "evidence": [ { "trade_id": string, "reason": string|null, "reflection_excerpt": string|null, "confidence": number|null } ] } ] }',
    '',
    'Context:',
  ].join('\n');

  const content = system + '\n' + JSON.stringify(summary);
  return { role: 'system', content: content.slice(0, MAX_PROMPT_CHARS) };
}

/**
 * Recompute a behavior's aggregates from its persisted evidence.
 * Every number here is backend-computed — the LLM never authored it.
 */
export async function recomputeBehavior(store, userId, accountId, behavior, thresholds) {
  const evidenceRows = await store.listEvidence(userId, accountId, { behaviorId: behavior.id, limit: 500 });
  if (evidenceRows.length === 0) return null;

  const occurrenceCount = evidenceRows.length;
  const distinctWeeks = new Set(evidenceRows.map((e) => e.week_start).filter(Boolean)).size;
  const reflectionCount = evidenceRows.filter((e) => (e.reflection_excerpt || '').trim().length > 0).length;

  // Confidence: blend per-evidence confidences, then consistency + recency.
  const confs = evidenceRows.map((e) => Number(e.evidence_confidence) || 0);
  let running = 0;
  for (let i = 0; i < confs.length; i++) {
    running = blendConfidence({ runningConfidence: running, runningCount: i, newEvidenceConf: confs[i] });
  }
  const consistency = consistencyFactor(evidenceRows.map((e) => ({ behavior_type: behavior.behavior_type })), behavior.behavior_type);
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const recency = evidenceRows.length
    ? evidenceRows.reduce((s, e) => s + Math.max(0, 1 - (now - new Date(e.created_at).getTime()) / (180 * DAY)), 0) / evidenceRows.length
    : 1;
  const confidence = Math.round(finalConfidence({ blended: running, consistency, recencyFactor: recency }) * 10000) / 10000;

  // Deterministic lifecycle transition (RESOLVED reactivation included).
  const resolved = resolveIfInactive({ status: behavior.status, lastDetectedAt: behavior.last_detected_at, thresholds });
  const status = computeStatus({
    currentStatus: resolved ?? behavior.status,
    behaviorType: behavior.behavior_type,
    occurrenceCount,
    distinctWeeks,
    reflectionCount,
    confidence,
    thresholds,
  });

  // Impact: Σ P&L / Σ R across evidence metric snapshots (backend facts).
  let totalPnl = 0;
  let totalR = 0;
  for (const e of evidenceRows) {
    const m = e.metrics_snapshot || {};
    totalPnl += Number(m.pnl) || 0;
    totalR += Number(m.r_multiple) || 0;
  }

  const patch = {
    occurrence_count: occurrenceCount,
    confidence,
    status,
    last_detected_at: evidenceRows[0].created_at,
    first_detected_at: behavior.first_detected_at ?? evidenceRows[evidenceRows.length - 1].created_at,
    last_confirmed_at: new Date().toISOString(),
    estimated_impact_pnl: totalPnl,
    estimated_impact_r: totalR,
  };

  await store.updateBehaviorAggregates(userId, accountId, behavior.id, patch);
  return { ...behavior, ...patch };
}
export class AnalysisService {
  constructor({ supabase, provider, tradingData = null, logger = console }) {
    this.supabase = supabase;
    this.provider = provider;
    this.tradingData = tradingData ?? new TradingDataAccess(supabase);
    this.store = new BehaviorStore(supabase, this.tradingData);
    this.jobs = new AnalysisJobStore(supabase);
    this.logger = logger;
    this._processing = false;
  }

  /** Enqueue an analysis job for a newly saved trade (ownership-verified). */
  async enqueueForTrade(userId, accountId, tradeId) {
    const [resolvedId] = await this.tradingData.resolveAccountScope(userId, accountId);
    if (!resolvedId) throw new AccountAccessError(accountId);
    const trade = await this.store.getTrade(userId, resolvedId, tradeId);
    if (!trade) throw new AccountAccessError(tradeId);
    return this.jobs.enqueue(userId, resolvedId, { trigger: 'trade_saved', tradeId });
  }

  /** Enqueue an analysis job for any trigger (weekly/manual). */
  async enqueue(userId, accountId, payload) {
    const [resolvedId] = await this.tradingData.resolveAccountScope(userId, accountId);
    if (!resolvedId) throw new AccountAccessError(accountId);
    return this.jobs.enqueue(userId, resolvedId, payload);
  }

  /** Process one claimed job end-to-end. */
  async processJob(job) {
    const { user_id: userId, account_id: accountId, trade_id: tradeId, id: jobId, trigger } = job;

    if (trigger !== 'weekly' && !tradeId) {
      return this.finishSkip(jobId, 'no linked trade');
    }

    const trade = await this.store.getTrade(userId, accountId, tradeId);
    if (!trade) return this.finishSkip(jobId, 'linked trade no longer exists');

    const reflection = (trade.daily_reflection || '').trim();
    if (trigger !== 'weekly' && reflection.length === 0) {
      return this.finishSkip(jobId, 'empty daily reflection; nothing to interpret');
    }

    // Incremental context — summaries, not full history.
    const behaviorSummaries = await this.store.listBehaviors(userId, accountId, {});
    const recentEvidence = await this.store.listEvidence(userId, accountId, { limit: 40 });
    const prompt = buildAnalysisPrompt({ trade, behaviorSummaries, recentEvidence });

    // Compacted audit snapshot of what was sent (schema contract:
    // ai_analyses.input_summary). Sizes/counts only — never duplicates the
    // reflection text and never stores credentials.
    const inputSummary = {
      trade_id: tradeId,
      ticket: trade.ticket ?? null,
      reflection_chars: reflection.length,
      behavior_summaries: behaviorSummaries.length,
      recent_evidence: recentEvidence.length,
      prompt_chars: prompt.content.length,
    };

    let firstResult;
    try {
      // Reasoning models on Groq (e.g. qwen3.6) reject system-only requests
      // with "No user query found in messages" — always include a user turn.
      firstResult = await this.provider.chat({
        messages: [
          prompt,
          { role: 'user', content: 'Analyze the trade and its Daily Reflection from the context above. Respond ONLY with the JSON observations object.' },
        ],
        json: true,
        temperature: 0.2,
        maxTokens: 1500,
      });
    } catch (err) {
      return this.finishFailure(job, err, 'llm_chat');
    }

    return this.handleResult({ job, trade, prompt, firstAttempt: firstResult, userId, accountId, inputSummary });
  }

  /** Validate output; ONE repair retry; then persist or fail cleanly. */
  async handleResult({ job, trade, prompt, firstAttempt, userId, accountId, inputSummary = null }) {
    const { id: jobId, max_attempts: maxAttempts = 3 } = job;
    let content = typeof firstAttempt?.content === 'string' ? firstAttempt.content.trim() : '';
    if (!content) return this.finishFailure(job, new Error('Empty LLM response'), 'empty_content');

    content = this.stripFences(content);

    let validated;
    try {
      validated = validateAnalysisPayload(content);
    } catch (err) {
      if (!(err instanceof BehaviorValidationError)) throw err;
      // Repair retry — exactly one.
      const repairMsg = buildRepairPrompt(prompt.content, err);
      let repaired;
      try {
        repaired = await this.provider.chat({ messages: [prompt, repairMsg], json: true, temperature: 0.1, maxTokens: 1500 });
      } catch (repairErr) {
        return this.finishFailure(job, repairErr, 'repair_llm_chat');
      }
      const repairedText = this.stripFences(typeof repaired?.content === 'string' ? repaired.content.trim() : '');
      if (!repairedText) return this.finishFailure(job, new Error('Empty repair response'), 'empty_repair');
      try {
        validated = validateAnalysisPayload(repairedText);
      } catch (err2) {
        return this.finishFailure(job, err2, 'repair_invalid');
      }
    }

    try {
      await this.persistObservations({ validated, userId, accountId, trade, jobId });
    } catch (persistErr) {
      // Persistence failure (DB) is NOT transient LLM failure; never requeue.
      this.logger?.error?.('[Behavior] persist error:', persistErr);
      return this.jobs.markFailed(jobId, { error: `persist: ${persistErr?.message || persistErr}`, maxAttempts, progress: 999 })
        .then(() => ({ status: 'failed', jobId, phase: 'persist' }));
    }

    await this.jobs.markDone(jobId, { rawResponse: validated, model: this.provider.model, promptVersion: ANALYSIS_PROMPT_VERSION, inputSummary });
    return { status: 'done', jobId, observations: validated.observations.length };
  }

  stripFences(text) {
    return text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();
  }

  /** Persist validated observations → evidence → recompute aggregates. */
  async persistObservations({ validated, userId, accountId, trade, jobId }) {
    const thresholds = resolveThresholds(await this.store.getBehaviorConfig(userId, accountId));
    const nowIso = new Date().toISOString();

    for (const obs of validated.observations) {
      const nameKey = normalizeBehaviorName(obs.behavior_name);
      if (!nameKey) continue;

      const { behavior } = await this.store.upsertBehavior(userId, accountId, {
        name: obs.behavior_name,
        name_key: nameKey,
        behavior_type: obs.type,
        description: obs.description,
        model: this.provider.model,
      });

      for (const ev of obs.evidence) {
        // Only persist evidence whose trade_id resolves to this account.
        const evidenceTrade = await this.store.getTrade(userId, accountId, ev.trade_id);
        if (!evidenceTrade) continue;
        const metrics = computeTradeMetrics(evidenceTrade);
        await this.store.upsertEvidence(userId, accountId, {
          behavior_id: behavior.id,
          analysis_id: jobId,
          trade_id: evidenceTrade.id,
          trade_ticket: evidenceTrade.ticket ?? null,
          trade_time_open: evidenceTrade.time_open ?? null,
          week_start: this.weekStart(evidenceTrade.time_open || nowIso),
          reflection_excerpt: (ev.reflection_excerpt || evidenceTrade.daily_reflection || '').slice(0, 500),
          reason: (ev.reason || '').slice(0, 600),
          metrics_snapshot: metrics,
          evidence_confidence: evidenceConfidence(ev.confidence ?? obs.confidence),
        });
      }

      // Refresh aggregates + lifecycle for this behavior.
      const fresh = await this.store.getBehavior(userId, accountId, behavior.id);
      if (fresh) await recomputeBehavior(this.store, userId, accountId, fresh, thresholds);
    }
  }

  finishSkip(jobId, reason) {
    return this.jobs.markSkipped(jobId, { reason })
      .then(() => ({ status: 'skipped', jobId, reason }));
  }

  /**
   * Transient LLM failures requeue (attempts tracked); exhausted attempts or
   * non-transient failures mark the job failed. Trade data is never touched.
   */
  async finishFailure(job, err, phase) {
    const maxAttempts = job.max_attempts ?? 3;
    const progress = job.attempts ?? 0;
    const message = `${phase}: ${err?.message || err}`;
    const isTransient =
      err instanceof LLMError ||
      /timeout|rate.?limit|econn|network|5\d\d|fetch/i.test(String(err?.message || ''));

    // Non-transient (invalid schema, no repair left) → fail immediately;
    // transient (rate-limit/timeout/network) → requeue while attempts remain.
    const row = await this.jobs.markFailed(job.id, {
      error: message,
      maxAttempts,
      progress,
      forceFail: !isTransient,
    });
    const final = row?.status === 'failed';
    return {
      status: final ? 'failed' : 'queued',
      jobId: job.id,
      attempts: row?.attempts ?? progress + 1,
      phase,
    };
  }

  weekStart(input) {
    const d = new Date(input);
    const day = (d.getUTCDay() + 6) % 7; // Monday = 0
    d.setUTCDate(d.getUTCDate() - day);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Worker loop: claim up to `batchSize` jobs and process them sequentially.
   * Concurrency-safe claiming prevents duplicate execution across workers.
   * Returns a summary for tests/diagnostics.
   */
  async processNext({ batchSize = 1 } = {}) {
    if (this._processing) return { status: 'busy' };
    this._processing = true;
    try {
      const jobs = await this.jobs.claimNext(null, { batchSize });
      if (jobs.length === 0) return { status: 'idle', processed: 0 };
      const results = [];
      for (const job of jobs) {
        try {
          results.push(await this.processJob(job));
        } catch (err) {
          this.logger?.error?.('[Behavior] job error:', err);
          results.push(await this.finishFailure(job, err, 'unhandled'));
        }
      }
      return { status: 'done', processed: results.length, results };
    } finally {
      this._processing = false;
    }
  }
}