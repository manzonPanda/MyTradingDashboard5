/**
 * Behavior Engine — stale running-job recovery tests
 *
 * Verifies that crashed workers cannot permanently strand jobs:
 *   1. running job with a VALID lock → cannot be reclaimed
 *   2. running job with an EXPIRED lock → can be reclaimed
 *   3. reclaimed jobs increment/handle attempts correctly, capped at max
 *   4. two workers racing the same expired job → exactly one reclaims it
 *   5. permanently exhausted jobs finalize to `failed` and never loop forever
 *
 * In-memory supabase client; no network, no real DB.
 *
 * Run: node test/behavior-stale-recovery.test.mjs
 */

import assert from 'node:assert/strict';
import { AnalysisJobStore } from '../src/data/analysis-job-store.js';
import { makeMemoryDb } from './_memory-db.mjs';

let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };

const userA = 'user-a';
const acctA1 = 'acct-a1';
const tradeA1 = 'trade-a1';

const nowIso = () => new Date().toISOString();
const minutesAgo = (n) => new Date(Date.now() - n * 60 * 1000).toISOString();
const getRow = (db, id) => db.tables.get('ai_analyses').find((r) => r.id === id);

function seedJob(db, { id, status = 'queued', attempts = 0, maxAttempts = 3, updatedAt = nowIso() }) {
  db.insert('ai_analyses', [{
    id,
    user_id: userA,
    account_id: acctA1,
    trigger: 'trade_saved',
    trade_id: tradeA1,
    status,
    attempts,
    max_attempts: maxAttempts,
    updated_at: updatedAt,
    created_at: nowIso(),
  }]);
}

{
  console.log('stale running-job recovery (lock expiry)');

  // 1) VALID lock → never reclaimed
  {
    const db = makeMemoryDb();
    const jobs = new AnalysisJobStore(db);
    seedJob(db, { id: 'fresh', status: 'running', attempts: 1, maxAttempts: 3, updatedAt: minutesAgo(1) });
    const claimed = await jobs.claimNext([acctA1], { batchSize: 1 });
    assert.equal(claimed.length, 0, 'fresh lock must not be reclaimed');
    const row = getRow(db, 'fresh');
    assert.equal(row.status, 'running');
    assert.equal(row.attempts, 1);
    ok('running job with valid lock → cannot be reclaimed');
  }

  // 2) EXPIRED lock → reclaimed; attempts incremented; lock refreshed
  {
    const db = makeMemoryDb();
    const jobs = new AnalysisJobStore(db);
    seedJob(db, { id: 'old', status: 'running', attempts: 1, maxAttempts: 3, updatedAt: minutesAgo(11) });
    const claimed = await jobs.claimNext([acctA1], { batchSize: 1 });
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].id, 'old');
    assert.equal(claimed[0].status, 'running');
    assert.equal(claimed[0].attempts, 2, 'reclaim increments attempts 1 → 2');
    assert.ok(
      Date.parse(getRow(db, 'old').updated_at) >= Date.parse(minutesAgo(1)),
      'reclaim refreshes the lock (updated_at back to now)'
    );
    const again = await jobs.claimNext([acctA1], { batchSize: 1 });
    assert.equal(again.length, 0, 'fresh lock right after reclaim is not double-claimed');
    ok('running job with expired lock → can be reclaimed (lock refreshed, no double-claim)');
  }

  // 3) attempts increment across successive reclaims and cap at max_attempts
  {
    const db = makeMemoryDb();
    const jobs = new AnalysisJobStore(db);
    seedJob(db, { id: 'j3', status: 'running', attempts: 1, maxAttempts: 3, updatedAt: minutesAgo(11) });

    const c1 = await jobs.claimNext([acctA1], { batchSize: 1 });
    assert.equal(c1[0].attempts, 2, 'first reclaim: attempts 1 → 2');

    // simulate another crash: freeze the heartbeat again
    getRow(db, 'j3').updated_at = minutesAgo(11);
    const c2 = await jobs.claimNext([acctA1], { batchSize: 1 });
    assert.equal(c2[0].attempts, 3, 'second reclaim: attempts 2 → 3');

    // attempts == max_attempts now → a third stale cycle must NOT reclaim
    getRow(db, 'j3').updated_at = minutesAgo(11);
    const c3 = await jobs.claimNext([acctA1], { batchSize: 1 });
    assert.equal(c3.length, 0, 'exhausted job is never reclaimed again');
    const fin = getRow(db, 'j3');
    assert.equal(fin.status, 'failed', 'exhausted job is finalized to failed');
    assert.equal(fin.attempts, 3, 'attempts never exceed max_attempts');
    assert.ok(fin.finished_at, 'terminal finished_at is recorded');
    ok('reclaimed attempts increment correctly and cap at max_attempts');
  }

  // 4) two workers racing the same expired job → exactly one wins
  {
    const db = makeMemoryDb();
    const jobs = new AnalysisJobStore(db);
    seedJob(db, { id: 'race', status: 'running', attempts: 0, maxAttempts: 3, updatedAt: minutesAgo(11) });
    const [a, b] = await Promise.all([
      jobs.claimNext([acctA1], { batchSize: 1 }),
      jobs.claimNext([acctA1], { batchSize: 1 }),
    ]);
    assert.equal(a.length + b.length, 1, 'exactly one worker reclaims the shared expired job');
    const row = getRow(db, 'race');
    assert.equal(row.status, 'running');
    assert.equal(row.attempts, 1, 'attempts incremented exactly once');
    ok('two workers cannot reclaim the same expired job simultaneously');
  }

  // 5) permanently exhausted jobs never loop forever
  {
    const db = makeMemoryDb();
    const jobs = new AnalysisJobStore(db);
    seedJob(db, { id: 'ex', status: 'running', attempts: 3, maxAttempts: 3, updatedAt: minutesAgo(11) });

    const c1 = await jobs.claimNext([acctA1], { batchSize: 1 });
    assert.equal(c1.length, 0, 'exhausted job is never claimed');
    const fin = getRow(db, 'ex');
    assert.equal(fin.status, 'failed', 'finalized to failed on the stale pass');
    assert.equal(fin.attempts, 3);

    // idempotent: further passes leave it failed and never requeue it
    const c2 = await jobs.claimNext([acctA1], { batchSize: 1 });
    assert.equal(c2.length, 0);
    assert.equal(getRow(db, 'ex').status, 'failed');
    assert.equal(getRow(db, 'ex').attempts, 3);
    ok('permanently exhausted jobs finalize to failed and never loop forever');
  }
}

console.log(`\nAll ${passed} stale-recovery tests passed.`);