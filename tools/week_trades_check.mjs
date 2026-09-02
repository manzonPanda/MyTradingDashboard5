#!/usr/bin/env node
/* Check the trades closed in the current ISO week for the main account —
   sanity check for avg_hold_seconds / entry delay. */
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
const { data: trades } = await supabase
  .from('trades')
  .select('id,ticket,instrument,pnl,risk_per_trade,time_open,time_close,held')
  .eq('account_id', ACCT)
  .not('time_close', 'is', null)
  .order('time_close');
const weekStart = new Date('2026-08-31T00:00:00Z');
const week = trades.filter((t) => {
  const c = new Date(t.time_close + (t.time_close.endsWith('Z') ? '' : 'Z'));
  return c >= weekStart;
});
for (const t of week) {
  const open = new Date(t.time_open + (t.time_open.endsWith('Z') ? '' : 'Z'));
  const close = new Date(t.time_close + (t.time_close.endsWith('Z') ? '' : 'Z'));
  const holdSec = (close - open) / 1000;
  console.log(`ticket=${t.ticket} inst=${t.instrument} pnl=${t.pnl} open=${t.time_open} close=${t.time_close} holdSec=${Math.round(holdSec)} heldField=${JSON.stringify(t.held)}`);
}
console.log('trades closed this week: ' + week.length);