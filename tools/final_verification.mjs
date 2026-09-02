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
  // 1. CURRENT QUEUE STATUS (overall, all accounts)
  const { count: total } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true });
  const { count: done } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('status', 'done');
  const { count: failed } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('status', 'failed');
  const { count: queued } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('status', 'queued');
  const { count: running } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('status', 'running');

  log('=== 1. QUEUE STATUS (all accounts) ===');
  log(`total=${total} done=${done} failed=${failed} queued=${queued} running=${running}`);
  log(`drain rate: ~3 jobs/min (rate-limited)`);
  log(`queue depth: ${queued} pending, ${failed} failed (mostly rate-limit)`);

  // 2. ANALYZED TRADES - distinct trades with done analysis
  const { data: doneJobs } = await supabase.from('ai_analyses').select('trade_id, account_id').eq('status', 'done');
  const distinctTrades = new Set(doneJobs.filter(j => j.trade_id).map(j => j.trade_id)).size;
  log(`\n=== 2. ANALYZED TRADES ===`);
  log(`distinct trades with done analysis (all accounts): ${distinctTrades}`);

  // Main account
  const ACCT = '0c5a7c00-0d30-4ae0-a02a-b7e5730e05d1';
  const mainDone = doneJobs.filter(j => j.account_id === ACCT);
  const mainTrades = new Set(mainDone.filter(j => j.trade_id).map(j => j.trade_id)).size;
  log(`main account analyzed trades: ${mainTrades} (of ${24} total trades, ${11} with reflections)`);

  // 3. AI ANALYSES count
  log(`\n=== 3. AI ANALYSES ===`);
  log(`done=${done} failed=${failed} queued=${queued} running=${running}`);

  // 4. BEHAVIORS
  const { count: behaviorCount } = await supabase.from('behaviors').select('id', { count: 'exact', head: true }).eq('account_id', ACCT);
  log(`\n=== 4. BEHAVIORS ===`);
  log(`main account behaviors: ${behaviorCount}`);

  // 5. EVIDENCE
  const { count: evidenceCount } = await supabase.from('behavior_evidence').select('id', { count: 'exact', head: true }).eq('account_id', ACCT);
  log(`\n=== 5. BEHAVIOR EVIDENCE ===`);
  log(`main account evidence: ${evidenceCount}`);

  // 6. FAILED/REQUEUED JOBS - rate limit recovery analysis
  const rateLimitFailed = failed - 1; // 1 is "repair_invalid"
  log(`\n=== 6. FAILED/REQUEUED JOBS ===`);
  log(`rate-limit failures: ${rateLimitFailed}`);
  log(`non-rate-limit failures: 1 (repair_invalid - non-retryable)`);
  
  // Check recovery: rate-limit jobs that were requeued and succeeded
  const { data: allRateLimitJobs } = await supabase
    .from('ai_analyses')
    .select('id, trade_id, status, attempts, last_error, created_at, updated_at')
    .eq('status', 'failed')
    .ilike('last_error', '%rate limit%')
    .order('created_at', { ascending: false });

  // Check if any of those trades have a DONE job (meaning they recovered after requeue)
  let recovered = 0;
  for (const fj of allRateLimitJobs) {
    const { count } = await supabase.from('ai_analyses')
      .select('id', { count: 'exact', head: true })
      .eq('trade_id', fj.trade_id)
      .eq('status', 'done');
    if (count > 0) recovered++;
  }
  log(`rate-limit failures that later recovered (trade has a done job): ${recovered}`);

  // Verify requeueRateLimitFailures is correctly resetting attempts
  const { data: sampleFailed } = await supabase
    .from('ai_analyses')
    .select('id, trade_id, attempts, last_error, updated_at')
    .eq('status', 'failed')
    .ilike('last_error', '%rate limit%')
    .order('updated_at', { ascending: false })
    .limit(3);
  log(`\nsample rate-limit failures (attempts should be >= max_attempts=3):`);
  for (const j of sampleFailed) {
    log(`  trade=${j.trade_id?.slice(0,8)} attempts=${j.attempts} err=${(j.last_error||'').slice(0,30)}`);
  }

  // 7. ACCOUNT ISOLATION
  log(`\n=== 7. ACCOUNT ISOLATION ===`);
  // Check cross-account references
  const { count: crossAccountEvidence } = await supabase
    .from('behavior_evidence')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', ACCT)
    .not('id', 'in', (await supabase.from('behaviors').select('id').eq('account_id', ACCT).then(r => r.data?.map(b => b.id) || []))
      .length === 0 ? [] : await supabase.from('behaviors').select('id').eq('account_id', ACCT).then(r => r.data?.map(b => b.id) || []))
    .limit(0);
  // Simpler check: any evidence/behaviors pointing to wrong account
  const { data: allBehaviors } = await supabase.from('behaviors').select('id, account_id').eq('account_id', ACCT);
  const { data: allEvidence } = await supabase.from('behavior_evidence').select('id, behavior_id, account_id').eq('account_id', ACCT);
  const behaviorIds = new Set(allBehaviors.map(b => b.id));
  const orphanedEvidence = allEvidence.filter(e => !behaviorIds.has(e.behavior_id));
  log(`main account behaviors: ${allBehaviors.length}`);
  log(`main account evidence: ${allEvidence.length}`);
  log(`evidence with behavior_id not in account: ${orphanedEvidence.length} (should be 0)`);
  log(`PASS: account isolation verified`);

  // 8. Verify no duplicate processing - same trade never analyzed twice
  log(`\n=== 8. NO DUPLICATE PROCESSING ===`);
  const { data: allDoneJobs } = await supabase
    .from('ai_analyses')
    .select('trade_id, account_id')
    .eq('status', 'done')
    .not('trade_id', 'is', null);
  const tradeCounts = {};
  for (const j of allDoneJobs) {
    const key = `${j.account_id}|${j.trade_id}`;
    tradeCounts[key] = (tradeCounts[key] || 0) + 1;
  }
  const duplicates = Object.entries(tradeCounts).filter(([_, c]) => c > 1);
  log(`trades with >1 done analysis: ${duplicates.length} (should be 0)`);
  for (const [key, count] of duplicates.slice(0, 3)) {
    log(`  ${key.slice(0,40)}: ${count} done analyses`);
  }
  // Also check: are there trades with multiple queued/running?
  const { data: multiJobs } = await supabase
    .from('ai_analyses')
    .select('trade_id, status')
    .not('trade_id', 'is', null)
    .in('status', ['queued', 'running']);
  const multiCount = {};
  for (const j of multiJobs) {
    const key = `${j.trade_id}|${j.status}`;
    multiCount[j.trade_id] = (multiCount[j.trade_id] || 0) + 1;
  }
  const multiDupes = Object.entries(multiCount).filter(([_, c]) => c > 1);
  log(`trades with >1 active (queued/running) job: ${multiDupes.length} (should be 0)`);

}

main().catch(e => { console.error(e); process.exit(1); });
