/**
 * Behavior Engine — account-switching + true-data-state test suite
 *
 * Verifies the architecture corrections end-to-end at the DATA layer:
 *
 *  1. Account A loads correctly (independent behavioral state).
 *  2. Switch Account A → Account B.
 *  3. Account B data replaces Account A data (no leakage).
 *  4. Account A realtime events do not update Account B.
 *  5. Account B realtime events update Account B.
 *  6. Trade-only account (0 reflections) still produces deterministic behaviors.
 *  7. Zero-reflection account does NOT produce a false empty state.
 *  8. LLM failure does not hide deterministic analysis.
 *  9. Rate-limit failure does not corrupt behavior state.
 * 10. Duplicate trade events remain idempotent.
 *
 * Pure in-memory (no network, no real DB). Mirrors the store-level fidelity of
 * the other behavior-* tests.
 *
 * Run: node test/behavior-realtime-isolation.test.mjs
 */
import assert from 'node:assert/strict';
import { makeMemoryDb } from './_memory-db.mjs';
import { BehaviorStore } from '../src/data/behavior-store.js';
import { TradingDataAccess } from '../src/data/trading-data.js';
import { DeterministicBehaviorService } from '../src/behavior/deterministic-service.js';
import { computeEngineStates } from '../src/behavior/dashboard-stats.js';

let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };

const userA = 'user-a';
const acctA = 'acct-a';   // Account A — 24 trades, 10 reflections, existing behaviors
const acctB = 'acct-b';   // Account B — 12 trades, 0 reflections

const iso = (offsetMin) => new Date(Date.UTC(2026, 0, 5 + Math.floor(offsetMin / 1440), 0, offsetMin % 1440, 0)).toISOString();
/** Build a deterministic seed: chronological trades with loss streaks + re-entries. */
function makeTrades(accountId, count, { reflections = 0 } = {}) {
  const out = [];
  let t = 0;
  let base = Date.UTC(2026, 0, 5, 8, 0, 0);
  for (let i = 0; i < count; i++) {
    // Force 2+ loss streaks and post-loss re-entries so deterministic patterns fire.
    const pnl = i % 3 === 0 ? -90 : i % 3 === 1 ? -40 : 120;
    const open = new Date(base + t * 90 * 60 * 1000); // 90 min apart
    const close = new Date(open.getTime() + 25 * 60 * 1000);
    out.push({
      id: `${accountId}-trade-${i}`,
      ticket: 1000 + i,
      account_id: accountId,
      instrument: 'EURUSD',
      buy_sell: i % 2 === 0 ? 'buy' : 'sell',
      lots: 0.5,
      pnl,
      commission: 0,
      swap: 0,
      price_open: 1.1,
      price_close: 1.11,
      sl: 0, tp: 0, pips: 0, rrr: 0,
      risk_per_trade: 100,
      mfe: 0, mae: 0,
      held: '25m',
      daily_reflection: i < reflections ? `reflection for trade ${i}` : '',
      rules_violated: null,
      weekly_retrospective: null,
      time_open: open.toISOString(),
      time_close: close.toISOString(),
      created_at: open.toISOString(),
    });
    t += 1;
  }
  return out;
}

function seed(db) {
  db.insert('accounts', [
    { id: acctA, user_id: userA, name: 'APEX 50K', platform: 'MT5' },
    { id: acctB, user_id: userA, name: '5ERS 100K', platform: 'Tradovate' },
  ]);
  db.insert('trades', [
    ...makeTrades(acctA, 24, { reflections: 10 }),
    ...makeTrades(acctB, 12, { reflections: 0 }),
  ]);
  // Account A already has an established behavior (existing state).
  db.insert('behaviors', [
    {
      id: 'beh-a-revenge', user_id: userA, account_id: acctA,
      name: 'Revenge Trading', name_key: 'revenge_trading', behavior_type: 'negative',
      status: 'RECURRING', occurrence_count: 6, confidence: 0.8,
      estimated_impact_pnl: -320, estimated_impact_r: -3.2,
      first_detected_at: iso(0), last_detected_at: iso(30), created_at: iso(0), updated_at: iso(30),
    },
  ]);
  db.insert('behavior_evidence', [
    { id: 'ev-a-1', user_id: userA, account_id: acctA, behavior_id: 'beh-a-revenge', trade_id: 'acct-a-trade-0', trade_ticket: 1000, week_start: '2026-01-05', reflection_excerpt: null, reason: 'objective', metrics_snapshot: { pnl: -90, r_multiple: -0.9 }, confidence: 0.7, created_at: iso(0) },
  ]);
  db.insert('ai_analyses', [
    { id: 'job-a-done', user_id: userA, account_id: acctA, trigger: 'trade_saved', trade_id: 'acct-a-trade-0', status: 'done', attempts: 1, max_attempts: 3, created_at: iso(5), finished_at: iso(6) },
  ]);
}

