/**
 * Behavior Engine — Weekly Brief Service
 *
 * Generates the "THIS WEEK" trading brief for an account:
 *   🔥 Trading Brief      (LLM narrative over backend-computed facts)
 *   🔄 What Changed?      (pure backend baseline diff)
 *   ⚠️ Behavior Alerts    (from behavior_alerts, anti-spam)
 *   👀 Emerging Behaviors (DETECTED/EMERGING rows)
 *   💸 Biggest Leak This Week / 🟢 Strongest Behavior This Week
 *
 * PERSISTENCE: cached per (account_id, week_start) via trading_briefs. A page
 * load NEVER regenerates; regeneration happens only when new evidence landed
 * after the brief was generated (stale check) or on explicit force.
 *
 * HYBRID SPLIT: backend computes ALL numbers (week stats, baseline diff,
 * leak/edge ranking from evidence impact). The LLM only writes the narrative
 * and the focus sentence — it is given the numbers and forbidden to invent
 * any others (validated by the strict schema below).
 */

import { resolveThresholds } from './thresholds.js';
import { computeBehaviorImpact, computeBaseline, diffFromBaseline } from './stats.js';
import { BehaviorValidationError } from './schema.js';

export const BRIEF_PROMPT_VERSION = 'trading-brief-prompt.v1';

export class BriefValidationError extends BehaviorValidationError {}

/** Validate the LLM brief payload: narrative + focus ONLY. */
export function validateBriefPayload(raw) {
  let payload = raw;
  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new BriefValidationError('Brief output is not valid JSON.');
    }
  }
  if (!payload || typeof payload !== 'object') {
    throw new BriefValidationError('Brief output must be a JSON object.');
  }

  const brief = typeof payload.brief === 'string' && payload.brief.trim()
    ? payload.brief.trim().slice(0, 2000)
    : null;
  if (!brief) throw new BriefValidationError('brief: required non-empty string');

  const focus = typeof payload.focus === 'string' && payload.focus.trim()
    ? payload.focus.trim().slice(0, 500)
    : null;

  const FORBIDDEN = ['occurrence_count', 'total_pnl', 'win_rate', 'impact_score', 'what_changed', 'biggest_leak', 'strongest_behavior', 'alerts'];
  for (const key of FORBIDDEN) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      throw new BriefValidationError(`Brief output must NOT contain backend-computed field "${key}".`);
    }
  }

  return { brief, focus };
}

/**
 * BriefService — persistence + cache layer for trading_briefs.
 */
export class BriefService {
  constructor(supabase, tradingData) {
    this.supabase = supabase;
    this.tradingData = tradingData;
  }

  async resolveAccountId(userId, accountId) {
    const ids = await this.tradingData.resolveAccountScope(userId, accountId);
    return ids[0];
  }

