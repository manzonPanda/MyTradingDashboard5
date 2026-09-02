#!/usr/bin/env node
/* Inspect the main dashboard account's remaining queued job + its trade. */
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
const { data, error } = await supabase
  .from('ai_analyses')
  .select('id,trade_id,status,trigger,attempts,max_attempts,created_at,updated_at,last_error')
  .eq('account_id', ACCT)
  .eq('status', 'queued');
if (error) throw new Error(error.message);
console.log('MAIN QUEUED JOBS:', JSON.stringify(data, null, 1));
if (data?.length) {
  const { data: t } = await supabase.from('trades')
    .select('id,ticket,instrument,pnl,risk_per_trade,time_open,daily_reflection')
    .eq('id', data[0].trade_id)
    .maybeSingle();
  console.log('TRADE:', JSON.stringify(t, null, 1));
}