/**
 * Behavior Engine — objective statistics (BACKEND-COMPUTED ONLY)
 *
 * Per the hybrid-intelligence rule: the LLM NEVER invents numbers. Every
 * occurrence count, P&L, R-multiple, timestamp, recurrence and impact figure
 * flows through these pure functions. The LLM only interprets what these
 * numbers mean.
 *
 * All functions are deterministic and unit-testable. Input rows come from the
 * database (trades / behavior_evidence). Nothing here touches the network.
 */

const round = (v, d = 4) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const p = 10 ** d;
  return Math.round(n * p) / p;
};

/** R-multiple from trade pnl and risk_per_trade (risk = 0 → 0, undefined). */
export function computeRMultiple(trade) {
  const pnl = Number(trade?.pnl);
  const risk = Number(trade?.risk_per_trade);
  if (!Number.isFinite(pnl) || !Number.isFinite(risk) || risk === 0) return 0;
  return round(pnl / Math.abs(risk));
}

/**
 * Objective trade metrics at analysis time — persisted into
 * behavior_evidence.metrics_snapshot. Purely factual.
 */
export function computeTradeMetrics(trade) {
  const r = computeRMultiple(trade);
  return {
    pnl: round(trade?.pnl),
    r_multiple: r,
    risk_per_trade: round(trade?.risk_per_trade, 2),
    instrument: trade?.instrument ?? null,
    buy_sell: trade?.buy_sell ?? null,
    lots: round(trade?.lots, 2),
    mfe: Number.isFinite(Number(trade?.mfe)) ? round(trade.mfe) : null,
    mae: Number.isFinite(Number(trade?.mae)) ? round(trade.mae) : null,
    held: trade?.held ?? null,
    time_open: trade?.time_open ?? null,
    trade_type: r > 0 ? 'win' : r < 0 ? 'loss' : 'scratch',
    rules_violated: trade?.rules_violated || null,
  };
}

/**
 * Aggregate impact of a behavior from its evidence rows (evidence.metrics_snapshot).
 * Rank-ready: combines frequency + P&L + R + recency — NOT frequency alone.
 *
 * @param {Array<object>} evidenceRows each with { metrics_snapshot, created_at }
 * @param {string} [asOfISO] ISO timestamp used for recency normalization
 */
export function computeBehaviorImpact(evidenceRows, asOfISO = new Date().toISOString()) {
  const rows = Array.isArray(evidenceRows) ? evidenceRows : [];
  const asOf = new Date(asOfISO).getTime();

  let totalPnl = 0;
  let totalR = 0;
  let wins = 0;
  let losses = 0;
  let scratches = 0;
  let summedRisk = 0;
  let recencyScore = 0;
  const DAY = 24 * 60 * 60 * 1000;

  for (const row of rows) {
    const m = row?.metrics_snapshot || {};
    const r = Number(m.r_multiple) || 0;
    totalPnl += Number(m.pnl) || 0;
    totalR += r;
    summedRisk += Number(m.risk_per_trade) || 0;
    if (r > 0) wins++;
    else if (r < 0) losses++;
    else scratches++;

    const created = row?.created_at ? new Date(row.created_at).getTime() : asOf;
    const ageDays = Math.max(0, (asOf - created) / DAY);
    // recency weight: 1.0 today → 0 near the 90-day horizon.
    recencyScore += Math.max(0, 1 - ageDays / 90);
  }

  const n = rows.length;
  const winRate = n ? wins / n : 0;
  // Leak/edge score — negative behaviors amplify negative P&L; positive boost.
  const magnitude = Math.sqrt(totalR ** 2 + (n ** 2) / 4);
  const direction = totalR >= 0 ? 1 : -1;
  const recencyNormalized = n ? recencyScore / n : 0;
  const score = round((magnitude / (n + 1)) * direction * (0.5 + 0.5 * recencyNormalized), 4);

  return {
    occurrence_count: n,
    total_pnl: round(totalPnl),
    total_r: round(totalR, 4),
    avg_r_per_trade: n ? round(totalR / n, 4) : 0,
    win_count: wins,
    loss_count: losses,
    scratch_count: scratches,
    win_rate: round(winRate, 4),
    total_risk: round(summedRisk, 2),
    recency_score: round(recencyNormalized, 4),
    // Composite used to RANK leaks/edges (backend fact, not AI).
    impact_score: score,
  };
}

/**
 * Historical baseline of a trading account.
 * @param {Array<object>} tradesLimit trades in the window
 */
export function computeBaseline(tradesLimit) {
  const rows = Array.isArray(tradesLimit) ? tradesLimit : [];
  if (rows.length === 0) return null;

  const pnlValues = [];
  let riskSum = 0;
  let rSum = 0;
  let lossRun = 0;
  let maxLossRun = 0;

  for (const t of rows) {
    const pnl = Number(t.pnl);
    if (Number.isFinite(pnl)) pnlValues.push(pnl);
    const risk = Number(t.risk_per_trade);
    if (Number.isFinite(risk)) riskSum += Math.abs(risk);
    rSum += computeRMultiple(t);
    if (pnl < 0) { lossRun++; maxLossRun = Math.max(maxLossRun, lossRun); }
    else lossRun = 0;
  }

  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const mean = pnlValues.length ? avg(pnlValues) : 0;
  const variance = pnlValues.length
    ? pnlValues.reduce((a, b) => a + (b - mean) ** 2, 0) / pnlValues.length
    : 0;

  return {
    trade_count: rows.length,
    win_rate: rows.length ? rows.filter((t) => Number(t.pnl) > 0).length / rows.length : 0,
    avg_pnl: round(mean),
    pnl_stddev: round(Math.sqrt(variance)),
    avg_risk_per_trade: round(riskSum / rows.length, 2),
    avg_r_per_trade: round(rSum / rows.length, 4),
    max_loss_streak: maxLossRun,
  };
}

/**
 * Objective "What Changed?" diff between a baseline and current-week stats.
 * Returns deviations (absolute + relative). Null means "no comparable data".
 */
export function diffFromBaseline(baseline, current) {
  if (!baseline || !current) return null;
  const pct = (name) => {
    const c = Number(current[name]);
    const b = Number(baseline[name]);
    if (b === 0) return c === 0 ? 0 : null; // baseline zero → undefined ratio
    return round((c - b) / Math.abs(b), 4);
  };
  return {
    trade_count: { current: current.trade_count, baseline: baseline.trade_count, delta: current.trade_count - baseline.trade_count },
    win_rate: { current: current.win_rate, baseline: baseline.win_rate, delta_pct: pct('win_rate') },
    avg_pnl: { current: current.avg_pnl, baseline: baseline.avg_pnl, delta: round(current.avg_pnl - baseline.avg_pnl) },
    avg_risk_per_trade: { current: current.avg_risk_per_trade, baseline: baseline.avg_risk_per_trade, delta_pct: pct('avg_risk_per_trade') },
    avg_r_per_trade: { current: current.avg_r_per_trade, baseline: baseline.avg_r_per_trade, delta_pct: pct('avg_r_per_trade') },
    max_loss_streak: { current: current.max_loss_streak, baseline: baseline.max_loss_streak, delta: current.max_loss_streak - baseline.max_loss_streak },
  };
}

/** Normalize a free-form behavior label into a stable grouping key. */
export function normalizeBehaviorName(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}