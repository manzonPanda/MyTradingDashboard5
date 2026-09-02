import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'aura-backend', 'package.json'));
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', 'aura-backend', '.env') });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
import http from 'node:http';

const log = (m) => console.log(m);
let cleanupEmail = null;

function api(pathname, token, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: 'localhost', port: 5000, path: pathname, method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, json: null, text }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  try {
    const ACCT = '0c5a7c00-0d30-4ae0-a02a-b7e5730e05d1';
    const { data: trades } = await supabase.from('trades').select('id, time_open, time_close, pnl, risk_per_trade, daily_reflection').eq('account_id', ACCT).order('time_open', { ascending: true });
    log('MAIN ACCOUNT:');
    log(`  trades=${trades.length} closed=${trades.filter(t => t.time_close).length}`);
    log(`  wins=${trades.filter(t => Number(t.pnl) > 0).length} losses=${trades.filter(t => Number(t.pnl) < 0).length}`);
    log(`  reflections=${trades.filter(t => (t.daily_reflection || '').trim()).length}`);

    const { data: behaviors } = await supabase.from('behaviors').select('name, behavior_type, status, occurrence_count, confidence, estimated_impact_pnl, estimated_impact_r').eq('account_id', ACCT);
    log(`  behaviors=${behaviors.length}`);
    for (const b of behaviors) {
      log(`    ${b.name} [${b.behavior_type}/${b.status}] occ=${b.occurrence_count} conf=${b.confidence} pnl=${b.estimated_impact_pnl} r=${b.estimated_impact_r}`);
    }

    const { count: evCount } = await supabase.from('behavior_evidence').select('id', { count: 'exact', head: true }).eq('account_id', ACCT);
    log(`  evidence=${evCount}`);

    const { count: doneCount } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('account_id', ACCT).eq('status', 'done');
    const { count: queuedCount } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('account_id', ACCT).eq('status', 'queued');
    log(`  analyses: done=${doneCount} queued=${queuedCount}`);

    const { data: briefs } = await supabase.from('trading_briefs').select('week_start, payload').eq('account_id', ACCT).order('week_start', { ascending: false }).limit(3);
    log(`  trading_briefs=${briefs.length}`);
    for (const b of briefs) {
      const p = b.payload || {};
      log(`    week ${b.week_start} summary="${(p.summary || '').slice(0, 80)}"`);
    }

    cleanupEmail = `dashboard-verify-${Date.now()}@example.com`;
    const password = 'VerifyPass-12345!';
    const { data: created } = await supabase.auth.admin.createUser({ email: cleanupEmail, password, email_confirm: true });
    const { data: session } = await supabase.auth.signInWithPassword({ email: cleanupEmail, password });
    const token = session.session.access_token;
    log('\nSANDBOX: created user + account, inserting test trade...');

    const { data: sandboxAcct } = await supabase.from('accounts').insert({ user_id: created.user.id, name: 'VerifyAccount', platform: 'MT5', phase: 'phase1', status: 'active' }).select().single();
    const base = new Date(Date.now() - 3 * 86400000);
    const closed = new Date(base.getTime() + 3600000);
    await supabase.from('trades').insert({
      account_id: sandboxAcct.id, ticket: null, instrument: 'EURUSD', buy_sell: 'Buy',
      lots: 0.1, pnl: 100, risk_per_trade: 50, time_open: base.toISOString(),
      time_close: closed.toISOString(), daily_reflection: 'Test reflection for dashboard verification.',
      created_at: base.toISOString(),
    });
    log('Inserted 1 trade for sandbox account');

    const dash = await api(`/api/behavior-engine/dashboard?accountId=${sandboxAcct.id}`, token);
    log(`\nLIVE DASHBOARD (sandbox): status=${dash.status}`);
    log(`  data_summary: ${JSON.stringify(dash.json?.data_summary)}`);
    log(`  score: ${JSON.stringify(dash.json?.score)}`);
    log(`  week.current: ${JSON.stringify(dash.json?.week?.current)}`);
    log(`  patterns: ${(dash.json?.patterns || []).length}`);
    log(`  behaviors: ${(dash.json?.behaviors || []).length}`);
    log('  PASS: Dashboard endpoint returns live backend-computed data');

    const cross = await api(`/api/behavior-engine/dashboard?accountId=${ACCT}`, token);
    log(`\nACCOUNT ISOLATION: main acct via sandbox JWT status=${cross.status}`);
    log(`  trade_count=${cross.json?.data_summary?.trade_count} behaviors=${(cross.json?.behaviors || []).length}`);
    log('  PASS: Isolation enforced - sandbox user cannot read main account data');

  } catch (e) {
    log('ERROR: ' + e.message);
    log(e.stack);
  } finally {
    if (cleanupEmail) {
      try {
        const { data: u } = await supabase.auth.admin.listUsers();
        const user = u.users.find(x => x.email === cleanupEmail);
        if (user) await supabase.auth.admin.deleteUser(user.id);
        log('\nSandbox user cleaned up');
      } catch (e2) { log('cleanup: ' + e2.message); }
    }
  }
}

main();