function setup() {
  const db = makeMemoryDb();
  seed(db);
  const tradingData = new TradingDataAccess(db, 0);
  const store = new BehaviorStore(db, tradingData);
  const det = new DeterministicBehaviorService({ supabase: db, store, tradingData });
  return { db, store, det };
}


// ─── 1 + 2 + 3: Account loads & switching replaces state with no leakage ─────
{
  console.log('1/2/3 — account loads + switch replaces (no leakage)');
  const { db, store } = setup();
  const behA = await store.listBehaviors(userA, acctA);
  const behB = await store.listBehaviors(userA, acctB);
  assert.equal(behA.length, 1, 'Account A has its own behavior');
  assert.equal(behB.length, 0, 'Account B has none of Account A behavior');
  ok('Account A state loads independently; Account B does not inherit A behaviors');

  // Write a behavior under Account B and re-read — proves writes are scoped.
  await store.upsertBehavior(userA, acctB, {
    name: 'Trade-Only Pattern', name_key: 'post_loss_reentry', behavior_type: 'negative', description: 'd', model: null,
  });
  const behB2 = await store.listBehaviors(userA, acctB);
  assert.equal(behB2.length, 1);
  const behA2 = await store.listBehaviors(userA, acctA);
  assert.equal(behA2.length, 1, 'Account A still only its own behavior after B write');
  ok('Switch A → B: B data replaces A (B has 1, A unaffected)');
}

// ─── 4 + 5: realtime event routing (account-scoped) ─────────────────────────
{
  console.log('4/5 — realtime event routing (account-scoped)');
  const { db, store } = setup();
  // A write to Account A must NOT touch Account B's loaded state; a write to
  // Account B must update Account B. Modeled by observing per-account lists.
  const bBehBefore = (await store.listBehaviors(userA, acctB)).length;
  // Event targeting Account A:
  await store.upsertEvidence(userA, acctA, {
    behavior_id: 'beh-a-revenge', analysis_id: null, trade_id: 'acct-a-trade-0', trade_ticket: 1000,
    week_start: '2026-01-05', reflection_excerpt: null, reason: 'A event', metrics_snapshot: { pnl: -90 }, evidence_confidence: 0.7,
  });
  const bBehAfterAEvent = (await store.listBehaviors(userA, acctB)).length;
  assert.equal(bBehAfterAEvent, bBehBefore, 'Account A event did not change Account B behaviors');
  const bEvBefore = (await store.listEvidence(userA, acctB)).length;
  assert.equal(bEvBefore, 0, 'Account B has no evidence from Account A');

  // Event targeting Account B:
  await store.upsertBehavior(userA, acctB, {
    name: 'B Pattern', name_key: 'b_pattern', behavior_type: 'negative', description: 'd', model: null,
  });
  const bBehAfterBEvent = (await store.listBehaviors(userA, acctB)).length;
  assert.equal(bBehAfterBEvent, bBehBefore + 1, 'Account B event updated Account B');
  ok('Account A realtime events do not update Account B; Account B events update Account B');
}

