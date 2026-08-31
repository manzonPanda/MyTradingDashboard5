/**
 * Behavior Engine — data layer isolation tests (Stage C)
 *
 * Verifies account/user isolation + idempotency + concurrency-safe claiming
 * with an in-memory supabase client. No network, no real DB.
 *
 * Run: node test/behavior-isolation.test.mjs
 */

import assert from 'node:assert/strict';
import { BehaviorStore } from '../src/data/behavior-store.js';
import { AnalysisJobStore } from '../src/data/analysis-job-store.js';
import { TradingDataAccess, AccountAccessError } from '../src/data/trading-data.js';
import { makeMemoryDb } from './_memory-db.mjs';

let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };

const userA = 'user-a';
const userB = 'user-b';
const acctA1 = 'acct-a1';
const acctA2 = 'acct-a2';
const acctB1 = 'acct-b1';
const tradeA1 = 'trade-a1';
const tradeB1 = 'trade-b1';

function seedAccountDb(db) {
  db.insert('accounts', [
    { id: acctA1, user_id: userA, name: 'APEX 50K', platform: 'MT5' },
    { id: acctA2, user_id: userA, name: '5ERS 100K', platform: 'Tradovate' },
    { id: acctB1, user_id: userB, name: 'B Funded', platform: 'MT5' },
  ]);
  db.insert('trades', [
    { id: tradeA1, account_id: acctA1, ticket: 481, pnl: -80, risk_per_trade: 100, daily_reflection: 'I wanted to recover the previous loss.' },
    { id: tradeB1, account_id: acctB1, ticket: 900, pnl: 200, risk_per_trade: 100, daily_reflection: 'Secret trade from another user.' },
  ]);
}
// ─── cross-user / cross-account isolation (BehaviorStore) ───────
{
  console.log('cross-account / cross-user isolation');
  const db = makeMemoryDb();
  seedAccountDb(db);
  const store = new BehaviorStore(db, new TradingDataAccess(db, 0));

  assert.equal(await store.resolveAccountId(userA, acctA1), acctA1);
  await assert.rejects(
    () => store.getTrade(userA, acctB1, tradeB1),
    (err) => err instanceof AccountAccessError,
    'userA must not read userB account'
  );
  ok('cross-user account → AccountAccessError');

  // cross-account same-user: userA requests a trade that lives under their
  // OTHER account (acctA2). The query is filtered to resolved acctA1 so the
  // trade must NOT leak — returns null, never the row.
  const leaked = await store.getTrade(userA, acctA1, tradeB1);
  assert.equal(leaked, null, 'trade under another account must not resolve');
  ok('cross-account same-user trade → null (no leakage)');

  const t = await store.getTrade(userA, acctA1, tradeA1);
  assert.ok(t && t.ticket === 481);
  ok('own trade resolves');

  db.insert('behaviors', [
    { id: 'b-a', user_id: userA, account_id: acctA1, name_key: 'revenge_trading', behavior_type: 'negative', status: 'EMERGING' },
    { id: 'b-a2', user_id: userA, account_id: acctA2, name_key: 'revenge_trading', behavior_type: 'negative', status: 'DETECTED' },
  ]);
  const listA1 = await store.listBehaviors(userA, acctA1);
  assert.equal(listA1.length, 1);
  assert.equal(listA1[0].id, 'b-a');
  const listA2 = await store.listBehaviors(userA, acctA2);
  assert.equal(listA2[0].id, 'b-a2');
  ok('listBehaviors is fully account-isolated (A1 vs A2)');
}
// ─── evidence idempotency (unique(behavior_id, trade_id)) ───────
{
  console.log('evidence idempotency');
  const db = makeMemoryDb();
  seedAccountDb(db);
  const store = new BehaviorStore(db, new TradingDataAccess(db, 0));

  const payload = {
    behavior_id: 'b-1',
    trade_id: tradeA1,
    trade_ticket: 481,
    reflection_excerpt: 'excerpt',
    reason: 'reason',
    metrics_snapshot: { pnl: -80, r_multiple: -0.8 },
  };
  await store.upsertEvidence(userA, acctA1, payload);
  await store.upsertEvidence(userA, acctA1, { ...payload, reason: 'reason-2' });

  const all = db.fetchAll('behavior_evidence');
  assert.equal(all.length, 1, 'upsert deduplicates to a single row');
  assert.equal(all[0].reason, 'reason-2', 'retry updates the same row');
  ok('upsertEvidence is idempotent (1 row after two writes with same key)');
}

