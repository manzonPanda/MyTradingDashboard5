#!/usr/bin/env node
/* Trace all ai_analyses rows for a given trade_id (or account) — proves the
   retry/requeue lifecycle of a specific job over time. */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'aura-backend', 'package.json'));
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', 'aura-backend', '.env') });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const tradeId = process.argv[2] || null;
let q = supabase.from('ai_analyses').select('id,trade_id,account_id,status,trigger,attempts,max_attempts,last_error,created_at,updated_at,finished_at').order('created_at');
if (tradeId) q = q.eq('trade_id', tradeId);
const { data, error } = await q;
if (error) throw new Error(error.message);
for (const j of data || []) {
  console.log(`[${j.status}] attempts=${j.attempts}/${j.max_attempts} trigger=${j.trigger} created=${j.created_at} updated=${j.updated_at} finished=${j.finished_at || ''} err=${(j.last_error || '').slice(0, 90)}`);
}
console.log(`(${(data || []).length} rows)`);