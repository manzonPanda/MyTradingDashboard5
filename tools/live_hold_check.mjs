#!/usr/bin/env node
/* LIVE endpoint check of the hold-time fix: creates a sandbox user/account with
   one closed trade of known duration (600s) and reads the dashboard's
   week.current.avg_hold_seconds. Proves the running backend uses the fix. */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'aura-backend', 'package.json'));
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', 'aura-backend', '.env') });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

import http from 'node:http';
const LOG = [];
const log = (m) => { LOG.push(m); console.log(m); };
let userId = null;

function api(pathname, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: 5000, path: pathname, method: 'GET', headers: { Authorization: `Bearer ${token}` } }, (res) => {
      let text = ''; res.on('data', (c) => (text += c)); res.on('end', () => { try { resolve(JSON.parse(text)); } catch { resolve(null); } });
    });
    req.on('error', reject); req.end();
  });
}

async function main() {
  const email = `holdfix-${Date.now()}@example.com`;
  const password = 'HoldFixPass-12345!';
  const { data: u, error: ce } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (ce) throw new Error(ce.message);
  userId = u.user.id;
  const { data: s } = await supabase.auth.signInWithPassword({ email, password });
  const token = s.session.access_token;

  const { data: acc } = await supabase.from('accounts').insert({ user_id: userId, name: 'HoldFix Check', platform: 'MT5', phase: 'phase1', status: 'active' }).select().single();
  const open = new Date('2026-09-01T10:00:00Z');
  const close = new Date('2026-09-01T10:10:00Z'); // 600s hold
  await supabase.from('trades').insert({
    account_id: acc.id, ticket: null, instrument: 'EURUSD', buy_sell: 'Buy',
    lots: 0.1, pnl: 50, risk_per_trade: 100, time_open: open.toISOString(),
    time_close: close.toISOString(), daily_reflection: 'Test trade for hold verification.',
  });

  const dash = await api(`/api/behavior-engine/dashboard?accountId=${acc.id}`, token);
  const hold = dash?.week?.current?.avg_hold_seconds;
  log('live dashboard week.current.avg_hold_seconds = ' + hold + ' (expect 600 for a 10-minute hold)');
  log(hold === 600 ? 'LIVE HOLD FIX VERIFIED ✓ (server running corrected code)' : (hold === 600000 ? 'LIVE SERVER STILL OLD (needs restart) ✗' : 'unexpected value'));
}

main().catch((e) => log('ERROR: ' + e.message))
  .finally(async () => {
    if (userId) await supabase.auth.admin.deleteUser(userId).catch(() => {});
    fs.writeFileSync(path.join(__dirname, 'live_hold_check.txt'), LOG.join('\n'), 'utf8');
  });