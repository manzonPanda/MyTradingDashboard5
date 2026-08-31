/**
 * Behavior Engine — alerts + briefs tests (Stage H)
 *
 * Run: node test/behavior-alerts-briefs.test.mjs
 */

import assert from 'node:assert/strict';
import { AlertsService } from '../src/behavior/alerts-service.js';
import { BriefComposer, BriefService, validateBriefPayload, BriefValidationError } from '../src/behavior/brief-service.js';
import { TradingDataAccess } from '../src/data/trading-data.js';
import { makeMemoryDb } from './_memory-db.mjs';

let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };

const userA = 'user-a';
const userB = 'user-b';
const acctA1 = 'acct-a1';
const acctB1 = 'acct-b1';

function seed(db) {
  db.insert('accounts', [
    { id: acctA1, user_id: userA, name: 'APEX 50K', platform: 'MT5' },
    { id: acctB1, user_id: userB, name: 'B Funded', platform: 'MT5' },
  ]);
}

// ─── Alerts: dedupe + window cap + ownership ───────────────────
{
  console.log('alerts anti-spam');
  const db = makeMemoryDb();
  seed(db);
  const alerts = new AlertsService(db, new TradingDataAccess(db));

  const cand = {
    alert_type: 'recurrence',
    severity: 'warning',
    behavior_id: 'bhv-1',
    trade_id: 'tr-1',
    dedupe_key: 'recurrence:bhv-1:tr-1',
    message: 'Another occurrence.',
  };

  const a1 = await alerts.createAlert(userA, acctA1, cand);
  assert.ok(a1, 'first alert created');
  const dup = await alerts.createAlert(userA, acctA1, cand);
  assert.equal(dup, null, 'same dedupe key → no duplicate (DB unique)');

  const a2 = await alerts.createAlert(userA, acctA1, { ...cand, dedupe_key: 'recurrence:bhv-1:tr-2', trade_id: 'tr-2' });
  assert.ok(a2, 'second distinct alert allowed within cap');

  await assert.rejects(
    () => alerts.listAlerts(userB, acctA1),
    (err) => err.statusCode === 403 || /account|scope/i.test(err.message),
    'userB cannot read userA account alerts'
  );
  ok('dedupe_key prevents duplicates; cap allows; ownership enforced');
}

// ─── Alert candidates: pure backend triggers ───────────────────
{
  console.log('alert candidate triggers');
  const db = makeMemoryDb();
  const alerts = new AlertsService(db, new TradingDataAccess(db));

  const cands = alerts.postAnalysisCandidates({
    accountId: acctA1,
    analysis: { id: 'an-1' },
    behavior: { id: 'bhv-9', name: 'Revenge Trading', status: 'RECURRING', occurrence_count: 4 },
    trade: { id: 'tr-9', time_open: '2026-08-25T10:00:00Z' },
    priorTrade: { id: 'tr-8', pnl: -100, time_close: '2026-08-25T09:40:00Z', instrument: 'NQ' },
  });
  assert.equal(cands.length, 2, 'recurrence + post-loss-entry both trigger');
  assert.equal(cands[0].alert_type, 'recurrence');
  assert.equal(cands[0].severity, 'warning');
  assert.equal(cands[1].alert_type, 'post_loss_entry');

  const candsWin = alerts.postAnalysisCandidates({
    accountId: acctA1,
    behavior: { id: 'bhv-9', name: 'Revenge Trading', status: 'EMERGING', occurrence_count: 2 },
    trade: { id: 'tr-9', time_open: '2026-08-25T10:00:00Z' },
    priorTrade: { id: 'tr-8', pnl: 100, time_close: '2026-08-25T09:40:00Z' },
  });
  assert.equal(candsWin.length, 0, 'EMERGING behavior + prior win → no alerts');
  ok('postAnalysisCandidates: recurrence + post-loss triggers are backend facts');
}

