import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'aura-backend', 'package.json'));
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', 'aura-backend', '.env') });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// 1. Sample failed job error messages
const { data: failed, error } = await supabase.from('ai_analyses').select('id, trade_id, account_id, attempts, max_attempts, last_error, created_at, updated_at, finished_at').eq('status', 'failed').order('updated_at', { ascending: false }).limit(10);
console.log('=== LAST 10 FAILED JOBS ===');
for (const j of failed || []) {
  console.log(`trade=${j.trade_id?.slice(0,8)} acct=${j.account_id?.slice(0,8)} attempts=${j.attempts}/${j.max_attempts}`);
  console.log(`  err: ${(j.last_error || '').slice(0, 200)}`);
  console.log(`  created=${j.created_at} updated=${j.updated_at} finished=${j.finished_at}`);
}

// 2. Check rate-limit recovery - are any failed jobs being requeued?
const { data: requeued } = await supabase.from('ai_analyses').select('id, trade_id, status, attempts, last_error, updated_at').eq('status', 'queued').eq('attempts', 0).not('last_error', 'is', null);
console.log('\n=== QUEUED JOBS WITH attempts=0 BUT HAD last_error (recently requeued?) ===');
console.log('count:', requeued?.length || 0);
for (const j of (requeued || []).slice(0, 5)) {
  console.log(`trade=${j.trade_id?.slice(0,8)} attempts=${j.attempts} updated=${j.updated_at}`);
}

// 3. Count failed by error type
const { data: allFailed } = await supabase.from('ai_analyses').select('last_error').eq('status', 'failed');
const errTypes = {};
for (const j of allFailed || []) {
  const err = (j.last_error || '').slice(0, 60);
  errTypes[err] = (errTypes[err] || 0) + 1;
}
console.log('\n=== FAILED JOB ERROR BREAKDOWN ===');
for (const [k, v] of Object.entries(errTypes).sort((a,b) => b[1]-a[1])) {
  console.log(`${v} × ${k}`);
}

// 4. Check if any rate-limit failures were requeued AND eventually succeeded
const { count: totalDone } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('status', 'done');
const { count: totalFailed } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('status', 'failed');
const { count: totalQueued } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('status', 'queued');
const { count: totalRunning } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('status', 'running');
console.log('\n=== OVERALL JOB COUNTS ===');
console.log(`done=${totalDone} failed=${totalFailed} queued=${totalQueued} running=${totalRunning}`);
