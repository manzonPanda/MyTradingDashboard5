import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'aura-backend', 'package.json'));
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', 'aura-backend', '.env') });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const log = (m) => console.log(m);

async function main() {
  const ts = new Date().toISOString();
  
  // Overall counts
  const counts = {};
  for (const status of ['queued', 'running', 'done', 'failed', 'skipped']) {
    const { count } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('status', status);
    counts[status] = count;
  }
  const { count: total } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true });
  const { count: rateLimitFailed } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('status', 'failed').ilike('last_error', '%rate limit%');

  log(`=== QUEUE SNAPSHOT @ ${ts} ===`);
  log(`total=${total} queued=${counts.queued} running=${counts.running} done=${counts.done} failed=${counts.failed} skipped=${counts.skipped}`);
  log(`rate-limit failures: ${rateLimitFailed}`);
  
  // Oldest queued job
  const { data: oldest } = await supabase.from('ai_analyses').select('id, account_id, trade_id, created_at, updated_at').eq('status', 'queued').order('created_at', { ascending: true }).limit(1);
  if (oldest[0]) {
    const ageMin = (Date.now() - new Date(oldest[0].created_at).getTime()) / 60000;
    log(`oldest queued: ${oldest[0].created_at} (${Math.round(ageMin)} min old)`);
  }
  
  // Distinct analyzed trades
  const { data: doneJobs } = await supabase.from('ai_analyses').select('trade_id').eq('status', 'done').not('trade_id', 'is', null);
  const distinctDone = new Set(doneJobs.map(j => j.trade_id)).size;
  log(`distinct trades analyzed (done): ${distinctDone}`);
  
  // Main account
  const ACCT = '0c5a7c00-0d30-4ae0-a02a-b7e5730e05d1';
  const { count: mainDone } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('account_id', ACCT).eq('status', 'done');
  const { count: mainQueued } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('account_id', ACCT).eq('status', 'queued');
  const { count: mainFailed } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('account_id', ACCT).eq('status', 'failed');
  log(`\nMAIN ACCOUNT (${ACCT.slice(0,8)}):`);
  log(`  done=${mainDone} queued=${mainQueued} failed=${mainFailed}`);
  
  // AI analyses
  log(`\n=== 3. AI ANALYSES ===`);
  log(`total done=${counts.done} failed=${counts.failed} queued=${counts.queued} running=${counts.running}`);
  
  // Behaviors + evidence on main account
  const { count: behCount } = await supabase.from('behaviors').select('id', { count: 'exact', head: true }).eq('account_id', ACCT);
  const { count: evCount } = await supabase.from('behavior_evidence').select('id', { count: 'exact', head: true }).eq('account_id', ACCT);
  log(`\n=== 4. BEHAVIORS ===`);
  log(`main account behaviors: ${behCount}`);
  log(`\n=== 5. EVIDENCE ===`);
  log(`main account evidence: ${evCount}`);
  
  // Failed/requeued
  log(`\n=== 6. FAILED/REQUEUED ===`);
  log(`failed: ${counts.failed} (of which rate-limit: ${rateLimitFailed})`);
  log(`requeue mechanism: requeueRateLimitFailures runs every 60s per account, resets attempts=0 for rate-limit failures older than 15min`);
  log(`worker pace: 1 job per 6s (WORKER_JOB_PACE_MS=6000)`);
  log(`throughput: ~5 jobs/min when rate-limited (~10/min when healthy)`);
  log(`estimated drain time at current rate: ~${Math.round(counts.queued / 5)} min (if rate limits persist, much longer)`);
}

main().catch(e => { console.error(e); process.exit(1); });