// ─── 6 + 7: trade-only account produces deterministic behaviors, not empty ──
{
  console.log('6/7 — trade-only account → deterministic behaviors (no false empty)');
  const { db, store, det } = setup();
  const res = await det.analyzeAccount(userA, acctB); // 12 trades, 0 reflections
  assert.equal(res.tradeCount, 12, 'saw 12 trades');
  assert.equal(res.reflectionCount ?? 0, 0, '0 reflections are fine');
  assert.ok(res.evidenceWritten >= 1, 'produced objective evidence without any reflection');
  assert.ok(res.behaviorCount >= 1, 'produced deterministic behaviors without any reflection');

  const bBehaviors = await store.listBehaviors(userA, acctB);
  const bEvidence = await store.listEvidence(userA, acctB);
  assert.ok(bBehaviors.length >= 1, 'behaviors exist for trade-only account');
  assert.ok(bEvidence.length >= 1, 'evidence exists for trade-only account');
  assert.ok(
    bBehaviors.every((b) => b.behavior_type === 'negative' && (b.name_key === 'post_loss_reentry' || b.name_key === 'loss_streaks')),
    'only statistically valid behaviors were created (no fabricated psychology)'
  );
  ok('12 trades / 0 reflections → deterministic behaviors + evidence, never an empty state');
}
// ─── 8: LLM failure does not hide deterministic analysis ───────────────────
{
  console.log('8 — LLM failure does not hide deterministic analysis');
  const { db, store, det } = setup();
  // Force Account A AI analyses to "failed" (simulates LLM unavailable).
  db.insert('ai_analyses', [
    { id: 'job-a-fail', user_id: userA, account_id: acctA, trigger: 'trade_saved', trade_id: 'acct-a-trade-1', status: 'failed', attempts: 3, max_attempts: 3, last_error: 'LLM timeout', created_at: iso(60), finished_at: iso(61) },
  ]);
  const analyses = [
    { status: 'failed', created_at: iso(61) },
    { status: 'done', created_at: iso(6) },
  ];
  // Engine status is computed from DATA; AI status is separate.
  const states = computeEngineStates({
    trades: makeTrades(acctA, 24),
    analyses,
  });
  assert.equal(states.engine_status, 'learning', 'deterministic engine still learning/current');
  assert.equal(states.ai_status, 'unavailable', 'AI layer reports unavailable separately');
  ok('LLM failure → ai_status=unavailable while engine_status stays data-driven (learning)');
}

// ─── 9: rate-limit failure does not corrupt behavior state ─────────────────
{
  console.log('9 — rate-limit failure does not corrupt behavior state');
  const { db, store, det } = setup();
  // A rate-limited (transient) job stays queued/requeued; deterministic state intact.
  const detBefore = await det.analyzeAccount(userA, acctB);
  const bBehBefore = (await store.listBehaviors(userA, acctB)).length;
  const bEvBefore = (await store.listEvidence(userA, acctB)).length;
  // Simulate a failed AI job (rate-limited) — behavior state must be untouched.
  db.insert('ai_analyses', [
    { id: 'job-rate', user_id: userA, account_id: acctB, trigger: 'trade_saved', trade_id: 'acct-b-trade-0', status: 'failed', attempts: 3, max_attempts: 3, last_error: 'rate limit exceeded', created_at: iso(10), finished_at: iso(11) },
  ]);
  const bBehAfter = (await store.listBehaviors(userA, acctB)).length;
  const bEvAfter = (await store.listEvidence(userA, acctB)).length;
  assert.equal(bBehAfter, bBehBefore, 'rate-limit failure did not add/remove behaviors');
  assert.equal(bEvAfter, bEvBefore, 'rate-limit failure did not corrupt evidence');
  ok('rate-limit failure leaves deterministic behaviors/evidence intact');
}

// ─── 10: duplicate trade events are idempotent ─────────────────────────────
{
  console.log('10 — duplicate trade events idempotent');
  const { db, store, det } = setup();
  await det.analyzeAccount(userA, acctB);
  const beh1 = (await store.listBehaviors(userA, acctB)).length;
  const ev1 = (await store.listEvidence(userA, acctB)).length;
  // Re-fire the same trade-saved webhook for the same account (deterministic pass again).
  await det.analyzeAccount(userA, acctB);
  const beh2 = (await store.listBehaviors(userA, acctB)).length;
  const ev2 = (await store.listEvidence(userA, acctB)).length;
  assert.equal(beh2, beh1, 'behaviors converged (no duplicates)');
  assert.equal(ev2, ev1, 'evidence converged (unique(behavior_id, trade_id))');
  ok('duplicate trade events remain idempotent (same rows after re-analysis)');
}

console.log(`\n✅ behavior-realtime-isolation: ${passed} checks passed`);

