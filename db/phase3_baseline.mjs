#!/usr/bin/env node
/**
 * AURA Dashboard — PHASE 3 step 1: READ-ONLY source baseline.
 *
 * Captures, from the live Supabase project only:
 *   - per-table row counts
 *   - a deterministic per-table content checksum (md5 over canonical jsonb rows,
 *     order-independent) so parity can be proven after import
 *   - deep metrics for the tables that matter (timestamps, instruments, NULLs,
 *     duplicate tickets, composite-key uniqueness, FK orphans)
 *
 * Nothing is written to Supabase: the session is read-only, enforced server-side.
 * Output: db/audit/phase3_source_baseline.json
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveSource, connectSourceReadOnly, SUPABASE_TABLES, EXPECTED_COUNTS,
  AUDIT_DIR, localConfigs, localColumns,
} from './_source.mjs';
import { connectOrExplain, targetLabel } from './_lib.mjs';

/** Canonical, order-independent content checksum for a whole table. */
export function checksumSql(table, columns) {
  const cols = columns.map(c => `'${c}', x."${c}"`).join(', ');
  return `select count(*)::bigint as n,
                 coalesce(md5(string_agg(h, '' order by h)), 'd41d8cd98f00b204e9800998ecf8427e') as content_md5
            from (select md5((jsonb_build_object(${cols}))::text) as h
                    from public."${table}" x) s`;
}

export const DEEP = {
  trades: `select min(time_open)::text as min_time_open, max(time_open)::text as max_time_open,
                  min(time_open_ph)::text as min_time_open_ph, max(time_open_ph)::text as max_time_open_ph,
                  count(distinct instrument)::int as distinct_instruments,
                  count(distinct account_id)::int as distinct_accounts,
                  count(distinct buy_sell)::int as distinct_buy_sell,
                  count(*) filter (where ticket is null)::bigint as null_ticket,
                  count(*) filter (where account_id is null)::bigint as null_account,
                  count(*) filter (where time_close is null)::bigint as open_trades,
                  sum(pnl)::text as sum_pnl, sum(lots)::text as sum_lots,
                  min(created_at)::text as min_created, max(created_at)::text as max_created
             from public.trades`,
  accounts: `select count(distinct platform)::int as distinct_platform,
                    count(distinct phase)::int as distinct_phase,
                    count(distinct status)::int as distinct_status,
                    count(distinct drawdown_mode)::int as distinct_drawdown_mode,
                    count(distinct prop_firm_id)::int as distinct_prop_firms,
                    count(distinct user_id)::int as distinct_users,
                    sum(initial_balance)::text as sum_initial_balance
               from public.accounts`,
  behavior_evidence: `select count(distinct behavior_id)::int as distinct_behaviors,
                             count(distinct trade_id)::int as distinct_trades,
                             count(*) - count(distinct (behavior_id, trade_id))::bigint as duplicate_pairs,
                             min(created_at)::text as min_created, max(created_at)::text as max_created
                        from public.behavior_evidence`,
  ai_analyses: `select count(distinct status)::int as distinct_status,
                       count(distinct "trigger")::int as distinct_trigger,
                       min(created_at)::text as min_created, max(created_at)::text as max_created
                  from public.ai_analyses`,
  trade_screenshots: `select count(distinct ticket)::int as distinct_tickets,
                             count(distinct symbol)::int as distinct_symbols,
                             min(captured_at)::text as min_captured, max(captured_at)::text as max_captured
                        from public.trade_screenshots`,
  roi_transactions: `select count(distinct transaction_type)::int as distinct_types,
                            sum(amount)::text as sum_amount,
                            count(distinct user_id)::int as distinct_users,
                            min(transaction_date)::text as min_date, max(transaction_date)::text as max_date
                       from public.roi_transactions`,
  certificates: `select count(distinct status)::int as distinct_status,
                        count(distinct user_id)::int as distinct_users
                   from public.certificates`,
  user_settings: `select count(distinct user_id)::int as distinct_users,
                         min(created_at)::text as min_created, max(updated_at)::text as max_updated
                    from public.user_settings`,
};

