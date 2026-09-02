/**
 * Behavior Engine — Dashboard statistics (BACKEND-COMPUTED ONLY)
 *
 * Derives every number shown on the Trading Behavior Engine dashboard from
 * objective data (trades, behavior aggregates, evidence, analysis jobs). The
 * LLM never invents figures — the hybrid-intelligence rule from stats.js
 * stays in force:
 *
 *   Trading data -> statistical analysis -> behavior detection -> evidence
 *   -> AI interpretation (interpretation only, never fabrication).
 *
 * Functions are deterministic and unit-testable; nothing here calls a provider.
 * Patterns are extracted from the raw trade series (timing, streaks, risk
 * deltas, session windows) — not from free-form "categories".
 */

import {
  computeBaseline,
  diffFromBaseline,
  computeRMultiple,
} from './stats.js';

const round = (v, d = 4) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const p = 10 ** d;
  return Math.round(n * p) / p;
};

/** Monday-start ISO week key for a date input. Mirrors lifecycle.weekStart. */
export function weekStart(input) {
  const d = new Date(input);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const clampScore = (v) => Math.max(0, Math.min(100, Math.round(v)));

/**
 * Deterministic behaviour score derived from the ENGINE's own aggregates
 * (positive/negative estimated R impact across evidence). Returns null when
 * there is not enough reliable evidence to justify a number.
 */
export function computeBehaviorScore(behaviors = [], { asOf = new Date() } = {}) {
  const active = (behaviors || []).filter(
    (b) => b.status !== 'ARCHIVED' && b.status !== 'RESOLVED'
  );
  if (active.length === 0) {
    return { score: null, available: false, reason: 'No behaviors detected yet' };
  }

  let positiveR = 0;
  let negativeR = 0;
  let occurrences = 0;
  const DAY = 24 * 60 * 60 * 1000;
  let recentOccurrences = 0;

  for (const b of active) {
    const occ = Number(b.occurrence_count) || 0;
    occurrences += occ;
    const r = Number(b.estimated_impact_r) || 0;
    let weight = 1;
    if (b.last_detected_at) {
      const ageDays = Math.max(0, (asOf.getTime() - new Date(b.last_detected_at).getTime()) / DAY);
      weight = Math.max(0.2, 1 - ageDays / 180);
    }
    if (b.behavior_type === 'positive') positiveR += Math.min(Math.abs(r), 12) * weight;
    else negativeR += Math.min(Math.abs(r), 12) * weight;
    if (b.last_detected_at) {
      const ageDays = Math.max(0, (asOf.getTime() - new Date(b.last_detected_at).getTime()) / DAY);
      if (ageDays <= 30) recentOccurrences += occ;
    }
  }

  if (occurrences < 2) {
    return { score: null, available: false, reason: 'Not enough data' };
  }

  const raw = 50 + (positiveR - negativeR) * 3.2;
  return {
    score: clampScore(raw),
    available: true,
    reason: 'Derived from behavior engine evidence',
    occurrences,
    recent_occurrences: recentOccurrences,
  };
}

/** Month-delta comparison for the behavior score (30 rolling days). */
export function computeScoreDelta(behaviors = [], now = new Date()) {
  const current = computeBehaviorScore(behaviors, { asOf: now });
  const month = computeBehaviorScore(behaviors, { asOf: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) });
  if (!current.available || !month.available) {
    return { score: current.score, available: current.available, reason: current.reason, delta: null };
  }
  return { score: current.score, available: true, reason: current.reason, delta: current.score - month.score };
}

