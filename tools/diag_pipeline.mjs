#!/usr/bin/env node
/**
 * Pipeline diagnostic — read-only inspection of the LIVE database to trace
 * the Trading Behavior Engine data flow:
 *   accounts → trades → reflections → behaviors → evidence → ai_analyses
 * Runs with the service-role client (exactly like the backend). Never prints
 * credentials. Writes a summary to stdout.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'aura-backend', 'package.json'));
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', 'aura-backend', '.env') });

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const out = [];
const log = (m) => out.push(m);

const { data: accounts, error: ae } = await supabase.from('accounts').select('id, name, user_id, platform, phase, status');
log('ACCOUNTS: ' + (ae ? 'ERROR ' + ae.message : JSON.stringify(accounts)));

for (const acc of accounts || []) {
  const { count: tradeCount, error: te } = await supabase.from('trades').select('id', { count: 'exact', head: true }).eq('account_id', acc.id);
  const { data: trades, error: tg } = await supabase
    .from('trades')
    .select('pnl, time_open, daily_reflection, weekly_retrospective, buy_sell, instrument')
    .eq('account_id', acc.id)
    .limit(2000);
  let wins = 0, losses = 0, scratch = 0, refl = 0, weekRefl = 0;
  let minOpen = null, maxOpen = null;
  for (const t of trades || []) {
    const p = Number(t.pnl);
    if (p > 0) wins += 1; else if (p < 0) losses += 1; else scratch += 1;
    if (t.daily_reflection && String(t.daily_reflection).trim()) refl += 1;
    if (t.weekly_retrospective && String(t.weekly_retrospective).trim()) weekRefl += 1;
    if (t.time_open) {
      const d = new Date(t.time_open);
      if (!minOpen || d < minOpen) minOpen = d;
      if (!maxOpen || d > maxOpen) maxOpen = d;
    }
  }
  log('--- ACCOUNT ' + acc.name + ' (' + acc.id + ')');
  log('  trades total(exact)=' + tradeCount + ' fetched=' + (trades || []).length + ' wins=' + wins + ' losses=' + losses + ' scratch=' + scratch);
  log('  date range: ' + (minOpen ? minOpen.toISOString() : 'n/a') + ' -> ' + (maxOpen ? maxOpen.toISOString() : 'n/a'));
  log('  daily_reflection count=' + refl + ' weekly_retrospective count=' + weekRefl);

  const { count: bhCount, error: bhE } = await supabase.from('behaviors').select('id', { count: 'exact', head: true }).eq('account_id', acc.id);
  const { data: behaviors, error: bh } = await supabase
    .from('behaviors')
    .select('name, name_key, behavior_type, status, occurrence_count, confidence, estimated_impact_pnl, last_detected_at')
    .eq('account_id', acc.id)
    .order('occurrence_count', { ascending: false })
    .limit(50);
  log('  behaviors count=' + bhCount + (bhE ? ' ERR ' + bhE.message : ''));
  log('  behaviors: ' + JSON.stringify(behaviors));

  const { count: evCount, error: evE } = await supabase.from('behavior_evidence').select('id', { count: 'exact', head: true }).eq('account_id', acc.id);
  log('  evidence count=' + evCount + (evE ? ' ERR ' + evE.message : ''));

  const { count: anCount, error: anE } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('account_id', acc.id);
  const { data: anStatus } = await supabase.from('ai_analyses').select('status, last_error, trigger, created_at, finished_at').eq('account_id', acc.id).limit(500);
  log('  ai_analyses count=' + anCount + (anE ? ' ERR ' + anE.message : ''));
  if (anStatus && anStatus.length) {
    const counts = anStatus.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});
    log('  analysis status breakdown: ' + JSON.stringify(counts));
    const errs = [...new Set(anStatus.filter((r) => r.last_error).map((r) => String(r.last_error).slice(0, 200)))];
    log('  last_error samples (unique): ' + JSON.stringify(errs.slice(0, 8)));
  } else {
    log('  no analysis rows');
  }

  const { count: ruleCount } = await supabase.from('trading_rules').select('id', { count: 'exact', head: true }).eq('account_id', acc.id);
  const { count: alertCount } = await supabase.from('behavior_alerts').select('id', { count: 'exact', head: true }).eq('account_id', acc.id);
  const { count: briefCount } = await supabase.from('trading_briefs').select('id', { count: 'exact', head: true }).eq('account_id', acc.id);
  log('  rules=' + ruleCount + ' alerts=' + alertCount + ' briefs=' + briefCount);
}

const { data: settings, error: se } = await supabase.from('user_settings').select('user_id, default_account_id');
log('USER_SETTINGS: ' + (se ? 'ERR ' + se.message : JSON.stringify(settings)));

fs.writeFileSync(path.join(__dirname, 'diag_full.txt'), out.join('\n'), 'utf8');
console.log(out.join('\n'));