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
  // Check for duplicate evidence on the same trade_id
  const { data: evidence } = await supabase
    .from('behavior_evidence')
    .select('behavior_id, trade_id, account_id, created_at')
    .eq('account_id', '0c5a7c00-0d30-4ae0-a02a-b7e5730e05d1');
  
  const seen = new Map();
  const duplicates = [];
  for (const e of evidence || []) {
    const key = `${e.behavior_id}|${e.trade_id}`;
    if (seen.has(key)) {
      duplicates.push({ key, behavior_id: e.behavior_id, trade_id: e.trade_id, created_at: e.created_at, prev_created_at: seen.get(key) });
    } else {
      seen.set(key, e.created_at);
    }
  }
  log(`\n=== DUPLICATE EVIDENCE CHECK (main account) ===`);
  log(`total evidence: ${evidence.length}`);
  log(`duplicate (behavior_id, trade_id) pairs: ${duplicates.length}`);
  for (const d of duplicates.slice(0, 5)) {
    log(`  ${d.key} - created: ${d.created_at} (prev: ${d.prev_created_at})`);
  }

  // Check which duplicate-analysis trades created duplicate evidence
  const dupTrades = ['ef14aa8d-e879-4669-a20b-4f6818cb3107', '4f7097c7-ad9c-4e66-8bd98135fe3537', 'e53aa865-a4cf-448b-9fbe-fc64876451d6'];
  for (const tid of dupTrades) {
    const { count } = await supabase
      .from('behavior_evidence')
      .select('id', { count: 'exact', head: true })
      .eq('trade_id', tid);
    log(`trade ${tid.slice(0,8)}: ${count} evidence records`);
  }

  // Check if the same behavior_id has evidence from multiple done analyses
  const { data: allDoneJobs } = await supabase
    .from('ai_analyses')
    .select('id, trade_id, account_id')
    .eq('account_id', '0c5a7c00-0d30-4ae0-a02a-b7e5730e05d1')
    .eq('status', 'done')
    .not('trade_id', 'is', null);
  
  // Group by trade_id
  const byTrade = {};
  for (const j of allDoneJobs) {
    const key = j.trade_id;
    if (!byTrade[key]) byTrade[key] = [];
    byTrade[key].push(j.id);
  }
  const multiDone = Object.entries(byTrade).filter(([_, v]) => v.length > 1);
  log(`\n=== DUPLICATE DONE JOBS (main account) ===`);
  log(`trades with multiple done analyses: ${multiDone.length}`);
  for (const [tradeId, jobIds] of multiDone) {
    log(`  trade ${tradeId.slice(0,8)}: ${jobIds.length} done jobs [${jobIds.map(j => j.slice(0,8)).join(', ')}]`);
  }

  // Check the evidence source for the main account - are behaviors inflated?
  const { data: behaviors } = await supabase
    .from('behaviors')
    .select('id, name, behavior_type, occurrence_count, estimated_impact_pnl, estimated_impact_r, created_at, updated_at')
    .eq('account_id', '0c5a7c00-0d30-4ae0-a02a-b7e5730e05d1')
    .order('created_at', { ascending: true });
  log(`\n=== BEHAVIOR DETAIL (main account, with timestamps) ===`);
  for (const b of behaviors) {
    log(`  ${b.name} [${b.behavior_type}] occ=${b.occurrence_count} impact_pnl=${b.estimated_impact_pnl} r=${b.estimated_impact_r} created=${b.created_at}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
