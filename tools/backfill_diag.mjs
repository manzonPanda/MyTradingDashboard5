#!/usr/bin/env node
/**
 * Backfill pipeline diagnostic — watches the REAL job lifecycle in the DB.
 *
 * 1. sandbox user + account + 3 trades w/ reflections
 * 2. POST /api/behavior-engine/backfill
 * 3. Poll ai_analyses/behaviors/evidence directly (service role) for 90s
 * 4. Print status transitions + last_error so failures are visible
 * 5. Cleanup (user delete cascades everything)
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

const email = `bfill-${Date.now()}@example.com`;
const password = 'SandboxPass-12345!';
const out = [];
const log = (m) => { out.push(m); console.log(m); };
let userId = null;

async function snapshot(accountId, label) {
  const { data: jobs } = await supabase
    .from('ai_analyses')
    .select('status, attempts, trigger, last_error, created_at, finished_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(10);
  const { data: behaviors } = await supabase
    .from('behaviors')
    .select('name, behavior_type, status, occurrence_count, confidence, estimated_impact_pnl')
    .eq('account_id', accountId);
  const { count: evCount } = await supabase
    .from('behavior_evidence')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId);
  const counts = (jobs || []).reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});
  const errs = [...new Set((jobs || []).filter((j) => j.last_error).map((j) => `${j.status}: ${String(j.last_error).slice(0, 140)}`))];
  log(`[${label}] jobs=${JSON.stringify(counts)} behaviors=${JSON.stringify(behaviors || [])} evidence=${evCount}${errs.length ? ' ERRORS=' + JSON.stringify(errs) : ''}`);
  return { jobs, behaviors, evCount };
}

try {
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (createErr) throw new Error('createUser: ' + createErr.message);
  userId = created.user.id;
  log('1. sandbox user created');

  const { data: account, error: accErr } = await supabase
    .from('accounts')
    .insert({ user_id: userId, name: 'Backfill Sandbox', platform: 'MT5', phase: 'phase1', status: 'active' })
    .select()
    .single();
  if (accErr) throw new Error('account insert: ' + accErr.message);
  const accountId = account.id;
  log('2. account created');

  const nowMs = Date.now();
  for (let i = 0; i < 3; i += 1) {
    const { error: tErr } = await supabase.from('trades').insert({
      account_id: accountId,
      ticket: 9100000 + Math.floor(Math.random() * 10000000) + i,
      instrument: 'XAUUSD',
      lots: 0.1,
      pnl: i === 1 ? -42 : 18,
      risk_per_trade: 100,
      time_open: new Date(nowMs - (100 - i) * 60000).toISOString(),
      time_close: new Date(nowMs - (99 - i) * 60000).toISOString(),
      daily_reflection: i === 1
        ? 'I re-entered immediately after a loss out of frustration and broke my rules. I should have waited for the next setup.'
        : 'Followed my plan and waited for the EMA confirm before entering. Trade behaved as expected.',
    });
    if (tErr) throw new Error('trade insert: ' + tErr.message);
  }
  log('3. 3 trades w/ reflections inserted');

  // Fire the backfill via the API (needs a JWT).
  const { data: session, error: signinErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signinErr) throw new Error('signIn: ' + signinErr.message);
  const token = session.session.access_token;

  const bfRes = await fetch('http://localhost:5000/api/behavior-engine/backfill?accountId=' + accountId + '&limit=10', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const bf = await bfRes.json().catch(() => null);
  log(`4. backfill -> ${bfRes.status} ${JSON.stringify(bf)}`);

  for (let i = 1; i <= 9; i += 1) {
    await new Promise((r) => setTimeout(r, 10_000));
    await snapshot(accountId, `t+${i * 10}s`);
  }
} catch (err) {
  log('ERROR: ' + err.message);
} finally {
  if (userId) {
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    log('cleanup: sandbox user deleted');
  }
  fs.writeFileSync(path.join(__dirname, 'backfill_diag.txt'), out.join('\n'), 'utf8');
}
