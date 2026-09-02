#!/usr/bin/env node
/**
 * Account isolation + account-switch verification over the LIVE backend.
 * Creates a throwaway sandbox user with TWO accounts that have DIFFERENT data,
 * then proves:
 *   1. GET /dashboard returns ONLY that account's numbers (no cross-bleed).
 *   2. Switching the accountId changes the returned dashboard data.
 *   3. Accessing another user's account is rejected.
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

import http from 'node:http';
const LOG = [];
const log = (m) => { LOG.push(m); console.log(m); };
let userId = null;

function api(pathname, token, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: 'localhost', port: 5000, path: pathname, method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* noop */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const email = `isolation-${Date.now()}@example.com`;
  const password = 'IsolationPass-12345!';

  const { data: created, error: ce } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (ce) throw new Error('createUser: ' + ce.message);
  userId = created.user.id;
  log('1. sandbox user created');

  const { data: session } = await supabase.auth.signInWithPassword({ email, password });
  const token = session.session.access_token;
  log('2. JWT obtained');

  // 3. Two accounts with DIFFERENT trade profiles
  const mkAccount = async (name) => {
    const { data: acc, error } = await supabase.from('accounts').insert({
      user_id: userId, name, platform: 'MT5', phase: 'phase1', status: 'active',
    }).select().single();
    if (error) throw new Error('account: ' + error.message);
    return acc;
  };
  const acctA = await mkAccount('Isolation-A (2 losing trades)');
  const acctB = await mkAccount('Isolation-B (3 winning trades)');
  log('3. accounts created A=' + acctA.id + ' B=' + acctB.id);

  const insertTrade = async (accountId, i, win) => {
    const base = new Date(Date.now() - (10 - i) * 3600 * 1000);
    const { data, error } = await supabase.from('trades').insert({
      account_id: accountId,
      ticket: null,
      instrument: 'EURUSD', buy_sell: win ? 'Buy' : 'Sell',
      lots: 0.10, pnl: win ? 250 + i * 10 : -(120 + i * 10),
      risk_per_trade: 200, mfe: win ? 30 : 5, mae: win ? 5 : 25,
      held: null, pips: win ? 25 + i : -(12 + i),
      time_open: base.toISOString(), time_close: new Date(base.getTime() + 3600 * 1000).toISOString(),
      daily_reflection: win
        ? 'Followed the plan, waited for confirmation and honored my stop. Solid execution.'
        : 'Entered early before the signal completed. Got stopped out because I jumped the gun.',
      created_at: base.toISOString(),
    }).select().single();
    if (error) throw new Error('trade insert: ' + error.message);
    return data;
  };
  for (let i = 0; i < 2; i += 1) await insertTrade(acctA.id, i, false);
  for (let i = 2; i < 5; i += 1) await insertTrade(acctB.id, i, true);
  log('4. trades inserted A=2 losing, B=3 winning');

  // 5. Dashboard per account — must be isolated + different
  const dA = await api(`/api/behavior-engine/dashboard?accountId=${acctA.id}`, token);
  const dB = await api(`/api/behavior-engine/dashboard?accountId=${acctB.id}`, token);
  log(`5. dashboard A -> ${dA.status} trades=${dA.json?.data_summary?.trade_count} wins=${dA.json?.data_summary?.winning_trades}`);
  log(`   dashboard B -> ${dB.status} trades=${dB.json?.data_summary?.trade_count} wins=${dB.json?.data_summary?.winning_trades}`);
  const isoOk = dA.status === 200 && dB.status === 200
    && dA.json?.data_summary?.trade_count === 2
    && dB.json?.data_summary?.trade_count === 3
    && dA.json?.data_summary?.winning_trades === 0
    && dB.json?.data_summary?.winning_trades === 3;
  log(`   ACCOUNT ISOLATION: ${isoOk ? 'PASS OK (A!=B, no cross-bleed)' : 'FAIL'}`);
  log(`   SWITCH CHANGES DATA: ${dA.json?.data_summary?.trade_count !== dB.json?.data_summary?.trade_count ? 'PASS OK' : 'FAIL'}`);

  // 6. Cross-user access must be rejected (real user's account id)
  const realAcctId = '0c5a7c00-0d30-4ae0-a02a-b7e5730e05d1';
  const cross = await api(`/api/behavior-engine/dashboard?accountId=${realAcctId}`, token);
  log(`6. cross-user dashboard request -> ${cross.status} (expect 403)`);

  // 7. Behavior endpoints scoped (empty for fresh accounts, never leak)
  const bA = await api(`/api/behavior-engine/behaviors?accountId=${acctA.id}`, token);
  const bB = await api(`/api/behavior-engine/behaviors?accountId=${acctB.id}`, token);
  log(`7. behaviors A -> ${bA.status} count=${Array.isArray(bA.json) ? bA.json.length : '?'}; B -> ${bB.status} count=${Array.isArray(bB.json) ? bB.json.length : '?'}`);
}

main().catch((e) => log('ERROR: ' + e.message))
  .finally(async () => {
    if (userId) await supabase.auth.admin.deleteUser(userId).catch(() => {});
    fs.writeFileSync(path.join(__dirname, 'account_isolation_diag.txt'), LOG.join('\n'), 'utf8');
    console.log('\n--- written tools/account_isolation_diag.txt ---');
  });