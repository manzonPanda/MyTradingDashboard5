import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'aura-backend', 'package.json'));
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', 'aura-backend', '.env') });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const ACCT = '0c5a7c00-0d30-4ae0-a02a-b7e5730e05d1';

// 1. Trades
const { data: trades } = await supabase.from('trades').select('id, time_open, time_close, pnl, risk_per_trade, daily_reflection').eq('account_id', ACCT).order('time_open', { ascending: true });
const closed = trades.filter(t => t.time_close);
const wins = closed.filter(t => Number(t.pnl) > 0);
const losses = closed.filter(t => Number(t.pnl) < 0);
const reflections = trades.filter(t => (t.daily_reflection || '').trim().length > 0);

console.log('=== MAIN ACCOUNT TRADES (direct DB) ===');
console.log(`total trades: ${trades.length}`);
console.log(`closed trades: ${closed.length}`);
console.log(`winning: ${wins.length}  losing: ${losses.length}`);
console.log(`with reflections: ${reflections.length}`);

// 2. Behaviors
const { data: behaviors } = await supabase.from('behaviors').select('*').eq('account_id', ACCT);
console.log(`\n=== BEHAVIORS (${behaviors.length}) ===`);
for (const b of behaviors) {
  console.log(`  ${b.name} [${b.behavior_type}/${b.status}] occ=${b.occurrence_count} conf=${b.confidence} impact_pnl=${b.estimated_impact_pnl} impact_r=${b.estimated_impact_r}`);
}

// 3. Evidence
const { count: evCount } = await supabase.from('behavior_evidence').select('id', { count: 'exact', head: true }).eq('account_id', ACCT);
console.log(`\n=== EVIDENCE: ${evCount} records ===`);

// 4. Analyses
const { data: analyses } = await supabase.from('ai_analyses').select('id, status, trigger, trade_id').eq('account_id', ACCT);
const doneAnalyses = analyses.filter(a => a.status === 'done');
console.log(`\n=== ANALYSES: ${analyses.length} total, ${doneAnalyses.length} done ===`);
const doneTradeIds = new Set(doneAnalyses.map(a => a.trade_id).filter(Boolean));
console.log(`distinct trades with done analysis: ${doneTradeIds.size}`);

// 5. Cross-check: which trades DON'T have analysis?
const allTradeIds = new Set(trades.map(t => t.id));
const withoutAnalysis = [...allTradeIds].filter(id => !doneTradeIds.has(id));
const withReflectionsNoAnalysis = trades.filter(t => (t.daily_reflection || '').trim() && !doneTradeIds.has(t.id));
console.log(`\ntrades without any done analysis: ${withoutAnalysis.length}`);
console.log(`trades with reflection but no done analysis: ${withReflectionsNoAnalysis.length}`);
for (const t of withReflectionsNoAnalysis.slice(0, 5)) {
  console.log(`  trade ${t.id.slice(0,8)} ${t.instrument || ''} pnl=${t.pnl} has_reflection=${!!(t.daily_reflection||'').trim()}`);
}

// 6. Verify behavior score manually
let positiveR = 0, negativeR = 0, occurrences = 0;
for (const b of behaviors) {
  if (b.status === 'ARCHIVED' || b.status === 'RESOLVED') continue;
  const occ = Number(b.occurrence_count) || 0;
  occurrences += occ;
  const r = Number(b.estimated_impact_r) || 0;
  if (b.behavior_type === 'positive') positiveR += Math.min(Math.abs(r), 12);
  else negativeR += Math.min(Math.abs(r), 12);
}
const rawScore = 50 + (positiveR - negativeR) * 3.2;
const finalScore = Math.max(0, Math.min(100, Math.round(rawScore)));
console.log(`\n=== MANUAL SCORE CALC ===`);
console.log(`occurrences=${occurrences} positiveR=${positiveR} negativeR=${negativeR}`);
console.log(`rawScore=${rawScore} finalScore=${finalScore}`);
console.log(`enough data (>=2 occurrences): ${occurrences >= 2}`);