/** Aggregate a set of trades into comparison-ready stats. */
export function aggregateTrades(trades = []) {
  const rows = Array.isArray(trades) ? trades : [];
  if (rows.length === 0) {
    return {
      trade_count: 0, win_rate: 0, avg_pnl: 0, avg_r_per_trade: 0,
      avg_risk_per_trade: 0, max_loss_streak: 0, total_pnl: 0,
      avg_hold_seconds: 0, avg_entry_delay_min: 0, risk_after_2_wins: 0, risk_normal: 0,
    };
  }
  let wins = 0, riskSum = 0, rSum = 0, pnlSum = 0, lossRun = 0, maxLossRun = 0;
  let holdSum = 0, holdCount = 0;
  let winsRun = 0, afterWinsRiskSum = 0, afterWinsCount = 0;
  let prevCloseMs = null, delaySum = 0, delayCount = 0;
  let normalRiskSum = 0, normalRiskCount = 0;

  const sorted = [...rows].sort((a, b) => parseDate(a.time_open || a.created_at) - parseDate(b.time_open || b.created_at));

  for (const t of sorted) {
    const pnl = Number(t.pnl);
    if (Number.isFinite(pnl)) pnlSum += pnl;
    if (pnl > 0) { wins += 1; winsRun += 1; lossRun = 0; }
    else if (pnl < 0) { lossRun += 1; maxLossRun = Math.max(maxLossRun, lossRun); winsRun = 0; }
    else { winsRun = 0; lossRun = 0; }
    const risk = Number(t.risk_per_trade);
    if (Number.isFinite(risk) && risk > 0) {
      riskSum += risk;
      if (winsRun >= 2) { afterWinsRiskSum += risk; afterWinsCount += 1; }
      else { normalRiskSum += risk; normalRiskCount += 1; }
      if (Number.isFinite(pnl)) rSum += pnl / risk;
    }
    const open = parseDate(t.time_open);
    const close = parseDate(t.time_close);
    if (open && close) { holdSum += Math.max(0, close - open) / 1000; holdCount += 1; } // ms → s
    if (open && prevCloseMs !== null) { delaySum += Math.max(0, open - prevCloseMs); delayCount += 1; }
    if (close !== null) prevCloseMs = close;
  }

  const n = rows.length;
  const riskTrades = sorted.filter((t) => Number.isFinite(Number(t.risk_per_trade)) && Number(t.risk_per_trade) > 0).length;
  return {
    trade_count: n,
    win_rate: round(n ? wins / n : 0, 4),
    avg_pnl: round(n ? pnlSum / n : 0, 2),
    avg_r_per_trade: round(riskSum ? rSum / riskTrades : 0, 4),
    avg_risk_per_trade: round(n ? riskSum / n : 0, 2),
    max_loss_streak: maxLossRun,
    total_pnl: round(pnlSum, 2),
    avg_hold_seconds: holdCount ? Math.round(holdSum / holdCount) : 0,
    avg_entry_delay_min: delayCount ? round(delaySum / delayCount / 60000, 1) : 0,
    risk_after_2_wins: afterWinsCount ? round(afterWinsRiskSum / afterWinsCount, 2) : 0,
    risk_after_2_wins_n: afterWinsCount,
    risk_normal: normalRiskCount ? round(normalRiskSum / normalRiskCount, 2) : 0,
    risk_normal_n: normalRiskCount,
  };
}

/** Week view: current ISO week vs the previous 7 days (comparable window). */
export function computeWeekView(trades = [], now = new Date()) {
  const rows = Array.isArray(trades) ? trades : [];
  const thisWeekStart = weekStart(now);
  const prevWeekStart = addDays(thisWeekStart, -7);
  const thisWeekEnd = weekStart(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));

  const inWindow = (t, start, end) => {
    const o = normTs(t.time_open || t.created_at);
    if (!o) return false;
    const d = o.slice(0, 10);
    return d >= start && d < end;
  };

  const currentTrades = rows.filter((t) => inWindow(t, thisWeekStart, thisWeekEnd));
  const previousTrades = rows.filter((t) => inWindow(t, prevWeekStart, thisWeekStart));
  const current = aggregateTrades(currentTrades);
  const previous = aggregateTrades(previousTrades);
  const changes = diffFromBaseline(previous, current);
  const extraChanges = {
    avg_hold_seconds: { current: current.avg_hold_seconds, previous: previous.avg_hold_seconds, delta: current.avg_hold_seconds - previous.avg_hold_seconds },
    avg_entry_delay_min: { current: current.avg_entry_delay_min, previous: previous.avg_entry_delay_min, delta: round(current.avg_entry_delay_min - previous.avg_entry_delay_min, 1) },
    risk_after_2_wins: { current: current.risk_after_2_wins, previous: previous.risk_after_2_wins, delta: round(current.risk_after_2_wins - previous.risk_after_2_wins, 2) },
    risk_normal: { current: current.risk_normal, previous: previous.risk_normal },
  };

  return {
    week_start: thisWeekStart,
    week_end: addDays(thisWeekStart, 6),
    current,
    previous,
    changes,
    extra_changes: extraChanges,
    has_week_trades: currentTrades.length > 0,
    has_previous_trades: previousTrades.length > 0,
  };
}

