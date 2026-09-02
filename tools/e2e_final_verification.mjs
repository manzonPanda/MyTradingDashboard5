#!/usr/bin/env node
/**
 * FINAL END-TO-END VERIFICATION (section 14 of the Trading Behavior Engine
 * redesign).
 *
 * Runs the REAL server against the LIVE Supabase and proves:
 *   ACCOUNT A (24 trades / 10 reflections) -> switch to ACCOUNT B
 *   (12 trades / 0 reflections) -> B loads trade-only DETERMINISTIC behaviors,
 *   no A bleed, new-trade webhook updates determinism immediately + decides AI
 *   separately, then switch back to A restores A state.
 *
 * Browser half (Angular signal reset, realtime unsubscribe/resubscribe,
 * stale-response guard, LLM-failure isolation) is covered by
 * karma.conf.js + behavior-engine.service.spec.ts in headless Edge.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(__dirname, '..', 'aura-backend');
const require = createRequire(path.join(BACKEND, 'package.json'));
const dotenv = require('dotenv');
dotenv.config({ path: path.join(BACKEND, '.env') });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

import http from 'node:http';
const PORT = '5099';
let passed = 0, failed = 0;
const ok = (m) => { passed++; console.log('  PASS ' + m); };
const bad = (m) => { failed++; console.log('  FAIL ' + m); };
const step = (m) => console.log('\n>> ' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function api(pathname, token, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: 'localhost', port: PORT, path: pathname, method,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
    let text = '';
    req.on('response', (res) => {
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* noop */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
  });
}

function genClosedTrade(accountId, i, { win, reflection, minutesGapFromPrev, base }) {
  const open = new Date(base.getTime() + minutesGapFromPrev * 60000);
  const close = new Date(open.getTime() + (35 + (i % 5) * 15) * 60000);
  return {
    account_id: accountId,
    ticket: TICKET_BASE + i,
    instrument: ['EURUSD', 'GBPUSD', 'XAUUSD'][i % 3],
    buy_sell: win ? 'Buy' : 'Sell',
    lots: 0.1,
    pnl: win ? 180 + (i % 4) * 60 : -(90 + (i % 4) * 45),
    risk_per_trade: 180,
    mfe: win ? 30 : 6,
    mae: win ? 5 : 22,
    pips: win ? 12 + (i % 5) : -(9 + (i % 5)),
    time_open: open.toISOString(),
    time_close: close.toISOString(),
    daily_reflection: reflection,
    created_at: open.toISOString(),
  };
}

// Global unique-index on trade ticket: each run needs its own ticket range so
// re-runs never collide even if a previous run's cleanup was interrupted.
const TICKET_BASE = 7000000 + (Date.now() % 8000000);

/** Remove any sandbox users left behind by interrupted previous runs. */
async function purgeUser(uid) {
  const { data: accs } = await supabase.from('accounts').select('id').eq('user_id', uid);
  const accIds = (accs || []).map((a) => a.id);
  for (const t of ['trading_briefs', 'behavior_alerts', 'ai_analyses']) {
    const { error } = await supabase.from(t).delete().eq('user_id', uid);
    if (error) process.stderr.write('TRACE: purge ' + t + ' error: ' + error.message + '\n');
  }
  if (accIds.length) {
    for (const t of ['behaviors', 'behavior_evidence', 'trades']) {
      const { error } = await supabase.from(t).delete().in('account_id', accIds);
      if (error) process.stderr.write('TRACE: purge ' + t + ' error: ' + error.message + '\n');
    }
    const { error } = await supabase.from('accounts').delete().in('id', accIds);
    if (error) process.stderr.write('TRACE: purge accounts error: ' + error.message + '\n');
  }
  const { error } = await supabase.auth.admin.deleteUser(uid);
  if (!error) process.stderr.write('TRACE: purged user ' + uid + '\n');
}

async function cleanupPriorRuns() {
  const { data: leftovers } = await supabase.from('accounts').select('user_id').ilike('name', 'E2E-%');
  const users = new Set((leftovers || []).map((a) => a.user_id));
  for (const uid of users) await purgeUser(uid);
  return users.size;
}

