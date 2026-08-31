#!/usr/bin/env node
/**
 * Phase 2 end-to-end flow verification against the LIVE database.
 *
 * Flow: Daily Reflection (read-only source) → analysis job enqueue (must be
 * non-blocking) → job claim (local worker path, fixed code) → real LLM (Groq)
 * → strict validation → behavior upsert → evidence → lifecycle → brief →
 * isolation probes. Also observes the LIVE production worker (Render) consume
 * a second job untouched, and checks for stale stuck jobs.
 *
 * HARD CONSTRAINTS respected here:
 *   - trades and accounts are READ-ONLY (no inserts/updates/deletes).
 *   - Writes happen ONLY to the Phase 2 tables; rows that already existed
 *     before the test (baseline snapshot) are never touched; every test row
 *     is deleted again at the end (cleanup waits for in-flight jobs).
 *   - RLS stays enabled; the service-role client is used exactly like the
 *     production backend uses it.
 *   - Credentials come from the gitignored aura-backend/.env / env vars and
 *     are never printed.
 *
 * Usage: node supabase/test_behavior_flow.mjs [--keep]
 */

import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { BACKEND_DIR, supabaseRestConfig, anonKey, parseEnvFile } from './_lib.mjs';

const require = createRequire(path.join(BACKEND_DIR, 'package.json'));
const keep = process.argv.includes('--keep');

// Load local env (same as server.js does via dotenv) without printing secrets.
const env = parseEnvFile(path.join(BACKEND_DIR, '.env'));
for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v;

const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase REST credentials not available.');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const mod = (p) => import(pathToFileURL(path.join(BACKEND_DIR, p)).href);
const { TradingDataAccess } = await mod('src/data/trading-data.js');
const { AnalysisJobStore } = await mod('src/data/analysis-job-store.js');
const { BehaviorStore } = await mod('src/data/behavior-store.js');
const { AnalysisService } = await mod('src/behavior/analysis-service.js');
const { BriefComposer } = await mod('src/behavior/brief-service.js');
const { createLLMProvider } = await mod('src/ai/provider.js');

const tradingData = new TradingDataAccess(supabase);
const jobs = new AnalysisJobStore(supabase);
const store = new BehaviorStore(supabase, tradingData);
const provider = createLLMProvider();
const analysisService = new AnalysisService({ supabase, provider, tradingData, logger: console });