export const DISCOVERY = {
  instruments: `select instrument, count(*)::int as n, min(time_open)::text as first_seen,
                       max(time_open)::text as last_seen
                  from public.trades group by instrument order by n desc, instrument`,
  duplicate_tickets: `select ticket::text as ticket, count(*)::int as n from public.trades
                       where ticket is not null group by ticket having count(*) > 1 order by n desc`,
  analysis_status_values: `select status, count(*)::int as n from public.ai_analyses
                            group by status order by n desc`,
  analysis_trigger_values: `select "trigger" as trigger, count(*)::int as n from public.ai_analyses
                             group by "trigger" order by n desc`,
  buy_sell_values: `select coalesce(buy_sell,'(null)') as buy_sell, count(*)::int as n
                      from public.trades group by buy_sell order by n desc`,
  account_status_values: `select coalesce(status,'(null)') as status, count(*)::int as n
                           from public.accounts group by status order by n desc`,
  instrument_aliases: `select regexp_replace(regexp_replace(upper(instrument),'[^A-Z0-9]','','g'),'GOLD','') as norm,
                              count(distinct instrument)::int as variants,
                              string_agg(distinct instrument, ' | ' order by instrument) as names
                         from public.trades where instrument is not null
                        group by 1 having count(distinct instrument) > 1
                        order by 2 desc`,
  fk_orphans_trades_account: `select count(*)::bigint as n from public.trades t
                               where t.account_id is not null
                                 and not exists (select 1 from public.accounts a where a.id = t.account_id)`,
  fk_orphans_evidence: `select count(*)::bigint as n from public.behavior_evidence e
                         where not exists (select 1 from public.behaviors b where b.id = e.behavior_id)`,
  fk_orphans_children_vs_users: `select
      (select count(*) from public.accounts x where x.user_id is not null
        and not exists (select 1 from auth.users u where u.id = x.user_id))::bigint as accounts_orphans,
      (select count(*) from public.profiles x
        where not exists (select 1 from auth.users u where u.id = x.id))::bigint as profiles_orphans,
      (select count(*) from public.user_settings x
        where not exists (select 1 from auth.users u where u.id = x.user_id))::bigint as user_settings_orphans`,
  composite_unique_behaviors: `select count(*)::bigint as duplicates from (
      select account_id, name_key, behavior_type from public.behaviors
       group by 1,2,3 having count(*) > 1) s`,
};

