/**
 * Behavior Engine — analysis job runner tests (Stage E)
 *
 * Uses an in-memory supabase client + a scripted fake LLM provider to verify:
 *   - valid analysis end-to-end: job → LLM → validate → evidence → lifecycle
 *   - malformed output: one repair retry, then failed
 *   - LLM rate-limit/timeout: requeue (transient), then failed at max attempts
 *   - LLM invalid twice: failed
 *   - idempotency: re-running the same trade converges (no dup evidence)
 *   - skipped when there is nothing to analyze
 *
 * Run: node test/behavior-analysis.test.mjs
 */

import assert from 'node:assert/strict';
import { AnalysisService, ANALYSIS_PROMPT_VERSION } from '../src/behavior/analysis-service.js';
import { TradingDataAccess } from '../src/data/trading-data.js';
import { LLMRateLimitError, LLMTimeoutError } from '../src/ai/provider.js';
import { BEHAVIOR_STATUS } from '../src/behavior/lifecycle.js';

let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };

// Reuse the in-memory supabase builder from the isolation test.
const { makeMemoryDb } = await import('./_memory-db.mjs');

const userA = 'user-a';
const acctA1 = 'acct-a1';
const tradeA = 'trade-a1';

function seed(db) {
  db.insert('accounts', [{ id: acctA1, user_id: userA, name: 'APEX 50K', platform: 'MT5' }]);
  db.insert('trades', [{
    id: tradeA, account_id: acctA1, ticket: 481, pnl: -80, risk_per_trade: 100,
    daily_reflection: 'I entered too early because I thought price was going to run without me. Looking back, I should have waited for confirmation.',
    time_open: '2026-08-24T10:00:00Z', rules_violated: '',
  }]);
}

const GOOD_RESPONSE = JSON.stringify({
  observations: [{
    behavior_name: 'Early Entry',
    type: 'negative',
    description: 'Enters before confirmation.',
    confidence: 0.72,
    evidence: [{
      trade_id: tradeA,
      reason: 'Entered too early, no confirmation.',
      reflection_excerpt: 'I entered too early because I thought price was going to run without me.',
      confidence: 0.7,
    }],
  }],
});

/** Scripted provider with configurable failure scenarios. */
function makeProvider({ scenarios = [] } = {}) {
  // scenarios: [{ result }, { throw: Error-like }, ...] consumed per call
  let calls = 0;
  return {
    model: 'fake-model',
    async chat() {
      const s = scenarios[calls] || scenarios[scenarios.length - 1] || { result: GOOD_RESPONSE };
      calls++;
      if (s.throw) throw s.throw;
      if (typeof s.result === 'string') return { content: s.result, reasoning: null, toolCalls: null };
      return s.result;
    },
    callCount: () => calls,
  };
}
// ─── 1. Happy path: valid analysis → evidence → lifecycle ──────
{
  console.log('valid analysis end-to-end');
  const db = makeMemoryDb();
  seed(db);
  const provider = makeProvider({ scenarios: [{ result: GOOD_RESPONSE }] });
  const svc = new AnalysisService({ supabase: db, provider, tradingData: new TradingDataAccess(db) });

  const job = await svc.enqueueForTrade(userA, acctA1, tradeA);
  assert.equal(job.status, 'queued');
  assert.equal(job.trigger, 'trade_saved');

  const result = await svc.processJob(job);
  assert.equal(result.status, 'done');
  assert.equal(result.observations, 1);

  const behaviors = db.fetchAll('behaviors');
  assert.equal(behaviors.length, 1, 'one canonical behavior');
  assert.equal(behaviors[0].name_key, 'early_entry');
  assert.equal(behaviors[0].status, 'DETECTED', '1 occurrence → DETECTED');
  assert.ok(behaviors[0].occurrence_count === 1);
  assert.ok(behaviors[0].confidence > 0 && behaviors[0].confidence <= 1, 'confidence computed');
  assert.equal(behaviors[0].estimated_impact_pnl, -80, 'backend-computed impact from trade');

  const evidence = db.fetchAll('behavior_evidence');
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].trade_id, tradeA);
  assert.equal(evidence[0].metrics_snapshot.r_multiple, -0.8);
  assert.ok(evidence[0].week_start, 'week_start derived');

  const analysis = db.fetchAll('ai_analyses')[0];
  assert.equal(analysis.status, 'done');
  assert.equal(analysis.prompt_version, ANALYSIS_PROMPT_VERSION);
  ok('job → LLM → validate → evidence → DETECTED lifecycle + audit trail');
}

// ─── 2. Malformed output → ONE repair retry → done ─────────────
{
  console.log('malformed output repaired once');
  const db = makeMemoryDb();
  seed(db);
  const bad = 'not json at all';
  const provider = makeProvider({ scenarios: [{ result: bad }, { result: GOOD_RESPONSE }] });
  const svc = new AnalysisService({ supabase: db, provider, tradingData: new TradingDataAccess(db) });
  const job = await svc.enqueueForTrade(userA, acctA1, tradeA);
  const result = await svc.processJob(job);
  assert.equal(result.status, 'done', 'repair succeeded');
  assert.equal(provider.callCount(), 2, 'exactly one repair retry');
  ok('malformed → 1 repair retry → done');
}

