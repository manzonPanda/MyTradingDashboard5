#!/usr/bin/env node
/* Final consolidated verification snapshot (read-only, service role). */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'aura-backend', 'package.json'));
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', 'aura-backend', '.env') });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

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
  log('now=' + new Date().toISOString());
  const [an, ev, tr, bh] = await Promise.all([
    fetchAll('ai_analyses', 'id, account_id, trade_id, status, trigger'),
    fetchAll('behavior_evidence', 'id, account_id, trade_id, behavior_id'),
    fetchAll('trades', 'id, account_id'),
    fetchAll('behaviors', 'id, account_id'),
  ]);
  const st = {};
  for (const j of an) st[j.status] = (st[j.status] || 0) + 1;
  log('ai_analyses by status: ' + JSON.stringify(st));

  const doneTrades = new Set(an.filter((j) => j.status === 'done' && j.trade_id).map((j) => j.trade_id));
  log('distinct trades with a DONE analysis: ' + doneTrades.size);
  log('total done analysis rows: ' + (st.done || 0));
  log('total behaviors: ' + bh.length);
  log('total evidence records: ' + ev.length);

  // Duplicate evidence idempotency
  const seen = new Set(); let dups = 0;
  for (const e of ev) { const k = e.behavior_id + '|' + e.trade_id; if (seen.has(k)) dups++; seen.add(k); }
  log('duplicate (behavior_id,trade_id) evidence rows: ' + (dups === 0 ? 'NONE ✓' : dups));

  // Cross-account scope
  const tAcct = new Map(tr.map((t) => [t.id, t.account_id]));
  const bAcct = new Map(bh.map((b) => [b.id, b.account_id]));
  let crossEv = 0; let crossJob = 0;
  for (const e of ev) {
    if (tAcct.get(e.trade_id) !== e.account_id) crossEv++;
    if (bAcct.get(e.behavior_id) !== e.account_id) crossEv++;
  }
  for (const j of an) if (j.trade_id && tAcct.get(j.trade_id) !== j.account_id) crossJob++;
  log('cross-account evidence refs: ' + (crossEv === 0 ? 'NONE ✓' : crossEv));
  log('cross-account analysis jobs: ' + (crossJob === 0 ? 'NONE ✓' : crossJob));

  // Duplicate trade jobs now (all statuses)
  const byTrade = {};
  for (const j of an) if (j.trade_id) (byTrade[j.trade_id] = byTrade[j.trade_id] || []).push(j);
  const dupTrades = Object.entries(byTrade).filter(([, v]) => v.length > 1);
  log('trades with >1 analysis job: ' + dupTrades.length);
  if (dupTrades.length) {
    for (const [tid, jobs] of dupTrades) log(`   ${tid}: ${jobs.map((j) => `${j.trigger}/${j.status}`).join(', ')}`);
  }

  // Main account
  const mainAn = an.filter((j) => j.account_id === '0c5a7c00-0d30-4ae0-a02a-b7e5730e05d1');
  const mainBh = bh.filter((b) => b.account_id === '0c5a7c00-0d30-4ae0-a02a-b7e5730e05d1');
  const mainEv = ev.filter((e) => e.account_id === '0c5a7c00-0d30-4ae0-a02a-b7e5730e05d1');
  const ms = {}; for (const j of mainAn) ms[j.status] = (ms[j.status] || 0) + 1;
  log(`main account (5ers1️⃣7️⃣.3️⃣): analyses=${JSON.stringify(ms)} behaviors=${mainBh.length} evidence=${mainEv.length}`);

  fs.writeFileSync(path.join(__dirname, 'final_report.txt'), LOG.join('\n'), 'utf8');
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });