/**
 * Behavior Engine — domain model unit tests (Stage B)
 *
 * Pure, deterministic tests. No network, no DB.
 * Run: node test/behavior-domain.test.mjs
 */

import assert from 'node:assert/strict';
import {
  DEFAULT_THRESHOLDS,
  resolveThresholds,
} from '../src/behavior/thresholds.js';
import {
  computeStatus,
  resolveIfInactive,
  BEHAVIOR_STATUS,
  ACTIVE_STATUSES,
} from '../src/behavior/lifecycle.js';
import {
  evidenceConfidence,
  blendConfidence,
  consistencyFactor,
  finalConfidence,
} from '../src/behavior/confidence.js';
import {
  computeRMultiple,
  computeTradeMetrics,
  computeBehaviorImpact,
  computeBaseline,
  diffFromBaseline,
  normalizeBehaviorName,
} from '../src/behavior/stats.js';

let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };

// ─── thresholds ────────────────────────────────────────────────
{
  console.log('thresholds');
  assert.equal(resolveThresholds(null).emergingMin, 2);
  const merged = resolveThresholds({ emergingMin: 3, bogus: 999, recurringMin: '5' });
  assert.equal(merged.emergingMin, 3);
  assert.equal(merged.recurringMin, 5);
  assert.equal(merged.bogus, undefined, 'unknown keys are ignored');
  assert.equal(merged.ruleMinReflections, DEFAULT_THRESHOLDS.ruleMinReflections);
  ok('resolveThresholds: defaults + overrides + hostile-key rejection');
}

// ─── lifecycle ─────────────────────────────────────────────────
{
  console.log('lifecycle');
  const base = { currentStatus: BEHAVIOR_STATUS.DETECTED, behaviorType: 'negative', occurrenceCount: 1 };
  assert.equal(computeStatus(base), BEHAVIOR_STATUS.DETECTED);
  assert.equal(computeStatus({ ...base, occurrenceCount: 2 }), BEHAVIOR_STATUS.EMERGING);
  assert.equal(computeStatus({ ...base, occurrenceCount: 3 }), BEHAVIOR_STATUS.EMERGING);
  assert.equal(computeStatus({ ...base, occurrenceCount: 4 }), BEHAVIOR_STATUS.RECURRING);
  assert.equal(computeStatus({ ...base, occurrenceCount: 6, distinctWeeks: 3, reflectionCount: 8, confidence: 0.8 }), BEHAVIOR_STATUS.RULE_CANDIDATE);
  ok('negative: DETECTED→EMERGING→RECURRING→RULE_CANDIDATE');

  const pos = { currentStatus: BEHAVIOR_STATUS.DETECTED, behaviorType: 'positive', occurrenceCount: 1 };
  assert.equal(computeStatus(pos), BEHAVIOR_STATUS.DETECTED);
  assert.equal(computeStatus({ ...pos, occurrenceCount: 2 }), BEHAVIOR_STATUS.EMERGING);
  assert.equal(computeStatus({ ...pos, occurrenceCount: 5 }), BEHAVIOR_STATUS.ESTABLISHED);
  assert.equal(computeStatus({ ...pos, occurrenceCount: 6, distinctWeeks: 3, reflectionCount: 8, confidence: 0.8 }), BEHAVIOR_STATUS.RULE_CANDIDATE);
  ok('positive: DETECTED→EMERGING→ESTABLISHED→RULE_CANDIDATE');

  assert.equal(computeStatus({ currentStatus: BEHAVIOR_STATUS.ARCHIVED, behaviorType: 'negative', occurrenceCount: 9 }), BEHAVIOR_STATUS.ARCHIVED);
  assert.equal(computeStatus({ currentStatus: BEHAVIOR_STATUS.RESOLVED, behaviorType: 'negative', occurrenceCount: 1 }), BEHAVIOR_STATUS.DETECTED);
  assert.equal(computeStatus({ currentStatus: BEHAVIOR_STATUS.RESOLVED, behaviorType: 'negative', occurrenceCount: 3 }), BEHAVIOR_STATUS.EMERGING);
  ok('ARCHIVED terminal; RESOLVED reactivates on new evidence');

  const now = new Date();
  const daysAgo = (d) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
  assert.equal(resolveIfInactive({ status: BEHAVIOR_STATUS.EMERGING, lastDetectedAt: daysAgo(40), now, thresholds: null }), BEHAVIOR_STATUS.RESOLVED);
  assert.equal(resolveIfInactive({ status: BEHAVIOR_STATUS.RECURRING, lastDetectedAt: daysAgo(5), now, thresholds: null }), null);
  assert.equal(resolveIfInactive({ status: BEHAVIOR_STATUS.RESOLVED, lastDetectedAt: daysAgo(1), now, thresholds: null }), null);
  ok('resolveIfInactive: 30-day inactivity → RESOLVED');

  assert.ok(ACTIVE_STATUSES.length === 5, 'exactly 5 active statuses');
  ok('ACTIVE_STATUSES has exactly 5 members');
}

