#!/usr/bin/env node
/* One-liner snapshot of the live queue + main account + rate-limit failures.
   Appends every sample to tools/queue_history.jsonl (line-delimited JSON). */
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

const now = new Date().toISOString();
const all = [];
const size = 1000;
for (let from = 0; ; from += size) {
  const { data, error } = await supabase.from('ai_analyses').select('status, attempts, last_error, updated_at, account_id, trade_id').range(from, from + size - 1);
  if (error) throw new Error(error.message);
  all.push(...(data || []));
  if (!data || data.length < size) break;
}
const bySt = {};
for (const j of all) bySt[j.status] = (bySt[j.status] || 0) + 1;
const rlFailed = all.filter((j) => j.status === 'failed' && /rate.?limit/i.test(j.last_error || '')).length;
const mainJobs = all.filter((j) => j.account_id === '0c5a7c00-0d30-4ae0-a02a-b7e5730e05d1');
const mainSt = {};
for (const j of mainJobs) mainSt[j.status] = (mainSt[j.status] || 0) + 1;
let oldestFailed = null; let newestFailed = null; const rlExamples = [];
for (const j of all) {
  if (j.status !== 'failed' || !/rate.?limit/i.test(j.last_error || '')) continue;
  if (!oldestFailed || j.updated_at < oldestFailed) oldestFailed = j.updated_at;
  if (!newestFailed || j.updated_at > newestFailed) newestFailed = j.updated_at;
  if (rlExamples.length < 3) rlExamples.push({ id: j.id, trade: j.trade_id, acct: j.account_id });
}
const oldestQueued = all.filter((j) => j.status === 'queued').map((j) => j.updated_at).sort()[0];
const line = JSON.stringify({ now, total: bySt, rlFailed, mainAcct: { ...mainSt, total: mainJobs.length }, oldestFailed, newestFailed, oldestQueued, rlFirst3: rlExamples });
fs.appendFileSync(path.join(__dirname, 'queue_history.jsonl'), line + '\n', 'utf8');
console.log(line);