// ─── Deterministic PATTERNS extracted from the raw trade series ────────────

export function sessionKey(hour) {
  if (hour < 7) return 'asia';
  if (hour < 12) return 'london';
  if (hour < 17) return 'new_york';
  return 'late';
}

export const SESSION_LABELS = {
  asia: 'Asia session', london: 'London open', new_york: 'New York open', late: 'Late / US close',
};

function parseDate(v) {
  if (!v) return null;
  const d = new Date(normTs(v) ?? v);
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}

/**
 * Normalize a DB timestamp to an ISO string the engine can slice/parse
 * deterministically. trades.time_open is `timestamp without time zone`
 * (e.g. "2026-08-28 10:00:00"); JS would parse that as LOCAL time, which
 * shifts week boundaries and session attribution between machines. We treat
 * engine timestamps as UTC throughout for consistent aggregation.
 */
export function normTs(v) {
  if (!v) return null;
  const s = String(v).trim().replace(' ', 'T');
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) return s;
  return `${s}Z`;
}

/**
 * Extract observable patterns from the chronological trade series.
 * Every number is backend-computed from the trades themselves.
 */
export function computePatterns(trades = [], { reentryWindowMin = 30 } = {}) {
  const rows = Array.isArray(trades) ? trades : [];
  const sorted = [...rows].sort((a, b) => parseDate(a.time_open || a.created_at || 0) - parseDate(b.time_open || b.created_at || 0));
  if (sorted.length === 0) return [];

  const patterns = [];
  const isLoss = (t) => Number(t.pnl) < 0;
  const isWin = (t) => Number(t.pnl) > 0;
  const risk = (t) => Math.abs(Number(t.risk_per_trade) || 0);

  // 1. Post-loss re-entry — re-entered <= N min after a losing trade closed.
  const reentries = [];
  const normalDelays = [];
  let prevClose = null;
  for (const t of sorted) {
    const open = parseDate(t.time_open);
    if (open !== null && prevClose !== null) normalDelays.push((open - prevClose) / 60000);
    const close = parseDate(t.time_close);
    if (close !== null) prevClose = close;
  }
  for (let i = 1; i < sorted.length; i += 1) {
    const prior = sorted[i - 1];
    const cur = sorted[i];
    if (!isLoss(prior)) continue;
    const priorClose = parseDate(prior.time_close);
    const curOpen = parseDate(cur.time_open);
    if (priorClose === null || curOpen === null) continue;
    const delayMin = (curOpen - priorClose) / 60000;
    if (delayMin >= 0 && delayMin <= reentryWindowMin) {
      reentries.push({
        previous_pnl: Number(prior.pnl) || 0,
        delay_min: round(delayMin, 1),
        result_pnl: Number(cur.pnl) || 0,
        result_r: computeRMultiple(cur),
        ticket: cur.ticket ?? null,
        time_open: cur.time_open ?? null,
        instrument: cur.instrument ?? null,
        lot: Number(cur.lots) || 0,
        prior_ticket: prior.ticket ?? null,
        prior_time_close: prior.time_close ?? null,
      });
    }
  }
  if (reentries.length > 0) {
    const avgDelay = reentries.reduce((s, r) => s + r.delay_min, 0) / reentries.length;
    const avgResult = reentries.reduce((s, r) => s + r.result_pnl, 0) / reentries.length;
    const normalAvg = normalDelays.length ? normalDelays.reduce((a, b) => a + b, 0) / normalDelays.length : null;
    patterns.push({
      id: 'post_loss_reentry',
      title: 'Rapid re-entry after a loss',
      direction: 'negative',
      occurrences: reentries.length,
      description: `Re-entered a new trade within ${reentryWindowMin} minutes of a losing trade closing. Average re-entry delay ${round(avgDelay, 1)}m; average next-trade result ${round(avgResult, 2)} USD.`,
      detail: {
        window_min: reentryWindowMin,
        avg_delay_min: round(avgDelay, 1),
        normal_delay_min: normalAvg !== null ? round(normalAvg, 1) : null,
        avg_result_pnl: round(avgResult, 2),
        avg_result_r: round(reentries.reduce((s, r) => s + r.result_r, 0) / reentries.length, 3),
      },
      evidence: reentries.slice(0, 8),
    });
  }
  // 2. Loss streaks — consecutive losing trades.
  let streakLen = 0;
  let streakStart = 0;
  const lossStreaks = [];
  for (let i = 0; i < sorted.length; i += 1) {
    if (isLoss(sorted[i])) {
      if (streakLen === 0) streakStart = i;
      streakLen += 1;
    } else if (streakLen > 0) {
      lossStreaks.push(sorted.slice(streakStart, streakStart + streakLen));
      streakLen = 0;
    }
  }
  if (streakLen > 0) lossStreaks.push(sorted.slice(streakStart));
  const longStreaks = lossStreaks.filter((s) => s.length >= 2);
  if (longStreaks.length > 0) {
    const maxStreak = Math.max(...longStreaks.map((s) => s.length));
    const streakPnl = longStreaks.reduce((sum, s) => sum + s.reduce((a, t) => a + (Number(t.pnl) || 0), 0), 0);
    const totalTrades = longStreaks.reduce((sum, s) => sum + s.length, 0);
    const avgR = totalTrades ? longStreaks.reduce((sum, s) => sum + s.reduce((a, t) => a + computeRMultiple(t), 0), 0) / totalTrades : 0;
    patterns.push({
      id: 'loss_streaks',
      title: 'Consecutive losing streaks',
      direction: 'negative',
      occurrences: longStreaks.length,
      description: `${longStreaks.length} losing streak(s) of 2+ trades (longest ${maxStreak}). Combined P&L across streak trades ${round(streakPnl, 2)} USD, average ${round(avgR, 3)}R per streak trade.`,
      detail: { count: longStreaks.length, max_streak: maxStreak, total_pnl: round(streakPnl, 2), avg_r: round(avgR, 3) },
      evidence: longStreaks.slice(-3).map((s) => s.map((t) => ({
        ticket: t.ticket ?? null,
        time_open: t.time_open ?? null,
        pnl: Number(t.pnl) || 0,
        r: computeRMultiple(t),
        instrument: t.instrument ?? null,
        lots: Number(t.lots) || 0,
      }))),
    });
  }
  // 3. Session attribution.
  const bySession = {};
  const sessionPnL = {};
  for (const t of sorted) {
    const o = parseDate(t.time_open);
    if (o === null) continue;
    const s = sessionKey(new Date(o).getUTCHours());
    bySession[s] = (bySession[s] || 0) + 1;
    sessionPnL[s] = (sessionPnL[s] || 0) + (Number(t.pnl) || 0);
  }
  const sessionRows = Object.entries(bySession)
    .map(([k, count]) => ({ session: k, label: SESSION_LABELS[k], trades: count, pnl: round(sessionPnL[k], 2) }))
    .sort((a, b) => b.pnl - a.pnl);
  if (sessionRows.length > 0) {
    const best = sessionRows[0];
    const worst = sessionRows[sessionRows.length - 1];
    patterns.push({
      id: 'sessions',
      title: 'Strongest / weakest trading session',
      direction: 'neutral',
      occurrences: sessionRows.length,
      description: `Best performing session: ${best.label} (${best.trades} trades, ${best.pnl > 0 ? '+' : ''}${best.pnl} USD P&L). Weakest: ${worst.label} (${worst.trades} trades, ${worst.pnl > 0 ? '+' : ''}${worst.pnl} USD P&L).`,
      detail: { sessions: sessionRows },
      evidence: sessionRows,
    });
  }

  // 4. Risk after quick winning re-entries (re-entered a new trade within the
  //    window after a winning trade closed). Compared against the typical risk
  //    of ALL winning trades so the delta is meaningful.
  let winRun = 0;
  let postWinRisk = [];
  let allWinRisk = [];
  let priorCloseMs = null;
  for (const t of sorted) {
    const open = parseDate(t.time_open);
    if (open !== null && priorCloseMs !== null) {
      const delayMin = (open - priorCloseMs) / 60000;
      if (delayMin >= 0 && delayMin <= reentryWindowMin && isWin(t)) {
        postWinRisk.push({ risk: risk(t), r: computeRMultiple(t), delay_min: round(delayMin, 1), instrument: t.instrument ?? null });
      }
    }
    if (isWin(t)) { winRun += 1; allWinRisk.push(risk(t)); }
    else winRun = 0;
    const close = parseDate(t.time_close);
    if (close !== null) priorCloseMs = close;
  }
  if (postWinRisk.length > 0) {
    const avgRisk = postWinRisk.reduce((s, x) => s + x.risk, 0) / postWinRisk.length;
    const avgR = postWinRisk.reduce((s, x) => s + x.r, 0) / postWinRisk.length;
    const typicalRisk = allWinRisk.length ? allWinRisk.reduce((a, b) => a + b, 0) / allWinRisk.length : avgRisk;
    patterns.push({
      id: 'risk_after_win',
      title: 'Risk after quick winning re-entries',
      direction: 'neutral',
      occurrences: postWinRisk.length,
      description: `Quick re-entries after a win averaged ${round(avgRisk, 2)}R risk vs a typical ${round(typicalRisk, 2)}R; average result ${round(avgR, 3)}R.`,
      detail: { avg_risk: round(avgRisk, 2), avg_r: round(avgR, 3), typical_risk: round(typicalRisk, 2) },
      evidence: postWinRisk.slice(0, 8),
    });
  }

  return patterns;
}

