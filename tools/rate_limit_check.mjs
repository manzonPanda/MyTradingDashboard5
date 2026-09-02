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
  // 1. Overall job counts across ALL accounts
  const { count: total, error: ec } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true });
  const { count: done } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('status', 'done');
  const { count: failed } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('status', 'failed');
  const { count: queued } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('status', 'queued');
  const { count: running } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('status', 'running');
  log('=== OVERALL AI ANALYSIS JOBS ===');
  log(`total=${total} done=${done} failed=${failed} queued=${queued} running=${running}`);

  // 2. Rate-limit failures: show that failed-then-recovered pattern
  // Check if any trade that had a failed job (rate limit) eventually has a done job
  const { data: failedJobs } = await supabase.from('ai_analyses').select('trade_id, account_id, attempts, last_error, created_at, finished_at').eq('status', 'failed').not('last_error', 'is', null);

  // Check if ANY of those trades have a done analysis now
  const recoveredTrades = [];
  for (const fj of failedJobs) {
    const { count } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('trade_id', fj.trade_id).eq('status', 'done');
    if (count > 0) recoveredTrades.push(fj.trade_id);
  }
  log(`\nFailed jobs: ${failedJobs.length}`);
  log(`Failed trades that later SUCCEEDED (recovered): ${recoveredTrades.length}`);

  // 3. Rate-limit specific: show retry pattern
  const rlFailures = failedJobs.filter(j => j.last_error?.includes('Rate limit'));
  log(`Rate-limit failures: ${rlFailures.length}`);
  log('Rate-limit retry attempts distribution:');
  const attemptDist = {};
  for (const j of rlFailures) { attemptDist[j.attempts] = (attemptDist[j.attempts] || 0) + 1; }
  for (const [k, v] of Object.entries(attemptDist).sort((a,b) => a[0]-b[0])) {
    log(`  attempts=${k}: ${v} jobs`);
  }

  // 4. Show a sample rate-limit failure that recovered
  if (recoveredTrades.length > 0) {
    const sampleTrade = recoveredTrades[0];
    const { data: allJobs } = await supabase.from('ai_analyses').select('id, status, attempts, last_error, created_at, updated_at').eq('trade_id', sampleTrade).order('created_at', { ascending: true });
    log(`\nSAMPLE recovered trade: ${sampleTrade.slice(0,8)}`);
    for (const j of allJobs) {
      log(`  ${j.status} attempts=${j.attempts} err=${(j.last_error || '').slice(0,50)}`);
    }
  }

  // 5. Check queue drain rate
  const { data: recentQueues } = await supabase.from('ai_analyses').select('created_at').eq('status', 'queued').order('created_at', { ascending: false }).limit(5);
  log(`\nMost recent queued jobs created_at:`);
  for (const j of recentQueues) log(`  ${j.created_at}`);
  
  // 6. Check if any queued jobs are OLD (stuck)
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  const { count: oldQueued } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('status', 'queued').lt('created_at', oneHourAgo);
  log(`\nQueued jobs older than 1h (stuck): ${oldQueued}`);

  // 7. Check running jobs
  const { data: runningJobs } = await supabase.from('ai_analyses').select('id, trade_id, account_id, attempts, created_at, updated_at, last_error').eq('status', 'running').order('updated_at', { ascending: false }).limit(5);
  log(`\nRunning jobs: ${runningJobs.length}`);
  for (const j of runningJobs) {
    log(`  trade=${j.trade_id?.slice(0,8)} attempts=${j.attempts} updated=${j.updated_at}`);
  }

}

main().catch(e => console.error(e));