// ─── Brief payload validation ──────────────────────────────────
{
  console.log('brief validation');
  const good = validateBriefPayload({ brief: 'Week looks steady.', focus: 'Watch early entries.' });
  assert.equal(good.brief, 'Week looks steady.');
  assert.equal(good.focus, 'Watch early entries.');

  assert.throws(() => validateBriefPayload('nope'), BriefValidationError);
  assert.throws(() => validateBriefPayload({ focus: 'no brief' }), /brief/);
  assert.throws(() => validateBriefPayload({ brief: 'x', win_rate: 0.8 }), /win_rate/);
  assert.throws(() => validateBriefPayload({ brief: 'x', what_changed: {} }), /what_changed/);
  ok('brief LLM output restricted to brief+focus only');
}
// ─── Brief: cache + staleness + provider-failure degradation ───
{
  console.log('brief caching & degradation');
  const db = makeMemoryDb();
  seed(db);
  db.insert('trades', [
    { id: 'tr-1', account_id: acctA1, pnl: -100, risk_per_trade: 100, time_open: '2026-08-24T10:00:00Z' },
    { id: 'tr-2', account_id: acctA1, pnl: -80, risk_per_trade: 100, time_open: '2026-08-25T10:00:00Z' },
    { id: 'tr-3', account_id: acctA1, pnl: 200, risk_per_trade: 100, time_open: '2026-08-26T10:00:00Z' },
    { id: 'tr-4', account_id: acctA1, pnl: -50, risk_per_trade: 100, time_open: '2026-08-10T10:00:00Z' },
  ]);
  db.insert('behaviors', [
    { id: 'bhv-neg', user_id: userA, account_id: acctA1, name: 'Early Entry', name_key: 'early_entry', behavior_type: 'negative', status: 'RECURRING', confidence: 0.8 },
    { id: 'bhv-pos', user_id: userA, account_id: acctA1, name: 'Patient Confirmation', name_key: 'patient_confirmation', behavior_type: 'positive', status: 'ESTABLISHED', confidence: 0.85 },
  ]);
  db.insert('behavior_evidence', [
    { id: 'ev-1', user_id: userA, account_id: acctA1, behavior_id: 'bhv-neg', trade_id: 'tr-1', created_at: '2026-08-24T11:00:00Z', metrics_snapshot: { pnl: -100, r_multiple: -1 } },
    { id: 'ev-2', user_id: userA, account_id: acctA1, behavior_id: 'bhv-pos', trade_id: 'tr-3', created_at: '2026-08-26T11:00:00Z', metrics_snapshot: { pnl: 200, r_multiple: 2 } },
  ]);

  const briefResponses = ['{"brief":"Steady week; watch early entries after losses.","focus":"Wait for confirmation."}'];
  const provider = {
    model: 'fake-model',
    async chat() {
      if (briefResponses.length === 0) throw new Error('Ollama down');
      return { content: briefResponses.shift(), reasoning: null, toolCalls: null };
    },
  };

  const composer = new BriefComposer(db, new TradingDataAccess(db), provider);

  // Sanity: week facts are backend-computed.
  const ws = BriefService.currentWeekStart(new Date('2026-08-27T00:00:00Z'));
  const facts = await composer.computeWeekFacts(userA, acctA1, ws);
  assert.equal(facts.week_stats.trade_count, 3, 'only this week trades counted');
  assert.equal(facts.biggest_leak_week.name, 'Early Entry');
  assert.equal(facts.strongest_week.name, 'Patient Confirmation');
  assert.ok(facts.what_changed, 'baseline diff present');

  // First call generates.
  const r1 = await composer.getOrGenerate(userA, acctA1);
  assert.equal(r1.generated, true, 'first generation');
  assert.ok(r1.brief.payload.trading_brief.includes('Steady week'));
  assert.equal(r1.brief.payload.computed_by, 'backend');

  // Second call serves the cache (no LLM call — provider would throw).
  briefResponses.length = 0;
  const r2 = await composer.getOrGenerate(userA, acctA1);
  assert.equal(r2.generated, false, 'cached on second load');
  assert.equal(r2.reason, 'cached');

  // Provider failure → degrade to cached brief, never throw.
  db.insert('behavior_alerts', [{ id: 'al-1', user_id: userA, account_id: acctA1, alert_type: 'recurrence', severity: 'warning', message: 'm', dedupe_key: 'k1', created_at: new Date().toISOString() }]);
  const r3 = await composer.getOrGenerate(userA, acctA1);
  assert.equal(r3.generated, false);
  assert.ok(['provider-failed-cached', 'cached'].includes(r3.reason), `degraded gracefully: ${r3.reason}`);
  assert.ok(r3.brief, 'brief still available when Ollama is down');
  ok('brief cached per week; stale detection; provider-down degrades to cache');
}

console.log(`\nAll ${passed} alerts/briefs tests passed.`);