async function main() {
  const email = 'e2e-' + Date.now() + '@example.com';
  const password = 'E2eVerif-12345!';
  const { data: created, error: ce } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (ce) throw new Error('createUser: ' + ce.message);
    const userId = created.user.id;
  let server;
  try {
    await cleanupPriorRuns();
    step('Boot the real backend server');
    server = spawn('node.exe', [path.join(BACKEND, 'server.js')], {
      cwd: BACKEND, env: { ...process.env, PORT }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    server.stdout.on('data', (d) => (out += d.toString()));
    server.stderr.on('data', (d) => (out += d.toString()));
    for (let i = 0; i < 40; i += 1) {
      if (/listening|running at|PORT/i.test(out) || /Error:|error:/i.test(out)) break;
      await sleep(250);
    }
    if (!/listening|running at|PORT/i.test(out)) throw new Error('server did not boot:\n' + out.slice(-1200));
    ok('server booted on port ' + PORT);

    const { data: session } = await supabase.auth.signInWithPassword({ email, password });
    const token = session.session.access_token;
    ok('sandbox user JWT obtained');

    const mkAccount = async (name) => {
      const { data: acc, error } = await supabase.from('accounts').insert({
        user_id: userId, name, platform: 'MT5', phase: 'phase1', status: 'active',
      }).select().single();
      if (error) throw new Error('account insert: ' + error.message);
      return acc;
    };
    const acctA = await mkAccount('E2E-A (24 trades / 10 reflections)');
    const acctB = await mkAccount('E2E-B (12 trades / 0 reflections)');
    ok('seeded dual accounts A + B');
    process.stderr.write('TRACE: starting A seeding\n');

    // Account A: 24 closed trades, 10 with reflections, sparse loss streaks.
    const baseA = new Date(Date.now() - 25 * 3600000);
    let gapA = 60;
    for (let i = 0; i < 24; i += 1) {
      const win = !(i % 5 === 3 || i % 7 === 4);
      const reflection = i % 12 < 5 ? 'Followed the plan and honored my stop. Calm execution.' : null;
      const t = genClosedTrade(acctA.id, i, { win, reflection, minutesGapFromPrev: gapA, base: baseA });
      gapA = 55 + (i % 6) * 15;
      const { error } = await supabase.from('trades').insert([t]);
      if (error) throw new Error('trade insert A: ' + error.message);
      if (i % 8 === 7) process.stderr.write('TRACE: A seeding i=' + i + '\n');
    }
    process.stderr.write('TRACE: A seeding done\n');
    ok('Account A seeded: 24 closed trades, 10 reflections');

    // Account B: 12 closed trades, 0 reflections, shaped to force the
    // deterministic engine to emit loss_streaks + post_loss_reentry purely
    // from trade data.
    const specB = [
      { win: true,  gap: 0 },
      { win: true,  gap: 70 },
      { win: false, gap: 75 },   // t3 loss
      { win: false, gap: 10 },   // t4 loss 10min after t3 close -> reentry + streak
      { win: false, gap: 30 },   // t5 loss -> streak of 3
      { win: true,  gap: 80 },
      { win: false, gap: 60 },   // t7 loss
      { win: false, gap: 8 },    // t8 loss 8min after t7 close -> reentry + streak
      { win: true,  gap: 70 },
      { win: false, gap: 60 },   // t10 loss
      { win: true,  gap: 75 },
      { win: true,  gap: 50 },
    ];
    const baseB = new Date(Date.now() - 13 * 3600000);
    for (let i = 0; i < specB.length; i += 1) {
      const t = genClosedTrade(acctB.id, 100 + i, {
        win: specB[i].win, reflection: null, minutesGapFromPrev: specB[i].gap, base: baseB,
      });
      const { error } = await supabase.from('trades').insert([t]);
      if (error) throw new Error('trade insert B: ' + error.message);
    }
    ok('Account B seeded: 12 closed trades, 0 reflections (shaped for deterministic behaviors)');

    step('1. Load Account A (24 trades / 10 reflections)');
    const dA1 = await api('/api/behavior-engine/dashboard?accountId=' + acctA.id, token);
    const sumA1 = dA1.json ? dA1.json.data_summary : null;
    if (dA1.status === 200 && sumA1 && sumA1.trade_count === 24 && sumA1.reflection_count === 10) {
      ok('A loads: 24 trades / 10 reflections (HTTP ' + dA1.status + ')');
    } else bad('A load wrong: status=' + dA1.status + ' trades=' + (sumA1 && sumA1.trade_count) + ' refl=' + (sumA1 && sumA1.reflection_count));
    if (dA1.json && Array.isArray(dA1.json.behaviors) && dA1.json.behaviors.length > 0) {
      ok('A has existing behaviors (' + dA1.json.behaviors.length + ') engine_status=' + dA1.json.engine_status + ' ai_status=' + dA1.json.ai_status);
    } else bad('A behaviors empty: ' + JSON.stringify(dA1.json && dA1.json.behaviors));
    if (dA1.json && dA1.json.engine_status && dA1.json.engine_status !== 'analysis_unavailable') {
      ok('A engine_status=' + dA1.json.engine_status + ' — deterministic layer healthy');
    } else bad('A engine_status hidden');

    step('2. SWITCH -> Account B (12 trades / 0 reflections)');
    const dB1 = await api('/api/behavior-engine/dashboard?accountId=' + acctB.id, token);
    const sumB1 = dB1.json ? dB1.json.data_summary : null;
    if (dB1.status === 200 && sumB1 && sumB1.trade_count === 12 && sumB1.reflection_count === 0) {
      ok('B loads: 12 trades / 0 reflections (HTTP ' + dB1.status + ')');
    } else bad('B load wrong: status=' + dB1.status + ' trades=' + (sumB1 && sumB1.trade_count) + ' refl=' + (sumB1 && sumB1.reflection_count));
    if (dB1.json && dB1.json.account_id === acctB.id && dA1.json && dA1.json.account_id !== dB1.json.account_id) {
      ok('B payload is account-scoped to B (no Account A bleed)');
    } else bad('B payload account_id not isolated');
    const bBehaviors = dB1.json && Array.isArray(dB1.json.behaviors) ? dB1.json.behaviors : [];
    const bNames = bBehaviors.map((b) => b.name_key + ':' + b.occurrence_count).join(', ');
    if (bBehaviors.length > 0) {
      ok('B has DETERMINISTIC trade-only behaviors (' + bNames + ') — reflections NOT a prerequisite');
    } else bad('B behaviors empty — trade-only analysis failed');
    if (dB1.json && dB1.json.engine_status && dB1.json.engine_status !== 'analysis_unavailable' && dB1.json.engine_status !== 'needs_more_data') {
      ok('B engine_status=' + dB1.json.engine_status + ' (NOT analysis_unavailable)');
    } else bad('B engine_status=' + (dB1.json && dB1.json.engine_status) + ' — expected learning');
    if (dB1.json && dB1.json.ai_status) {
      ok('B ai_status=' + dB1.json.ai_status + ' — AI layer reported separately');
    } else bad('B ai_status missing');
    if (sumB1 && sumB1.evidence_count > 0) ok('B evidence_count=' + sumB1.evidence_count + ' — objective occurrence backing');
    else bad('B evidence_count=' + (sumB1 && sumB1.evidence_count) + ' — expected > 0');

    step('3. Simulate a NEW trade saved for Account B (trade-saved webhook)');
    const lastBRes = await supabase.from('trades').select('time_close').eq('account_id', acctB.id).order('time_open', { ascending: false }).limit(1);
    const lastB = lastBRes.data && lastBRes.data[0];
    const newOpen = new Date(new Date(lastB.time_close).getTime() + 3600000);
    const newTrade = {
      account_id: acctB.id, ticket: TICKET_BASE + 999, instrument: 'USDJPY', buy_sell: 'Buy',
      lots: 0.1, pnl: 210, risk_per_trade: 180, mfe: 25, mae: 4, pips: 16,
      time_open: newOpen.toISOString(),
      time_close: new Date(newOpen.getTime() + 45 * 60000).toISOString(),
      daily_reflection: null, created_at: newOpen.toISOString(),
    };
    const { data: inserted, error: insErr } = await supabase.from('trades').insert([newTrade]).select().single();
    if (insErr) throw new Error('new trade insert B: ' + insErr.message);
    ok('new trade saved to B (tradeId=' + inserted.id + ')');

    const wResp = await api('/api/behavior-engine/webhook/trade-saved', token, {
      method: 'POST', body: { accountId: acctB.id, tradeId: inserted.id },
    });
    if (wResp.status === 200 && wResp.json && wResp.json.deterministic) {
      const det = wResp.json.deterministic;
      ok('webhook returned IMMEDIATE deterministic analysis (tradeCount=' + det.tradeCount + '), not a queued batch');
      if (det.tradeCount === 13) ok('deterministic pass saw the 13th trade');
      else bad('deterministic tradeCount=' + det.tradeCount + ', expected 13');
    } else bad('webhook status=' + wResp.status + ' JSON=' + JSON.stringify(wResp.json).slice(0, 300));
    const aiDecision = wResp.json && wResp.json.ai;
    if (aiDecision && (aiDecision.status === 'queued' || aiDecision.status === 'skipped' || aiDecision.status === 'not_requested')) {
      ok('AI pass decided separately: ' + JSON.stringify(aiDecision).slice(0, 140) + ' — never blocks deterministic result');
    } else bad('AI pass missing: ' + JSON.stringify(aiDecision));

    step('4. Re-fetch dashboard for B after the trade event');
    await sleep(400);
    const dB2 = await api('/api/behavior-engine/dashboard?accountId=' + acctB.id, token);
    const sumB2 = dB2.json ? dB2.json.data_summary : null;
    if (dB2.status === 200 && sumB2 && sumB2.trade_count === 13) {
      ok('B dashboard updated to 13 trades after the event (no full backfill required)');
    } else bad('B dashboard trade_count=' + (sumB2 && sumB2.trade_count) + ', expected 13');
    if (dB2.json && Array.isArray(dB2.json.behaviors) && dB2.json.behaviors.length >= (bBehaviors.length || 1)) {
      ok('B deterministic behaviors persist after the event (' + dB2.json.behaviors.length + ')');
    } else bad('B behaviors regressed after event');

    step('5. SWITCH back -> Account A');
    const dA2 = await api('/api/behavior-engine/dashboard?accountId=' + acctA.id, token);
    const sumA2 = dA2.json ? dA2.json.data_summary : null;
    if (dA2.status === 200 && sumA2 && sumA2.trade_count === 24 && sumA2.reflection_count === 10) {
      ok('A returns correctly: 24 trades / 10 reflections (HTTP ' + dA2.status + ')');
    } else bad('A return wrong: status=' + dA2.status + ' trades=' + (sumA2 && sumA2.trade_count) + ' refl=' + (sumA2 && sumA2.reflection_count));
    if (dA2.json && dA2.json.account_id === acctA.id && dB2.json && dA2.json.account_id !== dB2.json.account_id) {
      ok('A payload isolated from B after switching back');
    } else bad('A payload not isolated after switch-back');

    console.log('\n============================================================');
    console.log('E2E RESULT: ' + (failed === 0 ? ('ALL ' + passed + ' CHECKS PASSED') : (failed + ' FAILED / ' + passed + ' passed')));
    console.log('============================================================');
    if (failed > 0 && out) {
      console.log('--- SERVER LOG (tail 3000) ---');
      console.log(out.slice(-3000));
      console.log('--------------------------------');
    }
  } finally {
    if (server) { try { server.kill('SIGTERM'); } catch {} await sleep(300); try { server.kill('SIGKILL'); } catch {} }
    if (userId) await purgeUser(userId);
    fs.writeFileSync(path.join(__dirname, 'e2e_final_verification.txt'),
      'E2E: ' + (failed === 0 ? 'PASS' : 'FAIL') + ' (' + passed + ' passed, ' + failed + ' failed)\n', 'utf8');
    console.log('\ncleanup done; result written to tools/e2e_final_verification.txt');
    process.stderr.write('E2E_SUMMARY: failed=' + failed + ' passed=' + passed + '\n');
    await sleep(500);
    // Let a pending throw propagate to main().catch so the real error prints;
    // exitCode (not process.exit) still yields the right shell status.
    process.exitCode = failed === 0 ? 0 : 1;
  }
}

main().catch(function (err) {
  process.stderr.write('E2E_FATAL: ' + err.message + '\n');
  console.error('E2E FATAL: ' + err.message);
  process.exit(1);
});