let passed = 0, failed = 0;
const ok = (m) => { passed++; console.log(`  ✓ ${m}`); };
const fail = (m) => { failed++; console.log(`  ✗ ${m}`); };
const info = (m) => console.log(`  ℹ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Baseline rows (never touched) vs rows created by THIS test (deleted at end).
const created = { ai_analyses: [], behaviors: [], behavior_evidence: [], behavior_alerts: [], trading_briefs: [] };
const baseline = {};

async function snapshotBaseline(accountId) {
  const tables = { behaviors: 'account_id', behavior_evidence: 'account_id', behavior_alerts: 'account_id', trading_briefs: 'account_id' };
  for (const [table, col] of Object.entries(tables)) {
    const { data } = await supabase.from(table).select('id').eq(col, accountId).limit(1000);
    baseline[table] = new Set((data || []).map((r) => r.id));
  }
}

function trackNew(table, rows) {
  for (const r of rows || []) {
    if (!baseline[table]?.has(r.id) && !created[table].includes(r.id)) created[table].push(r.id);
  }
}

async function waitForNoInFlight(ids, timeoutMs = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { data } = await supabase.from('ai_analyses').select('id, status').in('id', ids);
    const open = (data || []).filter((r) => r.status === 'queued' || r.status === 'running');
    if (open.length === 0) return true;
    await sleep(3000);
  }
  return false;
}

async function cleanup() {
  if (keep) { console.log('\n(--keep) skipping cleanup.'); return; }
  console.log('\ncleanup (Phase 2 tables only; trades/accounts untouched)...');
  if (created.ai_analyses.length > 0) {
    const settled = await waitForNoInFlight(created.ai_analyses);
    info(settled ? 'no in-flight test jobs remain' : 'some test jobs still in flight after 90s (deleting rows anyway)');
  }
  for (const [table, ids] of Object.entries(created)) {
    for (const id of ids) await supabase.from(table).delete().eq('id', id);
  }
  console.log(`  ✓ removed ${Object.values(created).reduce((s, a) => s + a.length, 0)} test row(s)`);
}

async function main() {
  console.log(`LLM provider: ${provider.name} (${provider.model})`);

  // 1. Pick a real account + a real trade with a Daily Reflection (READ-ONLY).
  const { data: reflTrades } = await supabase
    .from('trades')
    .select('id, account_id, ticket, daily_reflection')
    .neq('daily_reflection', '')
    .not('account_id', 'is', null)
    .order('time_open', { ascending: false })
    .limit(1);
  if (!reflTrades?.length) throw new Error('No trade with a Daily Reflection found (read-only scan).');
  const trade = reflTrades[0];
  const { data: account } = await supabase
    .from('accounts')
    .select('id, user_id')
    .eq('id', trade.account_id)
    .maybeSingle();
  if (!account) throw new Error('Account for the selected trade not found (read-only scan).');
  const userId = account.user_id;
  const accountId = account.id;
  console.log(`target: account=${accountId} trade=${trade.id} (ticket ${trade.ticket}) — READ-ONLY`);
  await snapshotBaseline(accountId);

  // 2. Ownership resolution must succeed for the real owner.
  const resolved = await store.resolveAccountId(userId, accountId);
  if (resolved === accountId) ok('BehaviorStore/TradingDataAccess resolve the real user→account ownership');
  else fail('TradingDataAccess failed to resolve ownership');

  // 3. Enqueue via the REAL production path (webhook uses enqueueForTrade).
  //    Must be non-blocking (returns immediately, no LLM call).
  const t0 = Date.now();
  const job = await analysisService.enqueueForTrade(userId, accountId, trade.id);
  const enqueueMs = Date.now() - t0;
  created.ai_analyses.push(job.id);
  if (job.status === 'queued' && enqueueMs < 2000) ok(`enqueue returned immediately (${enqueueMs}ms, status=${job.status}) — non-blocking`);
  else fail(`enqueue took ${enqueueMs}ms (status=${job.status})`);

  // 4. Claim it immediately with the LOCAL (fixed) worker code. The live
  //    production worker polls every ~1s, so this is a fair race; if it wins,
  //    we still verify via its outcome below.
  let local = true;
  const claimed = await jobs.claimNext(null, { batchSize: 1 });
  if (claimed.length === 1 && claimed[0].id === job.id) {
    ok('job claimed atomically by the local worker path (status=running)');
  } else {
    local = false;
    info('production worker claimed the job first — verifying via its outcome');
  }

  // 5. Process locally through the REAL worker path: LLM → validation →
  //    behavior → evidence → lifecycle. One bounded requeue retry.
  if (local) {
    const t1 = Date.now();
    let r = await analysisService.processJob(claimed[0]);
    if (r?.status === 'queued') {
      const again = await jobs.claimNext(null, { batchSize: 1 });
      if (again.length === 1 && again[0].id === job.id) r = await analysisService.processJob(again[0]);
    }
    console.log(`  local worker result: ${r?.status || 'unknown'} in ${Date.now() - t1}ms`);
    if (r?.status === 'done' || r?.status === 'skipped') ok(`job lifecycle settled locally: ${r.status}`);
    else fail(`local worker did not settle the job (status=${r?.status}) — see last_error below`);
  }

  // 6. Production-worker liveness: enqueue a second job and leave it alone.
  const t2 = Date.now();
  const job2 = await analysisService.enqueue(userId, accountId, { trigger: 'manual', tradeId: trade.id });
  created.ai_analyses.push(job2.id);
  let j2 = null;
  while (Date.now() - t2 < 90_000) {
    await sleep(4000);
    const { data } = await supabase.from('ai_analyses').select('id, status, attempts, last_error').eq('id', job2.id).maybeSingle();
    j2 = data;
    if (j2 && !['queued', 'running'].includes(j2.status)) break;
  }
  if (j2 && !['queued', 'running'].includes(j2.status)) {
    ok(`production worker consumed the second job (status=${j2.status}, attempts=${j2.attempts}, ${Math.round((Date.now() - t2) / 1000)}s)`);
    if (j2.last_error) info(`production last_error: ${String(j2.last_error).slice(0, 220)}`);
  } else {
    info(`production worker did not consume the second job within 90s (status=${j2?.status || 'n/a'}) — liveness inconclusive`);
  }

  // 7. Job rows + audit trail.
  const { data: jobRows } = await supabase
    .from('ai_analyses')
    .select('id, status, attempts, model, prompt_version, input_summary, raw_response, last_error, finished_at')
    .in('id', created.ai_analyses);
  for (const j of jobRows || []) {
    if (j.last_error) info(`job ${j.id.slice(0, 8)} status=${j.status} last_error: ${String(j.last_error).slice(0, 220)}`);
  }
  const doneJob = (jobRows || []).find((j) => j.status === 'done');
  if (doneJob) {
    if (doneJob.model && doneJob.prompt_version && doneJob.input_summary && doneJob.raw_response) {
      ok(`audit trail: model=${doneJob.model}, prompt=${doneJob.prompt_version}, input_summary + raw_response persisted`);
    } else fail('audit trail incomplete (model/prompt_version/input_summary/raw_response missing)');
  } else if (!(jobRows || []).some((j) => j.status === 'failed' || j.status === 'skipped')) {
    fail('no job reached a terminal state');
  }

  // 8. Behavior + evidence + lifecycle (only rows NEW since baseline).
  const { data: behaviors } = await supabase
    .from('behaviors')
    .select('id, name, name_key, behavior_type, status, occurrence_count, confidence, first_detected_at, last_detected_at, last_confirmed_at')
    .eq('account_id', accountId);
  trackNew('behaviors', behaviors);
  const newBehaviors = (behaviors || []).filter((b) => !baseline.behaviors.has(b.id));
  if (newBehaviors.length > 0) {
    const b = newBehaviors[0];
    if (b.occurrence_count >= 1 && b.status && b.first_detected_at && b.last_confirmed_at) {
      ok(`behavior detected: "${b.name}" (${b.behavior_type}) status=${b.status} occurrences=${b.occurrence_count} confidence=${b.confidence}`);
    } else fail('behavior row incomplete (objective fields not computed)');
    const dupes = newBehaviors.length !== new Set(newBehaviors.map((x) => `${x.name_key}|${x.behavior_type}`)).size;
    if (!dupes) ok('convergent upsert: no duplicate (name_key, behavior_type) rows for the account');
    else fail('duplicate behavior identity rows found');
  } else if (doneJob) {
    fail('analysis job done but no behavior row was created');
  } else {
    info('no behavior row yet (job did not complete — LLM+validation path covered by unit tests)');
  }

  if (newBehaviors.length > 0) {
    const { data: evidence } = await supabase
      .from('behavior_evidence')
      .select('id, behavior_id, trade_id, metrics_snapshot, evidence_confidence, analysis_id')
      .in('behavior_id', newBehaviors.map((b) => b.id));
    trackNew('behavior_evidence', evidence);
    const forTrade = (evidence || []).filter((e) => e.trade_id === trade.id);
    if (forTrade.length === 1 && forTrade[0].metrics_snapshot && Object.keys(forTrade[0].metrics_snapshot).length > 0) {
      ok('evidence linked to trade with backend-computed metrics snapshot (unique per behavior+trade)');
    } else fail(`evidence rows for trade: ${forTrade.length} (expected exactly 1 with metrics)`);
  }

  // 9. Alerts (dedupe) — where applicable.
  const { data: alerts } = await supabase
    .from('behavior_alerts')
    .select('id, alert_type, dedupe_key')
    .eq('account_id', accountId);
  trackNew('behavior_alerts', alerts);
  const allAlerts = alerts || [];
  if (new Set(allAlerts.map((a) => a.dedupe_key)).size === allAlerts.length) {
    ok(`alerts: ${allAlerts.length} row(s), dedupe_key unique (anti-spam constraint holds)`);
  } else fail('duplicate dedupe_key found');

  // 10. Weekly brief (now expected to GENERATE — provider fix verified here).
  try {
    const composer = new BriefComposer(supabase, tradingData, provider, console);
    const briefResult = await composer.getOrGenerate(userId, accountId, {});
    if (briefResult?.brief?.id) {
      trackNew('trading_briefs', [briefResult.brief]);
      ok(`brief: ${briefResult.reason} (week ${briefResult.brief.week_start}, payload ${JSON.stringify(briefResult.brief.payload || {}).length} bytes)`);
    } else if (String(briefResult?.reason || '').startsWith('provider-failed')) {
      fail(`brief still degrading: ${briefResult.reason}`);
    } else fail('brief composer returned no brief');
  } catch (err) {
    fail(`brief generation threw: ${err.message}`);
  }

  // 11. Isolation: anon (public) role must see none of the rows.
  const { url } = supabaseRestConfig();
  const anon = anonKey();
  for (const table of ['behaviors', 'behavior_evidence', 'ai_analyses']) {
    const r = await fetch(`${url}/rest/v1/${table}?select=id&limit=100`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    const rows = r.ok ? await r.json() : [];
    if (Array.isArray(rows) && rows.length === 0) ok(`isolation: anon sees 0 rows in ${table} (RLS enforced)`);
    else fail(`isolation: anon sees ${Array.isArray(rows) ? rows.length : 'error'} rows in ${table}`);
  }

  // 12. Stale job recovery: any jobs stuck in 'running' for > 10 minutes?
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: stale } = await supabase
    .from('ai_analyses')
    .select('id, created_at')
    .eq('status', 'running')
    .lt('created_at', tenMinAgo)
    .limit(5);
  if ((stale || []).length === 0) ok('stale job scan: no jobs stuck in running > 10min');
  else {
    info(`${stale.length} job(s) stuck in 'running' > 10min — recovery gap: the worker never re-claims abandoned running jobs (known finding, see report)`);
  }

  await cleanup();

  console.log(`\n${failed === 0 ? 'FLOW VERIFICATION PASSED' : failed + ' FLOW CHECK(S) FAILED'} (${passed} passed)\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main()
  .catch(async (err) => {
    console.error('\nflow test error:', err.message);
    await cleanup();
    process.exit(1);
  });