// ─── behavior convergent upsert ─────────────────────────────────
{
  console.log('behavior convergent upsert');
  const db = makeMemoryDb();
  seedAccountDb(db);
  const store = new BehaviorStore(db, new TradingDataAccess(db, 0));

  await store.upsertBehavior(userA, acctA1, { name: 'Revenge Trading', name_key: 'revenge_trading', behavior_type: 'negative', description: 'd1' });
  await store.upsertBehavior(userA, acctA1, { name: 'Revenge Trading', name_key: 'revenge_trading', behavior_type: 'negative', description: 'd2' });
  const rows = db.fetchAll('behaviors');
  assert.equal(rows.length, 1, 'convergent upsert collapses onto one row');
  assert.equal(rows[0].description, 'd2');
  ok('upsertBehavior converges by (account_id, name_key, behavior_type)');
}

// ─── concurrency-safe job claiming (AnalysisJobStore) ──────────
{
  console.log('analysis job claiming');
  const db = makeMemoryDb();
  const jobs = new AnalysisJobStore(db);

  db.insert('ai_analyses', [
    { id: 'job-1', user_id: userA, account_id: acctA1, trigger: 'trade_saved', trade_id: tradeA1, status: 'queued', attempts: 0, max_attempts: 3 },
    { id: 'job-2', user_id: userA, account_id: acctA1, trigger: 'trade_saved', trade_id: tradeA1, status: 'queued', attempts: 1, max_attempts: 3 },
    { id: 'job-3', user_id: userA, account_id: acctA1, trigger: 'trade_saved', trade_id: tradeA1, status: 'running', attempts: 0, max_attempts: 3 },
  ]);

  const claimed = await jobs.claimNext([acctA1], { batchSize: 1 });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].status, 'running');

  const claimed2 = await jobs.claimNext([acctA1], { batchSize: 1 });
  assert.equal(claimed2.length, 1);
  const claimed3 = await jobs.claimNext([acctA1], { batchSize: 1 });
  assert.equal(claimed3.length, 0, 'no queued jobs left → nothing claimed');
  ok('claimNext: only queued jobs claimed, running jobs untouched');

  db.insert('ai_analyses', [
    { id: 'job-4', user_id: userA, account_id: acctA1, trigger: 'trade_saved', trade_id: tradeA1, status: 'running', attempts: 1, max_attempts: 3 },
  ]);
  const requeued = await jobs.markFailed('job-4', { maxAttempts: 3, progress: 1 });
  assert.equal(requeued.status, 'queued', 'transient failure requeues while attempts remain');
  assert.equal(requeued.attempts, 2);

  const failed = await jobs.markFailed('job-4', { maxAttempts: 3, progress: 3 });
  assert.equal(failed.status, 'failed', 'attempts exhausted → failed');
  ok('markFailed: requeue until maxAttempts, then failed');

  db.insert('ai_analyses', [
    { id: 'job-5', user_id: userA, account_id: acctA1, trigger: 'weekly', status: 'running', attempts: 0, max_attempts: 3 },
    { id: 'job-6', user_id: userA, account_id: acctA1, trigger: 'weekly', status: 'running', attempts: 0, max_attempts: 3 },
  ]);
  const done = await jobs.markDone('job-5', { rawResponse: { ok: true }, model: 'test' });
  assert.equal(done.status, 'done');
  assert.deepEqual(done.raw_response, { ok: true });
  const skipped = await jobs.markSkipped('job-6', { reason: 'no reflection' });
  assert.equal(skipped.status, 'skipped');
  ok('markDone / markSkipped lifecycle');
}

console.log(`\nAll ${passed} isolation tests passed.`);