// ─── confidence ────────────────────────────────────────────────
{
  console.log('confidence');
  const e = evidenceConfidence(1.0);
  assert.ok(e >= 0.7 && e <= 0.85, `evidenceConfidence(1) in band: ${e}`);
  assert.ok(evidenceConfidence(0) < evidenceConfidence(0.5));
  assert.ok(evidenceConfidence(0.5) < evidenceConfidence(1));
  assert.equal(evidenceConfidence(-5), evidenceConfidence(0), 'clamped low');
  assert.equal(evidenceConfidence(5), evidenceConfidence(1), 'clamped high');
  ok('evidenceConfidence: clamped, single-datapoint band');

  const b1 = blendConfidence({ runningConfidence: 0, runningCount: 0, newEvidenceConf: 0.8 });
  assert.ok(b1 >= 0.7 && b1 <= 0.85, `first blend: ${b1}`);
  const b3 = blendConfidence({ runningConfidence: b1, runningCount: 1, newEvidenceConf: 0.8 });
  assert.ok(b3 >= b1, 'agreement raises confidence');
  const bNeg = blendConfidence({ runningConfidence: 0.95, runningCount: 10, newEvidenceConf: 0.2 });
  assert.ok(bNeg < 0.95, 'disagreement lowers run');
  ok('blendConfidence: weighted running average sub-linear');

  const rows = [
    { behavior_type: 'negative' },
    { behavior_type: 'negative' },
    { behavior_type: 'negative' },
    { behavior_type: 'positive' },
  ];
  assert.equal(consistencyFactor(rows, 'negative'), 0.875);
  assert.ok(consistencyFactor([{ behavior_type: 'positive' }], 'positive') > 0.8);
  ok('consistencyFactor: dominant-type agreement');

  assert.ok(finalConfidence({ blended: 0.8, consistency: 1, recencyFactor: 1 }) > finalConfidence({ blended: 0.8, consistency: 0.5, recencyFactor: 1 }));
  assert.ok(finalConfidence({ blended: 0.8, consistency: 1, recencyFactor: 0.1 }) < finalConfidence({ blended: 0.8, consistency: 1, recencyFactor: 1 }));
  ok('finalConfidence: consistency + recency dampening');
// ─── objective stats ───────────────────────────────────────────
{
  console.log('stats');
  const win = { pnl: 150, risk_per_trade: 100 };
  const loss = { pnl: -200, risk_per_trade: 100 };
  assert.equal(computeRMultiple(win), 1.5);
  assert.equal(computeRMultiple(loss), -2);
  assert.equal(computeRMultiple({ pnl: 10, risk_per_trade: 0 }), 0);
  ok('computeRMultiple');

  const m = computeTradeMetrics(win);
  assert.equal(m.r_multiple, 1.5);
  assert.equal(m.trade_type, 'win');
  assert.equal(computeTradeMetrics(loss).trade_type, 'loss');
  assert.equal(computeTradeMetrics({ pnl: 0, risk_per_trade: 50 }).trade_type, 'scratch');
  ok('computeTradeMetrics');

  const evidence = [
    { metrics_snapshot: { pnl: -80, r_multiple: -0.8, risk_per_trade: 100 }, created_at: new Date(Date.now() - 2 * 864e5).toISOString() },
    { metrics_snapshot: { pnl: -100, r_multiple: -1, risk_per_trade: 100 }, created_at: new Date(Date.now() - 50 * 864e5).toISOString() },
    { metrics_snapshot: { pnl: 40, r_multiple: 0.4, risk_per_trade: 100 }, created_at: new Date(Date.now() - 4 * 864e5).toISOString() },
  ];
  const impact = computeBehaviorImpact(evidence);
  assert.equal(impact.occurrence_count, 3);
  assert.equal(impact.win_count, 1);
  assert.equal(impact.loss_count, 2);
  assert.ok(impact.total_pnl < 0, 'net negative');
  assert.ok(impact.impact_score < 0, 'negative leak score');
  assert.equal(impact.win_rate, 0.3333);
  ok('computeBehaviorImpact aggregates counts/pnl/r/recency');

  const baseline = computeBaseline([win, loss, loss, { pnl: 60, risk_per_trade: 100 }]);
  assert.ok(baseline);
  assert.equal(baseline.trade_count, 4);
  assert.equal(baseline.win_rate, 0.5);
  assert.equal(baseline.max_loss_streak, 2);
  ok('computeBaseline');

  const current = { trade_count: 8, win_rate: 0.25, avg_pnl: -40, avg_risk_per_trade: 90, avg_r_per_trade: -0.8, max_loss_streak: 4 };
  const diff = diffFromBaseline(baseline, current);
  assert.equal(diff.trade_count.delta, 8 - baseline.trade_count);
  assert.equal(diff.max_loss_streak.delta, 4 - baseline.max_loss_streak);
  assert.ok(diff.win_rate.delta_pct < 0, 'win rate dropped');
  ok('diffFromBaseline');

  assert.equal(normalizeBehaviorName('  Revenge Trading!  '), 'revenge_trading');
  assert.equal(normalizeBehaviorName('POST-LOSS ENTRY'), 'post_loss_entry');
  assert.equal(normalizeBehaviorName(''), '');
  ok('normalizeBehaviorName');
}

console.log(`\nAll ${passed} behavior-domain tests passed.`);
}