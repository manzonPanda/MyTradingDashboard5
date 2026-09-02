#!/usr/bin/env node
/* Targeted live verification: global queue totals, per-account summary,
   duplicate-analyzed trades, and main-account engine status. */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'aura-backend', 'package.json'));
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', 'aura-backend', '.env') });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const LOG = [];
const log = (m) => { LOG.push(m); console.log(m); };

async function fetchAll(table, fields) {
  const all = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase.from(table).select(fields).range(from, from + size - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    all.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return all;
}

async function main() {
  log('== A. GLOBAL QUEUE TOTALS ==');
  const allAn = await fetchAll('ai_analyses', 'id, account_id, trade_id, status, trigger, attempts, max_attempts, last_error, created_at, updated_at, finished_at');
  const bySt = {};
  for (const j of allAn) bySt[j.status] = (bySt[j.status] || 0) + 1;
  log(JSON.stringify(bySt));
  const rlFailed = allAn.filter((j) => j.status === 'failed' && /rate.?limit|429|Too\s*Many\s*Requests/i.test(j.last_error || ''));
  log(`rate-limit FAILED jobs: ${rlFailed.length}`);
  for (const j of rlFailed) log(`   failed rl: acct=${j.account_id} trade=${j.trade_id} attempts=${j.attempts}/${j.max_attempts} err=${(j.last_error || '').slice(0, 120)} updated=${j.updated_at}`);
  const everTagged = allAn.filter((j) => /rate limit|rate-limit|429|too many requests/i.test(j.last_error || ''));
  log(`jobs with rate-limit text in last_error: ${everTagged.length}`);
  for (const j of everTagged.slice(0, 8)) log(`   [${j.status}] trade=${j.trade_id} attempts=${j.attempts} err=${(j.last_error || '').slice(0, 90)}`);
  const retried = allAn.filter((j) => (j.attempts || 0) > 1);
  log(`jobs with attempts>1: ${retried.length} (done=${retried.filter((j) => j.status === 'done').length} queued=${retried.filter((j) => j.status === 'queued').length} failed=${retried.filter((j) => j.status === 'failed').length})`);

  log('\n== B. PER-ACCOUNT SUMMARY ==');
  const { data: accounts } = await supabase.from('accounts').select('id, name');
  const { data: tradesAll } = await supabase.from('trades').select('id, account_id, daily_reflection');
  const { data: behAll } = await supabase.from('behaviors').select('id, account_id');
  const { data: evAll } = await supabase.from('behavior_evidence').select('id, account_id');
  const tByA = {}; const trByA = {};
  for (const t of tradesAll || []) { tByA[t.account_id] = (tByA[t.account_id] || 0) + 1; if ((t.daily_reflection || '').trim()) trByA[t.account_id] = (trByA[t.account_id] || 0) + 1; }
  const bhByA = {}; for (const b of behAll || []) bhByA[b.account_id] = (bhByA[b.account_id] || 0) + 1;
  const evByA = {}; for (const e of evAll || []) evByA[e.account_id] = (evByA[e.account_id] || 0) + 1;
  log('account | trades/ref | analyses(Q,R,D,F,S) | beh | ev');
  for (const a of accounts || []) {
    const jobs = allAn.filter((j) => j.account_id === a.id);
    const st = (s) => jobs.filter((j) => j.status === s).length;
    log(`${a.name} | ${tByA[a.id] || 0}/${trByA[a.id] || 0} | ${jobs.length}(${st('queued')},${st('running')},${st('done')},${st('failed')},${st('skipped')}) | ${bhByA[a.id] || 0} | ${evByA[a.id] || 0}`);
  }

  log('\n== C. DUPLICATE-ANALYZED TRADES ==');
  const allTrades = await fetchAll('trades', 'id, account_id, ticket, time_open');
  const tradeById = new Map(allTrades.map((t) => [t.id, t]));
  const byTrade = {};
  for (const j of allAn) if (j.trade_id) (byTrade[j.trade_id] = byTrade[j.trade_id] || []).push(j);
  for (const [tid, jobs] of Object.entries(byTrade)) {
    if (jobs.length <= 1) continue;
    const t = tradeById.get(tid);
    const j0 = jobs[0];
    log(`trade ${tid} (${t?.ticket || '?'}) acct=${j0.account_id} ${t ? '' : 'trade-not-found'} has ${jobs.length} analysis rows`);
    for (const j of jobs) log(`   [${j.status}] trigger=${j.trigger} attempts=${j.attempts}/${j.max_attempts} created=${j.created_at} fin=${j.finished_at} err=${(j.last_error || '').slice(0, 60)}`);
  }

  log('\n== D. MAIN ACCOUNT DETAIL ==');
  const main = (accounts || []).find((a) => a.id === '0c5a7c00-0d30-4ae0-a02a-b7e5730e05d1');
  if (main) {
    const acctId = main.id;
    const jobs = allAn.filter((j) => j.account_id === acctId).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const st = (s) => jobs.filter((j) => j.status === s).length;
    log(`account=${main.name} id=${acctId} trades=${tByA[acctId] || 0} reflections=${trByA[acctId] || 0}`);
    log(`analyses total=${jobs.length} queued=${st('queued')} running=${st('running')} done=${st('done')} failed=${st('failed')} skipped=${st('skipped')} behaviors=${bhByA[acctId] || 0} evidence=${evByA[acctId] || 0}`);
    const byTrigger = {};
    for (const j of jobs) byTrigger[`${j.trigger}:${j.status}`] = (byTrigger[`${j.trigger}:${j.status}`] || 0) + 1;
    log(`trigger/status: ${JSON.stringify(byTrigger)}`);
    const dup = {};
    for (const j of jobs) if (j.trade_id) dup[j.trade_id] = (dup[j.trade_id] || 0) + 1;
    const multi = Object.entries(dup).filter(([, c]) => c > 1);
    log(`same-trade re-analysis: ${multi.length === 0 ? 'NONE ✓' : multi.map(([t, c]) => `${t}(${c})`).join(', ')}`);
    const hasPending = jobs.some((j) => j.status === 'queued' || j.status === 'running');
    log(`ENGINE STATUS: ${hasPending ? 'ANALYZING (not drained)' : (jobs.length === 0 ? 'needs_more_data' : 'up_to_date')}`);
  }

  fs.writeFileSync(path.join(__dirname, 'targeted_check.txt'), LOG.join('\n'), 'utf8');
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exit(1); });