async function main() {
  const src = await resolveSource();
  console.log(`[baseline] source : ${src.host}:${src.port}/${src.database} (${src.via})`);
  console.log(`[baseline] project: ${src.ref} | region: ${src.region || '(from url)'}`);

  const srcDb = await connectSourceReadOnly(src);
  const { superuser: localCfg } = localConfigs();
  console.log(`[baseline] local  : ${targetLabel(localCfg)}`);
  const localDb = await connectOrExplain(localCfg, 'superuser (baseline comparison)');

  const out = {
    capturedAt: new Date().toISOString(),
    source: {
      host: src.host, port: src.port, database: src.database, projectRef: src.ref,
      region: src.region || null, mechanism: src.via, readOnly: true,
    },
    tables: {}, deep: {}, discovery: {}, authUsers: {}, discrepancies: [],
  };

  try {
    const ro = await srcDb.query('show transaction_read_only');
    console.log(`[baseline] source transaction_read_only = ${ro.rows[0].transaction_read_only}`);
    if (ro.rows[0].transaction_read_only !== 'on') {
      throw new Error('Source session is NOT read-only — refusing to continue.');
    }

    const cols = await localColumns(localDb);

    console.log('\n[baseline] per-table count + content checksum (source vs local)');
    for (const t of SUPABASE_TABLES) {
      const columns = cols.get(t);
      if (!columns) { out.discrepancies.push(`local column list missing for ${t}`); continue; }
      const sql = checksumSql(t, columns);
      const s = (await srcDb.query(sql)).rows[0];
      const l = (await localDb.query(sql)).rows[0];
      const expected = EXPECTED_COUNTS[t] ?? null;
      out.tables[t] = {
        sourceCount: Number(s.n), localCount: Number(l.n),
        sourceMd5: s.content_md5, localMd5: l.content_md5, expected,
      };
      const cntOk = expected === null || Number(s.n) === expected;
      const eq = Number(s.n) === Number(l.n) && s.content_md5 === l.content_md5;
      console.log(`  ${t.padEnd(20)} baseline=${String(s.n).padStart(5)} local=${String(l.n).padStart(5)} ` +
        `count=${cntOk ? 'ok' : 'MISMATCH'} parity=${eq ? 'ok' : (Number(l.n) === 0 ? 'pending' : 'DIFF')}`);
      if (!cntOk) out.discrepancies.push(`${t}: source ${s.n} != baseline ${expected}`);
      if (Number(l.n) !== 0) out.discrepancies.push(`${t}: local already has ${l.n} rows before import`);
    }

    console.log('\n[baseline] deep metrics (source)');
    for (const [t, sql] of Object.entries(DEEP)) {
      const s = (await srcDb.query(sql)).rows[0];
      out.deep[t] = s;
      console.log(`  ${t}: ${JSON.stringify(s)}`);
    }

    console.log('\n[baseline] value discovery (source)');
    for (const [k, sql] of Object.entries(DISCOVERY)) {
      try {
        const s = (await srcDb.query(sql)).rows;
        out.discovery[k] = s;
        console.log(`  ${k}:`);
        for (const r of s.slice(0, 20)) console.log(`     ${JSON.stringify(r)}`);
      } catch (e) {
        out.discovery[k] = { error: e.code || String(e.message).slice(0, 120) };
        console.log(`  ${k}: ERROR ${e.code || ''}`);
      }
    }

    const au = await srcDb.query(
      `select count(*)::bigint as n, min(created_at)::text as min_created,
              max(created_at)::text as max_created,
              count(*) filter (where email is null or email = '')::bigint as no_email
         from auth.users`);
    const ids = await srcDb.query('select id::text as id from auth.users order by created_at, id');
    out.authUsers = {
      count: Number(au.rows[0].n), minCreatedAt: au.rows[0].min_created,
      maxCreatedAt: au.rows[0].max_created, withoutEmail: Number(au.rows[0].no_email),
      ids: ids.rows.map(r => r.id),
    };
    console.log(`\n[baseline] auth.users: ${out.authUsers.count} (no-email=${out.authUsers.withoutEmail})`);
    console.log(`[baseline] auth.users UUIDs captured: ${out.authUsers.ids.length}`);

    try {
      const so = await srcDb.query(
        `select count(*)::bigint as n, count(distinct bucket_id)::int as buckets
           from storage.objects`);
      out.storageObjects = { count: Number(so.rows[0].n), buckets: so.rows[0].buckets };
      console.log(`[baseline] storage.objects: ${so.rows[0].n} object(s) in ${so.rows[0].buckets} bucket(s)`);
    } catch (e) {
      out.storageObjects = { error: e.code || 'unavailable' };
      console.log(`[baseline] storage.objects: unavailable (${e.code})`);
    }

    fs.mkdirSync(AUDIT_DIR, { recursive: true });
    fs.writeFileSync(path.join(AUDIT_DIR, 'phase3_source_baseline.json'),
      JSON.stringify(out, null, 2) + '\n', 'utf8');
    console.log('\n[baseline] written: db/audit/phase3_source_baseline.json');
    console.log(`[baseline] discrepancies: ${out.discrepancies.length}`);
    for (const d of out.discrepancies) console.log('   - ' + d);
    if (out.discrepancies.length) process.exitCode = 1;
  } finally {
    await srcDb.end().catch(() => {});
    await localDb.end().catch(() => {});
  }
}

const invokedDirectly = (process.argv[1] || '').replace(/\\/g, '/').endsWith('/phase3_baseline.mjs');
if (invokedDirectly) main().catch(err => { console.error(err.message); process.exit(1); });