// ─── 3. Malformed twice → failed, no DB writes ─────────────────
{
  console.log('malformed twice → failed');
  const db = makeMemoryDb();
  seed(db);
  const bad = '{"observations": [{"behavior_name": "", "type": "weird", "confidence": 9}]}';
  const provider = makeProvider({ scenarios: [{ result: bad }, { result: bad }] });
  const svc = new AnalysisService({ supabase: db, provider, tradingData: new TradingDataAccess(db) });
  const job = await svc.enqueueForTrade(userA, acctA1, tradeA);
  const result = await svc.processJob(job);
  assert.equal(result.status, 'failed', 'invalid after repair → failed');
  assert.equal(db.fetchAll('behaviors').length, 0, 'NO behavior written from malformed output');
  assert.equal(db.fetchAll('behavior_evidence').length, 0, 'NO evidence written');
  assert.equal(db.fetchAll('ai_analyses')[0].status, 'failed');
  assert.ok(db.fetchAll('ai_analyses')[0].last_error, 'error message retained for audit');
  ok('malformed twice → job failed, DB untouched');
}

// ─── 4. Rate-limit / timeout → transient requeue → attempts ────
{
  console.log('transient LLM failures requeue');
  const db = makeMemoryDb();
  seed(db);
  const provider = makeProvider({ scenarios: [{ throw: new LLMRateLimitError(5) }] });
  const svc = new AnalysisService({ supabase: db, provider, tradingData: new TradingDataAccess(db) });
  const job = await svc.enqueueForTrade(userA, acctA1, tradeA);
  const result = await svc.processJob({ ...job, attempts: 0, max_attempts: 3 });
  assert.equal(result.status, 'queued', 'rate limit is transient → requeued');
  assert.equal(result.attempts, 1);

  const result2 = await svc.processJob({ ...job, attempts: 1, max_attempts: 3 });
  assert.equal(result2.status, 'queued', 'timeout also transient');

  const result3 = await svc.processJob({ ...job, attempts: 2, max_attempts: 3 });
  assert.equal(result3.status, 'failed', 'attempts exhausted → failed');
  ok('rate-limit/timeout → requeue with attempts; exhausted → failed');
}
// ─── 5. Idempotency: same trade processed twice → no dupes ─────
{
  console.log('idempotent reprocessing');
  const db = makeMemoryDb();
  seed(db);
  const provider = makeProvider({ scenarios: [{ result: GOOD_RESPONSE }, { result: GOOD_RESPONSE }] });
  const svc = new AnalysisService({ supabase: db, provider, tradingData: new TradingDataAccess(db) });
  const job1 = await svc.enqueueForTrade(userA, acctA1, tradeA);
  const job2 = await svc.enqueueForTrade(userA, acctA1, tradeA);
  await svc.processJob(job1);
  await svc.processJob(job2);
  const behaviors = db.fetchAll('behaviors');
  assert.equal(behaviors.length, 1, 'convergent behavior row');
  const evidence = db.fetchAll('behavior_evidence');
  assert.equal(evidence.length, 1, 'evidence unique(behavior_id, trade_id) prevents duplicates');
  assert.equal(behaviors[0].occurrence_count, 1);
  ok('re-processing the same trade never duplicates behavior/evidence');
}

// ─── 6. Skipped: no reflection / no trade ──────────────────────
{
  console.log('skip conditions');
  const db = makeMemoryDb();
  seed(db);
  db.insert('trades', [{ id: 'trade-empty', account_id: acctA1, ticket: 500, pnl: 10, risk_per_trade: 100, daily_reflection: '' }]);
  const provider = makeProvider({});
  const svc = new AnalysisService({ supabase: db, provider, tradingData: new TradingDataAccess(db) });

  const emptyJob = await svc.enqueueForTrade(userA, acctA1, 'trade-empty');
  const r1 = await svc.processJob(emptyJob);
  assert.equal(r1.status, 'skipped');
  assert.ok(r1.reason.includes('empty daily reflection'));

  const noTrade = await svc.processJob({ id: 'fake-job', user_id: userA, account_id: acctA1, trigger: 'trade_saved', trade_id: 'no-such-trade', attempts: 0, max_attempts: 3 });
  assert.equal(noTrade.status, 'skipped');
  assert.equal(provider.callCount(), 0, 'LLM never called for skipped jobs');
  ok('empty reflection / missing trade → skipped, LLM never called');
}

// ─── 7. Emerging lifecycle after 2nd occurrence ────────────────
{
  console.log('2 occurrences → EMERGING');
  const db = makeMemoryDb();
  seed(db);
  db.insert('trades', [{
    id: 'trade-b2', account_id: acctA1, ticket: 489, pnl: -100, risk_per_trade: 100,
    daily_reflection: 'I entered immediately because I wanted to make back the loss.',
    time_open: '2026-08-25T11:00:00Z', rules_violated: '',
  }]);
  const secondResponse = JSON.stringify({
    observations: [{
      behavior_name: 'Early Entry',
      type: 'negative',
      description: null,
      confidence: 0.75,
      evidence: [{ trade_id: 'trade-b2', reason: 'Entered immediately to recover.', reflection_excerpt: 'make back the loss', confidence: 0.8 }],
    }],
  });
  const provider = makeProvider({ scenarios: [{ result: GOOD_RESPONSE }, { result: secondResponse }] });
  const svc = new AnalysisService({ supabase: db, provider, tradingData: new TradingDataAccess(db) });
  const j1 = await svc.enqueueForTrade(userA, acctA1, tradeA);
  const j2 = await svc.enqueueForTrade(userA, acctA1, 'trade-b2');
  await svc.processJob(j1);
  await svc.processJob(j2);
  const b = db.fetchAll('behaviors')[0];
  assert.equal(b.occurrence_count, 2, 'two occurrences aggregated');
  assert.equal(b.status, 'EMERGING', '2 occurrences → EMERGING (config threshold)');
  assert.ok(b.confidence > 0.3 && b.confidence <= 1, 'confidence blended upward');
  assert.equal(b.estimated_impact_pnl, -180, 'impact aggregates both trades');
  ok('second occurrence escalates DETECTED → EMERGING');
}

console.log(`\nAll ${passed} analysis tests passed.`);