  /** Persist the generated brief (upsert on account_id + week_start). */
  async saveBrief(userId, accountId, weekStart, payload, { model = null, promptVersion = null } = {}) {
    const resolved = await this.resolveAccountId(userId, accountId);
    const { data, error } = await this.supabase
      .from('trading_briefs')
      .upsert(
        {
          user_id: userId,
          account_id: resolved,
          week_start: weekStart,
          week_end: BriefService.weekEnd(weekStart),
          payload,
          model,
          prompt_version: promptVersion,
          generated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id,week_start' }
      )
      .select()
      .single();
    if (error) throw new Error(`brief save failed: ${error.message}`);
    return data;
  }

  /** Cached brief for the account's current week (or a given week). */
  async getBrief(userId, accountId, weekStart = null) {
    const resolved = await this.resolveAccountId(userId, accountId);
    if (!resolved) return null;
    const ws = weekStart ?? BriefService.currentWeekStart();
    const { data, error } = await this.supabase
      .from('trading_briefs')
      .select('*')
      .eq('user_id', userId)
      .eq('account_id', resolved)
      .eq('week_start', ws)
      .maybeSingle();
    if (error) throw new Error(`brief lookup failed: ${error.message}`);
    return data;
  }

  /**
   * A cached brief is stale when evidence/alerts landed after it was
   * generated (regeneration signal — the brief itself stays usable).
   */
  async isStale(userId, accountId, brief) {
    if (!brief?.generated_at) return true;
    const resolved = await this.resolveAccountId(userId, accountId);
    if (!resolved) return true;

    const ev = await this.supabase
      .from('behavior_evidence')
      .select('id')
      .eq('user_id', userId)
      .eq('account_id', resolved)
      .gte('created_at', brief.generated_at)
      .limit(1);
    if (!ev.error && (ev.data || []).length > 0) return true;

    const al = await this.supabase
      .from('behavior_alerts')
      .select('id')
      .eq('user_id', userId)
      .eq('account_id', resolved)
      .gte('created_at', brief.generated_at)
      .limit(1);
    if (!al.error && (al.data || []).length > 0) return true;

    return false;
  }

  static currentWeekStart(now = new Date()) {
    const d = new Date(now);
    const day = (d.getUTCDay() + 6) % 7; // Monday = 0
    d.setUTCDate(d.getUTCDate() - day);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }

  static weekEnd(weekStart) {
    const d = new Date(weekStart + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().slice(0, 10);
  }
}

/**
 * BriefComposer — computes objective week facts (backend-only), then asks the
 * LLM for the narrative + focus, validates, and persists. Ollama-down degrades
 * to the cached brief; the dashboard never breaks.
 */
export class BriefComposer {
  constructor(supabase, tradingData, provider, logger = console) {
    this.supabase = supabase;
    this.tradingData = tradingData;
    this.provider = provider;
    this.briefs = new BriefService(supabase, tradingData);
    this.logger = logger;
  }

  /** Get-or-generate. Returns { brief, generated, reason }. */
  async getOrGenerate(userId, accountId, { force = false } = {}) {
    const ws = BriefService.currentWeekStart();
    const cached = await this.briefs.getBrief(userId, accountId, ws);
    const stale = cached ? await this.briefs.isStale(userId, accountId, cached) : true;

    if (cached && !force && !stale) {
      return { brief: cached, generated: false, reason: 'cached' };
    }

    try {
      const facts = await this.computeWeekFacts(userId, accountId, ws);
      const interpreted = await this.interpret(userId, accountId, facts);
      const payload = {
        trading_brief: interpreted.brief,
        focus: interpreted.focus,
        biggest_leak: facts.biggest_leak_week ?? facts.biggest_leak_overall,
        strongest_behavior: facts.strongest_week ?? facts.strongest_overall,
        what_changed: facts.what_changed,
        emerging_behaviors: facts.emerging,
        alerts: facts.alerts,
        week_stats: facts.week_stats,
        computed_by: 'backend', // audit marker: all numbers are backend facts
      };
      const row = await this.briefs.saveBrief(userId, accountId, ws, payload, {
        model: this.provider.model,
        promptVersion: BRIEF_PROMPT_VERSION,
      });
      return { brief: row, generated: true, reason: cached ? 'stale-regenerated' : 'generated' };
    } catch (err) {
      this.logger?.error?.('[Behavior] brief generation failed:', err?.message || err);
      if (cached) return { brief: cached, generated: false, reason: 'provider-failed-cached' };
      return { brief: null, generated: false, reason: `provider-failed: ${err?.message || err}` };
    }
  }

  /**
   * LLM interpretation. Receives ONLY backend-computed facts; the prompt
   * forbids inventing statistics; output validated by validateBriefPayload.
   */
  async interpret(userId, accountId, facts) {
    const system = [
      'You are A.U.R.A., a trading behavior coach. Write the weekly Trading Brief for the account.',
      '',
      'RULES',
      '- Every number you need is provided below as backend-computed facts. NEVER invent or change any statistic. Do not output numbers outside the narrative except by referencing the given facts.',
      '- Judge behavior/process, not outcome: a losing week can reflect GOOD process if the plan was followed; a winning week can hide bad process.',
      '- The brief should answer: what do I need to know before I trade this week? Reference the biggest leak, the strongest behavior, and the "what changed" deviations.',
      '- Do not use generic categories (discipline/execution/risk/patience). Name the SPECIFIC behaviors from the facts.',
      '- Keep the brief under 180 words, direct and specific.',
      '',
      'Respond ONLY with JSON, no markdown fences, matching EXACTLY:',
      '{ "brief": string, "focus": string }',
      '',
      'Facts:',
    ].join('\n');

    const content = system + '\n' + JSON.stringify({
      week_start: facts.week_start,
      week_end: facts.week_end,
      week_stats: facts.week_stats,
      what_changed: facts.what_changed,
      biggest_leak: facts.biggest_leak_week ?? facts.biggest_leak_overall,
      strongest_behavior: facts.strongest_week ?? facts.strongest_overall,
      emerging_behaviors: facts.emerging,
      alerts: (facts.alerts || []).map((a) => ({ type: a.alert_type, severity: a.severity, message: a.message })),
    });

    // Reasoning models on Groq (e.g. qwen3.6) reject system-only requests with
    // "No user query found in messages" — always include a user turn.
    const first = await this.provider.chat({
      messages: [
        { role: 'system', content: content.slice(0, 6000) },
        { role: 'user', content: 'Generate the weekly Trading Brief now. Respond ONLY with the JSON object { "brief": string, "focus": string }.' },
      ],
      json: true,
      temperature: 0.3,
      maxTokens: 700,
    });
    let text = typeof first?.content === 'string' ? first.content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim() : '';
    if (!text) throw new Error('Empty brief response');
    try {
      return validateBriefPayload(text);
    } catch (err) {
      if (!(err instanceof BriefValidationError)) throw err;
      // One repair retry.
      const repair = await this.provider.chat({
        messages: [
          { role: 'system', content: content.slice(0, 6000) },
          { role: 'user', content: `Your previous response was rejected: ${err.message}. Return ONLY {"brief": string, "focus": string}.` },
        ],
        json: true,
        temperature: 0.1,
        maxTokens: 700,
      });
      text = typeof repair?.content === 'string' ? repair.content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim() : '';
      if (!text) throw new Error('Empty repair brief response');
      return validateBriefPayload(text);
    }
  }

  /** Compute ALL objective facts for the week (backend-only numbers). */
  async computeWeekFacts(userId, accountId, weekStart) {
    const resolved = await this.tradingData.resolveAccountScope(userId, accountId);
    const accountId0 = resolved[0];
    const weekEnd = BriefService.weekEnd(weekStart);

    const { data: weekTrades, error: wtErr } = await this.supabase
      .from('trades')
      .select('id, ticket, instrument, pnl, risk_per_trade, time_open, time_close, daily_reflection')
      .eq('account_id', accountId0)
      .gte('time_open', `${weekStart}T00:00:00Z`)
      .lte('time_open', `${weekEnd}T23:59:59Z`)
      .order('time_open', { ascending: true });
    if (wtErr) throw new Error(`week trades failed: ${wtErr.message}`);

    const { data: histTrades, error: htErr } = await this.supabase
      .from('trades')
      .select('id, pnl, risk_per_trade, time_open')
      .eq('account_id', accountId0)
      .lt('time_open', `${weekStart}T00:00:00Z`)
      .order('time_open', { ascending: false })
      .limit(200);
    if (htErr) throw new Error(`history failed: ${htErr.message}`);

    const { data: behaviors, error: bErr } = await this.supabase
      .from('behaviors')
      .select('*, evidence:behavior_evidence(id, metrics_snapshot, created_at, trade_id)')
      .eq('user_id', userId)
      .eq('account_id', accountId0)
      .in('status', ['DETECTED', 'EMERGING', 'RECURRING', 'ESTABLISHED', 'RULE_CANDIDATE']);
    if (bErr) throw new Error(`behaviors failed: ${bErr.message}`);

    const analyzed = (behaviors || []).filter((b) => (b.evidence || []).length > 0);
    const toScored = (b) => ({ id: b.id, name: b.name, status: b.status, confidence: b.confidence, impact: computeBehaviorImpact(b.evidence) });

    const leaksOverall = analyzed
      .filter((b) => b.behavior_type === 'negative')
      .map(toScored)
      .filter((b) => b.impact.impact_score < 0)
      .sort((a, b) => a.impact.impact_score - b.impact.impact_score);
    const edgesOverall = analyzed
      .filter((b) => b.behavior_type === 'positive')
      .map(toScored)
      .filter((b) => b.impact.impact_score > 0)
      .sort((a, b) => b.impact.impact_score - a.impact.impact_score);

    // "This week" extremes: behaviors with evidence created inside the week.
    const weekEvidence = analyzed.map((b) => ({
      ...b,
      week_evidence: (b.evidence || []).filter((e) => {
        if (!e.created_at) return false;
        const d = new Date(e.created_at).toISOString().slice(0, 10);
        return d >= weekStart && d <= weekEnd;
      }),
    })).filter((b) => b.week_evidence.length > 0);

    const emerging = (behaviors || [])
      .filter((b) => ['DETECTED', 'EMERGING'].includes(b.status))
      .map((b) => ({ id: b.id, name: b.name, type: b.behavior_type, status: b.status, confidence: b.confidence, occurrences: b.occurrence_count }));

    const { data: alerts, error: aErr } = await this.supabase
      .from('behavior_alerts')
      .select('id, alert_type, severity, message, created_at')
      .eq('user_id', userId)
      .eq('account_id', accountId0)
      .gte('created_at', `${weekStart}T00:00:00Z`)
      .order('created_at', { ascending: false })
      .limit(10);
    if (aErr) throw new Error(`alerts failed: ${aErr.message}`);

    const baseline = computeBaseline(histTrades || []);
    const weekAgg = BriefComposer.aggregateWeek(weekTrades || []);

    return {
      week_start: weekStart,
      week_end: weekEnd,
      week_stats: weekAgg,
      what_changed: diffFromBaseline(baseline, weekAgg),
      biggest_leak_week: BriefComposer.pickWeekExtreme(weekEvidence, 'negative'),
      strongest_week: BriefComposer.pickWeekExtreme(weekEvidence, 'positive'),
      biggest_leak_overall: leaksOverall[0] ?? null,
      strongest_overall: edgesOverall[0] ?? null,
      emerging,
      alerts: alerts || [],
    };
  }

  static aggregateWeek(trades) {
    if (trades.length === 0) {
      return { trade_count: 0, win_rate: 0, avg_pnl: 0, avg_risk_per_trade: 0, avg_r_per_trade: 0, max_loss_streak: 0 };
    }
    let wins = 0;
    let riskSum = 0;
    let rSum = 0;
    let lossRun = 0;
    let maxLossRun = 0;
    const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
    for (const t of trades) {
      const pnl = Number(t.pnl);
      if (pnl > 0) { wins++; lossRun = 0; } else if (pnl < 0) { lossRun++; maxLossRun = Math.max(maxLossRun, lossRun); }
      const risk = Number(t.risk_per_trade);
      if (Number.isFinite(risk) && risk !== 0) riskSum += Math.abs(risk);
      if (Number.isFinite(risk) && risk !== 0 && Number.isFinite(pnl)) rSum += pnl / Math.abs(risk);
    }
    const n = trades.length;
    return {
      trade_count: n,
      win_rate: round(wins / n),
      avg_pnl: round(trades.reduce((s, t) => s + (Number(t.pnl) || 0), 0) / n),
      avg_risk_per_trade: round(riskSum / n, 2),
      avg_r_per_trade: round(rSum / n),
      max_loss_streak: maxLossRun,
    };
  }

  static pickWeekExtreme(weekEvidence, type) {
    const rows = weekEvidence.filter((b) => b.behavior_type === type);
    if (rows.length === 0) return null;
    const scored = rows.map((b) => ({ id: b.id, name: b.name, status: b.status, confidence: b.confidence, impact: computeBehaviorImpact(b.week_evidence) }));
    scored.sort((a, b) => (type === 'negative' ? a.impact.impact_score - b.impact.impact_score : b.impact.impact_score - a.impact.impact_score));
    return scored[0];
  }
}