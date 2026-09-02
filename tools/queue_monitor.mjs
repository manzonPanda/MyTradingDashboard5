#!/usr/bin/env node
/**
 * Live Behavior Engine verification — queries the REAL Supabase project via
 * the service-role client (read-only, same access the backend uses).
 *
 * Reports per-account:
 *   - trades / reflective trades
 *   - ai_analyses by status (queued/running/done/failed/skipped)
 *   - behaviors / behavior_evidence counts
 *   - duplicate analysis check (same trade_id -> >1 ai_analyses row)
 *   - rate-limit+retry evidence (attempts>0, last_error)
 *   - failed jobs with reasons
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'aura-backend', 'package.json'));
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', 'aura-backend', '.env') });

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const row = (v) => (v ?? 0);

const LOG = [];
const log = (m) => { LOG.push(m); console.log(m); };

async function fetchAll(supabase, table, fields, accountField = null) {
  const all = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    let q = supabase.from(table).select(fields).range(from, from + size - 1);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    all.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return all;
}

async function main() {
  const out = [];
  const { data: users, error: uErr } = await supabase.from('profiles').select('id, email');
  log('== USERS ==');
  if (uErr) log('profiles error: ' + uErr.message);
  else log(JSON.stringify(users));

  const { data: accounts, error: aErr } = await supabase.from('accounts').select('id, user_id, name, platform, phase, status');
  log('\n== ACCOUNTS ==');
  if (aErr) return log('accounts error: ' + aErr.message);
  accounts.forEach((a) => log(`  ${a.name}  (${a.id}) user=${a.user_id}`));

  for (const acc of accounts || []) {
    console.log(`\n════════ ACCOUNT ${acc.name} (${acc.id}) ════════`);
    const [tRes, aRes, bRes, eRes] = await Promise.all([
      supabase.from('trades').select('id,pnl,time_close,time_open,daily_reflection,ticket').eq('account_id', acc.id),
      supabase.from('ai_analyses').select('id,trade_id,status,attempts,max_attempts,last_error,trigger,updated_at,created_at,finished_at').eq('account_id', acc.id),
      supabase.from('behaviors').select('id,name,name_key,behavior_type,status,occurrence_count,confidence,estimated_impact_pnl').eq('account_id', acc.id),
      supabase.from('behavior_evidence').select('id,behavior_id,trade_id,week_start,evidence_confidence').eq('account_id', acc.id),
    ]);

    const trades = tRes.data || [];
    const an = aRes.data || [];
    const bhs = bRes.data || [];
    const ev = eRes.data || [];

    const status = (s) => an.filter((j) => j.status === s).length;
    console.log(`trades=${trades.length} reflections=${trades.filter((t) => (t.daily_reflection || '').trim()).length}`);
    console.log(`ai_analyses total=${an.length} queued=${status('queued')} running=${status('running')} done=${status('done')} failed=${status('failed')} skipped=${status('skipped')}`);
    console.log(`behaviors=${bhs.length} evidence=${ev.length}`);

    // Duplicate analysis check: multiple jobs for the same trade.
    const dup = {};
    for (const j of an) if (j.trade_id) dup[j.trade_id] = (dup[j.trade_id] || 0) + 1;
    const dups = Object.entries(dup).filter(([, c]) => c > 1);
    console.log(`duplicate-analysis trades: ${dups.length === 0 ? 'NONE ✓' : dups.map(([t, c]) => `${t}(${c})`).join(', ')}`);

    // Retried / rate-limit jobs.
    const retried = an.filter((j) => (j.attempts || 0) > 0);
    console.log(`jobs with attempts>0 (retried/requeued): ${retried.length}`);
    for (const j of retried.slice(0, 10)) {
      console.log(`   [${j.status}] attempts=${j.attempts}/${j.max_attempts} trigger=${j.trigger} err=${(j.last_error || '').slice(0, 140)}`);
    }
    const rl = an.filter((j) => /rate\.?limit|429|Too Many Requests/i.test(j.last_error || ''));
    console.log(`rate-limit-tagged jobs: ${rl.length}`);

    // Failed jobs detail.
    const failed = an.filter((j) => j.status === 'failed');
    if (failed.length) {
      console.log('FAILED JOBS:');
      failed.forEach((j) => console.log(`   trade=${j.trade_id} err=${(j.last_error || '').slice(0, 200)}`));
    }

    // Behavior detail.
    if (bhs.length) {
      console.log('BEHAVIORS:');
      bhs.forEach((b) => console.log(`   ${b.name} [${b.behavior_type}/${b.status}] occ=${b.occurrence_count} conf=${b.confidence} impact=${b.estimated_impact_pnl}`));
    }
  }

  // Evidence sanity: every evidence.trade_id belongs to the SAME account.
  log('\n== EVIDENCE ACCOUNT SCOPING ==');
  const [allEv, allTrades, allBhs] = await Promise.all([
    fetchAll(supabase, 'behavior_evidence', 'id, account_id, trade_id, behavior_id'),
    fetchAll(supabase, 'trades', 'id, account_id'),
    fetchAll(supabase, 'behaviors', 'id, account_id'),
  ]);
  log(`checked evidence=${allEv.length} trades=${allTrades.length} behaviors=${allBhs.length}`);
  const tradeAcct = new Map((allTrades || []).map((t) => [t.id, t.account_id]));
  const bhAcct = new Map((allBhs || []).map((b) => [b.id, b.account_id]));
  let crossOk = true;
  for (const ev of allEv || []) {
    const tAcct = tradeAcct.get(ev.trade_id);
    const bAcct = bhAcct.get(ev.behavior_id);
    if (tAcct !== ev.account_id) { crossOk = false; log(`  CROSS: evidence ${ev.id} trade ${ev.trade_id} -> acct ${tAcct} != ${ev.account_id}`); }
    if (bAcct !== ev.account_id) { crossOk = false; log(`  CROSS: evidence ${ev.id} behavior ${ev.behavior_id} -> acct ${bAcct} != ${ev.account_id}`); }
  }
  log(crossOk ? 'All evidence rows reference same-account trades/behaviors ✓' : 'CROSS-ACCOUNT REFERENCE FOUND ✗');

  // Behavioral duplicate evidence check (idempotency proof).
  log('\n== EVIDENCE IDEMPOTENCY ==');
  const seen = new Set();
  let dupEv = 0;
  for (const ev of allEv || []) {
    const k = `${ev.behavior_id}|${ev.trade_id}`;
    if (seen.has(k)) { dupEv++; log(`  duplicate evidence key ${k} (id ${ev.id})`); }
    seen.add(k);
  }
  log(dupEv === 0 ? `No duplicate (behavior_id, trade_id) evidence rows ✓ (${seen.size} unique)` : `${dupEv} DUPLICATE evidence rows ✗`);

  // Cross-account analysis jobs: job account vs trade account.
  log('\n== ANALYSIS JOB ACCOUNT SCOPING ==');
  const allAn = await fetchAll(supabase, 'ai_analyses', 'id, account_id, trade_id, status');
  let anCross = 0;
  for (const j of allAn || []) {
    if (j.trade_id && tradeAcct.get(j.trade_id) !== j.account_id) { anCross++; log(`  CROSS: job ${j.id} trade ${j.trade_id} -> acct ${tradeAcct.get(j.trade_id)} != ${j.account_id}`); }
  }
  log(anCross === 0 ? `All ${allAn.length} analysis jobs target same-account trades ✓` : `${anCross} cross-account analysis jobs ✗`);

  // Duplicate trade analyses globally.
  const byTrade = {};
  for (const j of allAn || []) if (j.trade_id) byTrade[j.trade_id] = (byTrade[j.trade_id] || 0) + 1;
  const dupTrades = Object.entries(byTrade).filter(([, c]) => c > 1);
  log(dupTrades.length === 0 ? 'No trade analyzed more than once ✓' : `Trades analyzed twice: ${dupTrades.map(([t, c]) => `${t}(${c})`).join(', ')}`);

  fsSync.writeFileSync(path.join(__dirname, 'queue_monitor.txt'), LOG.join('\n'), 'utf8');
}

import fsSync from 'node:fs';
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });