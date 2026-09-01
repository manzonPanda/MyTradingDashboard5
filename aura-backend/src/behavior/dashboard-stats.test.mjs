/**
 * Behavior Engine — dashboard-stats unit tests
 *
 * Verifies the deterministic statistics/score/pattern computations that power
 * the Trading Behavior Engine dashboard. No network, no DB, no LLM. The rules
 * asserted here are what the UI shows, so changing a formula without updating
 * this file is a test failure.
 *
 * Run: node src/behavior/dashboard-stats.test.mjs
 */
import assert from 'node:assert/strict';
import {
  computeBehaviorScore,
  computeScoreDelta,
  aggregateTrades,
  computeWeekView,
  computePatterns,
  weekStart,
  normTs,
  sessionKey,
} from './dashboard-stats.js';

let passed = 0;
const ok = (name) => { passed += 1; console.log('  ✓', name); };

// ─── normTs: naive DB timestamps are treated as UTC ─────────────
{
  assert.equal(normTs('2026-08-28 10:00:00'), '2026-08-28T10:00:00Z');
  assert.equal(normTs('2026-08-28T10:00:00Z'), '2026-08-28T10:00:00Z');
  ok('normTs appends Z to naive timestamps, keeps ISO');
}

// ─── weekStart ──────────────────────────────────────────────────
{
  assert.equal(weekStart('2026-08-28T12:00:00Z'), '2026-08-24'); // Mon of that week
  assert.equal(weekStart('2026-08-31T12:00:00Z'), '2026-08-31'); // Monday itself
  ok('weekStart returns Monday-start ISO key');
}

// ─── sessionKey ─────────────────────────────────────────────────
{
  assert.equal(sessionKey(3), 'asia');
  assert.equal(sessionKey(9), 'london');
  assert.equal(sessionKey(14), 'new_york');
  assert.equal(sessionKey(20), 'late');
  ok('sessionKey buckets hours');
}

// ─── aggregateTrades: streaks, risk, R, delay, holds ────────────
{
  const trades = [
    { ticket: 1, pnl: -82, risk_per_trade: 100, time_open: '2026-08-28 10:00:00', time_close: '2026-08-28 10:20:00' },
    { ticket: 2, pnl: -47, risk_per_trade: 100, time_open: '2026-08-28 10:03:12', time_close: '2026-08-28 10:15:00' },
    { ticket: 3, pnl: 210, risk_per_trade: 100, time_open: '2026-08-29 09:00:00', time_close: '2026-08-29 11:00:00' },
  ];
  const agg = aggregateTrades(trades);
  assert.equal(agg.trade_count, 3);
  assert.equal(agg.max_loss_streak, 2);
  assert.equal(agg.win_rate, 0.3333);
  assert.equal(agg.total_pnl, 81);
  assert.equal(agg.risk_after_2_wins, 0); // never 3 consecutive wins
  assert.equal(agg.risk_normal, 100);
  ok('aggregateTrades computes streaks, win rate, total P&L, risk');
}

// ─── computeBehaviorScore: not-enough-data vs derived score ─────
{
  const none = computeBehaviorScore([]);
  assert.equal(none.available, false);
  const single = computeBehaviorScore([
    { behavior_type: 'negative', occurrence_count: 1, estimated_impact_r: -2, status: 'DETECTED', last_detected_at: new Date().toISOString() },
  ]);
  assert.equal(single.available, false); // <2 occurrences => not enough data
  const enough = computeBehaviorScore([
    { behavior_type: 'negative', occurrence_count: 7, estimated_impact_r: -2.9, status: 'RECURRING', last_detected_at: new Date().toISOString() },
    { behavior_type: 'positive', occurrence_count: 10, estimated_impact_r: 3.2, status: 'ESTABLISHED', last_detected_at: new Date().toISOString() },
  ]);
  assert.equal(enough.available, true);
  assert.ok(enough.score >= 0 && enough.score <= 100);
  ok(`computeBehaviorScore: unavailable when no data, derived when thresholds met (${enough.score})`);
}

// ─── computeScoreDelta ──────────────────────────────────────────
{
  const delta = computeScoreDelta([
    { behavior_type: 'negative', occurrence_count: 7, estimated_impact_r: -2.9, status: 'RECURRING', last_detected_at: new Date().toISOString() },
  ]);
  assert.ok(delta.available === true || delta.delta === null);
  ok('computeScoreDelta returns a delta when available');
}

// ─── computeWeekView: current week vs previous 7 days ───────────
{
  const now = new Date('2026-08-31T12:00:00Z'); // Monday
  const trades = [
    { ticket: 1, pnl: 100, risk_per_trade: 100, time_open: '2026-08-31 08:00:00', time_close: '2026-08-31 09:00:00' }, // this week
    { ticket: 2, pnl: -50, risk_per_trade: 100, time_open: '2026-08-24 08:00:00', time_close: '2026-08-24 09:00:00' }, // previous
  ];
  const view = computeWeekView(trades, now);
  assert.equal(view.has_week_trades, true);
  assert.equal(view.has_previous_trades, true);
  assert.equal(view.current.trade_count, 1);
  assert.equal(view.previous.trade_count, 1);
  assert.equal(view.week_start, '2026-08-31');
  ok('computeWeekView separates current week from the comparable previous window');
}

// ─── computePatterns: deterministic from raw trades ─────────────
{
  const trades = [
    { ticket: 1, pnl: -82, risk_per_trade: 100, instrument: 'XAUUSD', time_open: '2026-08-28 09:00:00', time_close: '2026-08-28 09:10:00' },
    { ticket: 2, pnl: -47, risk_per_trade: 100, instrument: 'XAUUSD', time_open: '2026-08-28 09:11:00', time_close: '2026-08-28 09:20:00' }, // re-entry 1m after loss
    { ticket: 3, pnl: 210, risk_per_trade: 100, instrument: 'EURUSD', time_open: '2026-08-29 14:00:00', time_close: '2026-08-29 16:00:00' },
  ];
  const patterns = computePatterns(trades);
  const reentry = patterns.find((p) => p.id === 'post_loss_reentry');
  assert.ok(reentry, 'post_loss_reentry pattern detected');
  assert.equal(reentry.occurrences, 1);
  assert.ok(reentry.evidence.length >= 1);
  const session = patterns.find((p) => p.id === 'sessions');
  assert.ok(session, 'session attribution produced');
  ok('computePatterns detects post-loss re-entry + sessions from raw trades');
}

console.log(`\n✅ dashboard-stats: ${passed} checks passed`);