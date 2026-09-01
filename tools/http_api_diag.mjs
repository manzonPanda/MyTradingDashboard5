#!/usr/bin/env node
/**
 * HTTP API verification — simulates the frontend behavior-engine calls against
 * the LIVE local backend using a throwaway sandbox user.
 *
 * Creates: user → account → 3 trades w/ reflections → webhook → behaviors
 * Reads:   behaviors, evidence, analyze-status (the exact frontend calls)
 * Cleans up everything afterwards (user delete cascades all owned rows).
 * Never prints credentials.
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

const API = process.env.API_BASE || 'http://localhost:5000';
const email = `sandbox-${Date.now()}@example.com`;
const password = 'SandboxPass-12345!';

const out = [];
const log = (m) => out.push(m);
let userId = null;

import http from 'node:http';

async function api(pathname, token, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: 'localhost',
        port: 5000,
        path: pathname,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(text); } catch { /* keep null */ }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

try {
  // 1. Create + confirm sandbox user
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr) throw new Error('createUser: ' + createErr.message);
  userId = created.user.id;
  log('1. sandbox user created');

  // 2. Sign in for a JWT (exactly what the frontend sends)
  const { data: session, error: signinErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signinErr) throw new Error('signIn: ' + signinErr.message);
  const token = session.session.access_token;
  log('2. JWT obtained');

  // 3. Create an account
  const { data: account, error: accErr } = await supabase
    .from('accounts')
    .insert({ user_id: userId, name: 'Sandbox Account', platform: 'MT5', phase: 'phase1', status: 'active' })
    .select()
    .single();
  if (accErr) throw new Error('account insert: ' + accErr.message);
  const accountId = account.id;
  log('3. sandbox account created');

  // 4. Insert 3 trades with reflections
  const nowMs = Date.now();
  const trades = [];
  for (let i = 0; i < 3; i += 1) {
    const { data: trade, error: tErr } = await supabase
      .from('trades')
      .insert({
        account_id: accountId,
        ticket: 9000000 + Math.floor(Math.random() * 10000000) + i,
        instrument: 'XAUUSD',
        lots: 0.1,
        pnl: i === 1 ? -42 : 18,
        risk_per_trade: 100,
        time_open: new Date(nowMs - (100 - i) * 60000).toISOString(),
        time_close: new Date(nowMs - (99 - i) * 60000).toISOString(),
        daily_reflection: i === 1
          ? 'I re-entered immediately after a loss out of frustration and broke my rules. I should have waited for the next setup.'
          : 'Followed my plan and waited for the EMA confirm before entering. Trade behaved as expected.',
      })
      .select()
      .single();
    if (tErr) throw new Error('trade insert: ' + tErr.message);
    trades.push(trade);
  }
  log('4. 3 trades inserted with reflections');

  // 5. Fire the trade-saved webhook for the losing trade (frontend path)
  const webhook = await api(`/api/behavior-engine/webhook/trade-saved`, token, {
    method: 'POST',
    body: { accountId, tradeId: trades[1].id },
  });
  log(`5. webhook/trade-saved -> ${webhook.status} ${JSON.stringify(webhook.json)}`);

  // 6. Behaviors (frontend loadAll /behaviors call)
  const behaviors = await api(`/api/behavior-engine/behaviors?accountId=${accountId}`, token);
  log(`6. behaviors -> ${behaviors.status} ${JSON.stringify((behaviors.json || []).map((b) => ({ name: b.name, count: b.occurrence_count, status: b.status, impact: b.estimated_impact_pnl })))}`);

  // 7. Evidence (frontend getEvidence call)
  const evidence = await api(`/api/behavior-engine/evidence?accountId=${accountId}`, token);
  log(`7. evidence -> ${evidence.status} count=${Array.isArray(evidence.json) ? evidence.json.length : '?'}`);

  // 8. Alerts / rules / brief (frontend loadAll remaining calls)
  const alerts = await api(`/api/behavior-engine/alerts?accountId=${accountId}`, token);
  const rules = await api(`/api/behavior-engine/rules?accountId=${accountId}`, token);
  const brief = await api(`/api/behavior-engine/brief?accountId=${accountId}`, token);
  log(`8. alerts=${alerts.status} rules=${rules.status} brief=${brief.status} (${JSON.stringify(brief.json)})`);

  // 9. NEW dashboard aggregate endpoint (the single frontend payload)
  const dashAfterBackfill = await api(`/api/behavior-engine/dashboard?accountId=${accountId}`, token);
  log(`9. dashboard-after-webhook -> ${dashAfterBackfill.status} trades=${dashAfterBackfill.json?.data_summary?.trade_count}`);

  // 10. Backfill should enqueue the two remaining trades (never analyzed)
  const backfill = await api(`/api/behavior-engine/backfill?accountId=${accountId}&limit=10`, token, { method: 'POST' });
  log(`10. backfill -> ${backfill.status} ${JSON.stringify(backfill.json)}`);

  // 11. Give the worker time to process the queued jobs, then re-check.
  await new Promise((r) => setTimeout(r, 20_000));
  const dash = await api(`/api/behavior-engine/dashboard?accountId=${accountId}`, token);
  if (dash.status === 200 && dash.json) {
    const d = dash.json;
    log(`11. dashboard -> ${dash.status} trades=${d.data_summary.trade_count} reflection=${d.data_summary.reflection_count} behaviors=${d.data_summary.behavior_count} evidence=${d.data_summary.evidence_count}`);
    log(`   engine_status=${d.engine_status} score=${d.score.available ? d.score.score : 'N/A (reason: ' + d.score.reason + ')'}`);
    log(`   week.trades=${d.week.current.trade_count}/${d.week.previous.trade_count} patterns=[${(d.patterns || []).map((p) => p.id).join(',')}]`);
    log(`   behaviors=[${(d.behaviors || []).map((b) => b.name + ':' + b.occurrence_count + (b.evidence_count ? '@' + b.evidence_count : '')).join(', ')}]`);
  } else {
    log(`11. dashboard -> ${dash.status} ${JSON.stringify(dash.json)}`);
  }
} catch (err) {
  log('ERROR: ' + err.message);
} finally {
  if (userId) {
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    log('cleanup: sandbox user deleted (cascades account/trades)');
  }
  fs.writeFileSync(path.join(__dirname, 'http_api_diag.txt'), out.join('\n'), 'utf8');
  console.log(out.join('\n'));
}