#!/usr/bin/env node
/**
 * Phase 2 RLS enforcement verification — runs REAL probes against the live
 * Supabase REST API (PostgREST):
 *
 *   For each of the 7 behavior-engine tables:
 *     1. anon SELECT  — must never return other users' rows (RLS-filtered).
 *     2. anon INSERT  — must be rejected with a row-level-security error
 *        (42501). If the write reaches a FK violation (23503) or succeeds,
 *        RLS is NOT being enforced → FAIL.
 *     3. service-role SELECT — must succeed (backend worker bypass, sanity).
 *
 * Any row accidentally created by an anon probe (i.e. RLS off) is deleted
 * immediately with the service-role key.
 *
 * Uses only existing credentials (service key from aura-backend/.env or env;
 * anon key from the frontend environment file — publishable by design).
 *
 * Usage: node supabase/verify_rls_rest.mjs
 */

import { supabaseRestConfig, anonKey } from './_lib.mjs';

const TABLES = ['ai_analyses', 'behaviors', 'behavior_evidence', 'trading_rules', 'behavior_alerts', 'trading_briefs', 'behavior_config'];

const randUuid = () => crypto.randomUUID();

function minimalRow(table) {
  const base = { user_id: randUuid(), account_id: randUuid() };
  switch (table) {
    case 'behaviors':
      return { ...base, name: '__rls_probe__', name_key: '__rls_probe__', behavior_type: 'negative', status: 'DETECTED' };
    case 'behavior_alerts':
      return { ...base, message: '__rls_probe__', dedupe_key: `rls-probe:${randUuid()}` };
    case 'trading_briefs':
      return { ...base, week_start: '1970-01-05', week_end: '1970-01-11', payload: {} };
    case 'trading_rules':
      return { ...base, rule: '__rls_probe__' };
    default:
      // ai_analyses, behavior_evidence, behavior_config need nothing extra.
      return base;
  }
}

async function main() {
  const { url, serviceKey } = supabaseRestConfig();
  const anon = anonKey();
  if (!anon) throw new Error('anon key not found (frontend environment file missing?)');

  let failures = 0;
  const ok = (m) => console.log(`  ✓ ${m}`);
  const fail = (m) => { failures++; console.log(`  ✗ ${m}`); };

  for (const table of TABLES) {
    console.log(`\n■ ${table}`);

    // 1. anon SELECT — must not leak rows.
    const sel = await fetch(`${url}/rest/v1/${table}?select=id&limit=5`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    if (!sel.ok) {
      fail(`anon select returned HTTP ${sel.status} (expected 200 with RLS-filtered empty result)`);
    } else {
      const rows = await sel.json();
      if (Array.isArray(rows) && rows.length === 0) ok('anon select returns no rows (RLS-filtered)');
      else fail(`anon select returned ${Array.isArray(rows) ? rows.length : '?'} rows — anon can read data!`);
    }

    // 2. anon INSERT — must hit RLS.
    const ins = await fetch(`${url}/rest/v1/${table}`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(minimalRow(table)),
    });
    const insBody = ins.ok ? await ins.json().catch(() => null) : await ins.json().catch(() => ({}));
    const code = insBody?.code;
    if (ins.ok) {
      fail('anon INSERT SUCCEEDED — RLS is not enforced on this table!');
      // Safety cleanup of the row just created (new tables only, never trades/accounts).
      for (const r of Array.isArray(insBody) ? insBody : insBody ? [insBody] : []) {
        if (r?.id) {
          await fetch(`${url}/rest/v1/${table}?id=eq.${r.id}`, {
            method: 'DELETE',
            headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
          });
          console.log('    (probe row cleaned up via service role)');
        }
      }
    } else if (code === '42501' || /row-level security/i.test(insBody?.message || '')) {
      ok(`anon insert blocked by RLS (42501)`);
    } else if (code === '23503') {
      fail('anon insert reached FK violation — RLS not enforced (constraint checked before policy)');
    } else {
      fail(`anon insert rejected with unexpected error: HTTP ${ins.status} code=${code} ${String(insBody?.message || '').slice(0, 120)}`);
    }

    // 3. service-role SELECT — sanity (worker bypass works).
    const svc = await fetch(`${url}/rest/v1/${table}?select=id&limit=1`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (svc.ok) ok('service-role select OK (worker bypass intact)');
    else fail(`service-role select failed: HTTP ${svc.status}`);
  }

  console.log(`\n${failures === 0 ? 'ALL RLS PROBES PASSED' : failures + ' RLS PROBE(S) FAILED'}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