/**
 * TRUE DATA STATES — deterministic engine status and AI-layer status, reported
 * SEPARATELY so deterministic analytics are never hidden behind LLM
 * availability.
 *
 *   engine_status (from actual trade data only):
 *     needs_more_data  ← NO TRADES / NOT ENOUGH TRADES (< 3 closed)
 *     analyzing        ← a backend job is in-flight (deterministic or AI)
 *     learning         ← trades available; engine deriving behaviors
 *   ai_status (interpretation layer, asynchronous):
 *     not_requested  ← no interpretation queued yet
 *     analyzing      ← interpretation job queued/running
 *     available      ← at least one interpretation completed
 *     unavailable    ← the most recent interpretation failed
 *
 * Pure + unit-testable; nothing here calls the provider.
 */
export function computeEngineStates({ trades = [], analyses = [] } = {}) {
  const rows = Array.isArray(trades) ? trades : [];
  const closed = rows.filter((t) => t.time_close);
  const analysisRows = Array.isArray(analyses) ? analyses : [];
  const hasQueued = analysisRows.some((a) => a.status === 'queued' || a.status === 'running');
  const doneAnalyses = analysisRows.filter((a) => a.status === 'done').length;
  const lastAnalysis = analysisRows[0] || null;

  let engine_status;
  if (rows.length === 0 || closed.length < 3) engine_status = 'needs_more_data';
  else if (hasQueued) engine_status = 'analyzing';
  else engine_status = 'learning';

  const ai_status = hasQueued ? 'analyzing'
    : lastAnalysis?.status === 'failed' ? 'unavailable'
    : doneAnalyses > 0 ? 'available'
    : 'not_requested';

  return {
    engine_status,
    ai_status,
    closed_trades: closed.length,
    analysis_count_done: doneAnalyses,
    has_queued: hasQueued,
  };
}