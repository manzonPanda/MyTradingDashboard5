#!/usr/bin/env node
/* Print the full computeWeekView() output for the main dashboard account. */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'aura-backend', 'package.json'));
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', 'aura-backend', '.env') });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { computeWeekView, computePatterns } = await import(
  pathToFileURL(path.join(__dirname, '..', 'aura-backend', 'src', 'behavior', 'dashboard-stats.js')).href
);

const ACCT = process.argv[2] || '0c5a7c00-0d30-4ae0-a02a-b7e5730e05d1';
const { data: trades } = await supabase
  .from('trades')
  .select('id,ticket,pnl,risk_per_trade,time_open,time_close,lots,daily_reflection,created_at,held')
  .eq('account_id', ACCT)
  .order('time_open');
console.log('account=' + ACCT + ' trades=' + (trades || []).length);
console.log('WEEK: ' + JSON.stringify(computeWeekView(trades || []), null, 1));
console.log('PATTERNS: ' + JSON.stringify(computePatterns(trades || []).map((p) => ({ id: p.id, occurrences: p.occurrences, ev: (p.evidence || []).length })), null, 1));