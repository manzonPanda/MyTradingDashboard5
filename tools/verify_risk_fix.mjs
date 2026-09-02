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
  const ACCT = '0c5a7c00-0d30-4ae0-a02a-b7e5730e05d1';
  const { data: trades } = await supabase
    .from('trades')
    .select('time_open, time_close, pnl, risk_per_trade, lots, instrument')
    .eq('account_id', ACCT)
    .order('time_open', { ascending: true });

  // Import the FIXED computePatterns
  const { computePatterns, aggregateTrades } = await import('../aura-backend/src/behavior/dashboard-stats.js');
  
  const patterns = computePatterns(trades);
  log('=== COMPUTED PATTERNS (main account, fixed) ===');
  for (const p of patterns) {
    log(`[${p.id}] ${p.title} (${p.occurrences}x)`);
    log(`  desc: ${p.description}`);
    if (p.detail) log(`  detail: ${JSON.stringify(p.detail)}`);
  }

  // Verify risk_after_win has proper typical_risk
  const rwin = patterns.find(p => p.id === 'risk_after_win');
  if (rwin) {
    log(`\n=== RISK_AFTER_WIN VERIFICATION ===`);
    log(`avg_risk=${rwin.detail.avg_risk} typical_risk=${rwin.detail.typical_risk}`);
    log(`description contains "vs a typical": ${rwin.description.includes('vs a typical')}`);
    log(`description does NOT repeat same number: ${rwin.description.includes(`vs a typical ${rwin.detail.avg_risk}R`)} (should be false)`);
    if (rwin.detail.avg_risk !== rwin.detail.typical_risk) {
      log('PASS: typical_risk differs from avg_risk — comparison is now meaningful');
    } else {
      log('NOTE: avg_risk === typical_risk (all winning trades are quick re-entries)');
    }
  }

  // Verify week view
  const week = aggregateTrades(trades);
  log(`\n=== AGGREGATE TRADES (all 24 trades) ===`);
  log(`trade_count=${week.trade_count} win_rate=${week.win_rate}`);
  log(`avg_pnl=${week.avg_pnl} avg_r_per_trade=${week.avg_r_per_trade}`);
  log(`max_loss_streak=${week.max_loss_streak} total_pnl=${week.total_pnl}`);
  log(`avg_hold_seconds=${week.avg_hold_seconds} avg_entry_delay_min=${week.avg_entry_delay_min}`);
  log(`risk_after_2_wins=${week.risk_after_2_wins} (n=${week.risk_after_2_wins_n})`);
  log(`risk_normal=${week.risk_normal} (n=${week.risk_normal_n})`);

}

main().catch(e => { console.error(e); process.exit(1); });
