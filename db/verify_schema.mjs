#!/usr/bin/env node
/**
 * AURA Dashboard — PHASE 2 step 3
 * Verify the local schema against db/_expected.mjs and prove the privileges of
 * the least-privilege application role.
 *
 * Checks: tables, columns (+ critical types), primary keys, unique constraints,
 * CHECK constraints, foreign keys (target + ON DELETE), indexes,
 * idx_trades_ticket_unique as a PARTIAL UNIQUE index, triggers, updated_at
 * behaviour, aura_app DML across every table, aura_app denials (DDL / role /
 * superuser-only catalog / extension), owners, and that NO data was migrated.
 *
 * Read-only with respect to user data: every write test runs inside a
 * transaction that is rolled back.
 *
 * Usage:  node db/verify_schema.mjs
 */
import {
  loadEnvLocal, superuserConfig, appConfig, appDatabase, appRole,
  connectOrExplain, targetLabel,
} from './_lib.mjs';
import {
  EXPECTED, EXPECTED_TABLE_COUNT, EXPECTED_COLUMN_TYPES, READ_ONLY_FOR_APP,
} from './_expected.mjs';

let pass = 0; let fail = 0; let warn = 0;
const failures = [];
const ok = (m) => { pass++; console.log(`  ok   ${m}`); };
const bad = (m) => { fail++; failures.push(m); console.log(`  FAIL ${m}`); };
const warning = (m) => { warn++; console.log(`  warn ${m}`); };
const section = (t) => console.log(`\n== ${t} ==`);
const setDiff = (a, b) => a.filter((x) => !b.has(x));

const HELPERS = {
  userId: '11111111-1111-4111-8111-111111111111',
  acctId: '22222222-2222-4222-8222-222222222222',
  tradeId: '33333333-3333-4333-8333-333333333333',
};

async function main() {
  const envFileLoaded = loadEnvLocal();
  const app = appRole();
  const db = appDatabase();
  const supCfg = superuserConfig({ database: db });
  const appCfg = appConfig();

  console.log('[verify] AURA Dashboard Phase 2 — schema + privilege verification');
  console.log(`[verify] superuser target : ${targetLabel(supCfg)}`);
  console.log(`[verify] app role target  : ${targetLabel(appCfg)}`);
  console.log(`[verify] env file         : db/.env.local ${envFileLoaded ? 'loaded' : 'not present'}`);

  const sup = await connectOrExplain(supCfg, 'schema owner/superuser');
  const appClient = await connectOrExplain(appCfg, `application role (${app})`);

  try {
    // ── role attributes ────────────────────────────────────────────────────
    section(`role "${app}" attributes`);
    const roleRes = await sup.query(
      `select rolname, rolsuper, rolcanlogin, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
         from pg_roles where rolname = $1`, [app]);
    if (!roleRes.rows.length) {
      bad(`role ${app} does not exist`);
    } else {
      const r = roleRes.rows[0];
      if (r.rolcanlogin) ok('CAN log in'); else bad('cannot log in');
      if (!r.rolsuper) ok('is NOT a superuser'); else bad('IS a superuser');
      if (!r.rolcreatedb) ok('cannot create databases'); else bad('can create databases');
      if (!r.rolcreaterole) ok('cannot create roles'); else bad('can create roles');
      if (!r.rolreplication) ok('no replication privilege'); else bad('has replication privilege');
      if (!r.rolbypassrls) ok('cannot bypass RLS'); else bad('can bypass RLS');
    }

    // ── tables ─────────────────────────────────────────────────────────────
    section('tables');
    const tblRes = await sup.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`);
    const actualTables = new Set(tblRes.rows.map((r) => r.table_name));
    for (const t of Object.keys(EXPECTED)) {
      if (actualTables.has(t)) ok(`table ${t}`); else bad(`table ${t} is MISSING`);
    }
    if (actualTables.size !== EXPECTED_TABLE_COUNT) {
      const extra = [...actualTables].filter((t) => !EXPECTED[t]);
      if (extra.length) warning(`unexpected extra table(s) in public: ${extra.join(', ')}`);
      if (actualTables.size < EXPECTED_TABLE_COUNT) bad(`expected ${EXPECTED_TABLE_COUNT} tables, found ${actualTables.size}`);
    } else {
      ok(`exactly ${EXPECTED_TABLE_COUNT} tables (no extras)`);
    }

    // ── columns + critical types ───────────────────────────────────────────
    section('columns and critical column types');
    const colRes = await sup.query(
      `select table_name, column_name, data_type from information_schema.columns
        where table_schema = 'public'`);
    const colsByTable = new Map();
    const typeByKey = new Map();
    for (const r of colRes.rows) {
      if (!colsByTable.has(r.table_name)) colsByTable.set(r.table_name, new Set());
      colsByTable.get(r.table_name).add(r.column_name);
      typeByKey.set(`${r.table_name}.${r.column_name}`, r.data_type);
    }
    for (const [t, spec] of Object.entries(EXPECTED)) {
      const actual = colsByTable.get(t);
      if (!actual) { bad(`${t}: cannot check columns (table missing)`); continue; }
      const missing = spec.columns.filter((c) => !actual.has(c));
      const extra = [...actual].filter((c) => !spec.columns.includes(c));
      if (missing.length === 0) ok(`${t}: all ${spec.columns.length} expected columns present`);
      else bad(`${t}: missing column(s): ${missing.join(', ')}`);
      if (extra.length) warning(`${t}: extra column(s) not in the expected spec: ${extra.join(', ')}`);
    }
    for (const [key, expectedType] of Object.entries(EXPECTED_COLUMN_TYPES)) {
      const actualType = typeByKey.get(key);
      if (actualType === undefined) bad(`type ${key}: column missing`);
      else if (actualType === expectedType) ok(`type ${key} = ${expectedType}`);
      else bad(`type ${key} = "${actualType}" but expected "${expectedType}"`);
    }
  // ── constraints: PK / UNIQUE / CHECK / FK ──────────────────────────────
    section('primary keys, unique, check and foreign-key constraints');
    const conRes = await sup.query(
      `select c.conname, c.contype, c.conrelid::regclass::text as tbl,
              pg_get_constraintdef(c.oid) as def
         from pg_constraint c
        where c.connamespace = 'public'::regnamespace`);
    const conByTable = new Map();
    for (const r of conRes.rows) {
      const t = r.tbl.replace(/^public\./, '');
      if (!conByTable.has(t)) conByTable.set(t, []);
      conByTable.get(t).push(r);
    }
    for (const [t, spec] of Object.entries(EXPECTED)) {
      const cons = conByTable.get(t) || [];
      if (cons.some((c) => c.conname === spec.pk && c.contype === 'p')) ok(`${t}: primary key ${spec.pk}`);
      else bad(`${t}: primary key ${spec.pk} missing or wrong type`);
      for (const u of spec.uniques) {
        if (cons.some((c) => c.conname === u && (c.contype === 'u' || c.contype === 'p'))) ok(`${t}: unique constraint ${u}`);
        else bad(`${t}: unique constraint ${u} missing`);
      }
      for (const ch of spec.checks) {
        if (cons.some((c) => c.conname === ch && c.contype === 'c')) ok(`${t}: check constraint ${ch}`);
        else bad(`${t}: check constraint ${ch} missing`);
      }
      for (const fk of spec.fks) {
        const found = cons.find((c) => c.conname === fk.name && c.contype === 'f');
        if (!found) { bad(`${t}: foreign key ${fk.name} missing`); continue; }
        const refOk = new RegExp(`REFERENCES\\s+${fk.ref}\\s*\\(`, 'i').test(found.def);
        const delOk = fk.onDelete
          ? new RegExp(`ON DELETE ${fk.onDelete}`, 'i').test(found.def)
          : !/ON DELETE/i.test(found.def);
        if (refOk && delOk) ok(`${t}: FK ${fk.name} → ${fk.ref}${fk.onDelete ? ` ON DELETE ${fk.onDelete}` : ' (NO ACTION)'}`);
        else bad(`${t}: FK ${fk.name} definition wrong: ${found.def}`);
      }
    }

    // ── indexes ────────────────────────────────────────────────────────────
    section('indexes');
    const idxRes = await sup.query(
      `select tablename, indexname, indexdef from pg_indexes where schemaname = 'public'`);
    const idxByTable = new Map();
    const idxDefByName = new Map();
    for (const r of idxRes.rows) {
      if (!idxByTable.has(r.tablename)) idxByTable.set(r.tablename, new Set());
      idxByTable.get(r.tablename).add(r.indexname);
      idxDefByName.set(r.indexname, r.indexdef);
    }
    for (const [t, spec] of Object.entries(EXPECTED)) {
      const have = idxByTable.get(t) || new Set();
      const missing = spec.indexes.filter((i) => !have.has(i));
      if (!missing.length) ok(`${t}: all ${spec.indexes.length} expected index(es) present`);
      else bad(`${t}: missing index(es): ${missing.join(', ')}`);
    }

    // ── the partial unique index that guards duplicate tickets ─────────────
    section('idx_trades_ticket_unique must be a PARTIAL UNIQUE index');
    const ticketIdxDef = idxDefByName.get('idx_trades_ticket_unique') || '';
    if (!ticketIdxDef) {
      bad('idx_trades_ticket_unique does not exist');
    } else {
      if (/CREATE UNIQUE INDEX/i.test(ticketIdxDef)) ok('is UNIQUE');
      else bad(`is not UNIQUE: ${ticketIdxDef}`);
      if (/WHERE\s+\(?\s*ticket\s+IS\s+NOT\s+NULL\s*\)?/i.test(ticketIdxDef)) ok('is PARTIAL (WHERE ticket IS NOT NULL)');
      else bad(`partial predicate missing: ${ticketIdxDef}`);
      if (/ON\s+(public\.)?trades/i.test(ticketIdxDef)) ok('is defined on public.trades');
      else bad(`wrong table: ${ticketIdxDef}`);
      console.log(`       ${ticketIdxDef}`);
    }

  // ── triggers + trigger functions ───────────────────────────────────────
    section('triggers and updated_at functions');
    const trigRes = await sup.query(
      `select c.relname as tbl, t.tgname
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and not t.tgisinternal`);
    const trigByTable = new Map();
    for (const r of trigRes.rows) {
      if (!trigByTable.has(r.tbl)) trigByTable.set(r.tbl, new Set());
      trigByTable.get(r.tbl).add(r.tgname);
    }
    for (const [t, spec] of Object.entries(EXPECTED)) {
      const have = trigByTable.get(t) || new Set();
      for (const tr of spec.triggers) {
        if (have.has(tr)) ok(`${t}: trigger ${tr}`);
        else bad(`${t}: trigger ${tr} missing`);
      }
    }
    const fnRes = await sup.query(
      `select p.proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('set_updated_at', 'handle_updated_at')`);
    const fnNames = new Set(fnRes.rows.map((r) => r.proname));
    for (const f of ['set_updated_at', 'handle_updated_at']) {
      if (fnNames.has(f)) ok(`function public.${f}()`);
      else bad(`function public.${f}() missing`);
    }

    // ─ ownership ──────────────────────────────────────────────────────────
    section('object ownership (least privilege)');
    const ownRes = await sup.query(
      `select tablename, tableowner from pg_tables where schemaname = 'public'`);
    const ownedByApp = ownRes.rows.filter((r) => r.tableowner === app).map((r) => r.tablename);
    if (ownedByApp.length === 0) ok(`no table is owned by ${app} — it cannot ALTER or DROP anything`);
    else bad(`table(s) owned by ${app}: ${ownedByApp.join(', ')}`);

    // ── updated_at behaviour (all writes rolled back) ──────────────────────
    section('updated_at trigger behaviour (all writes rolled back)');
    try {
      await sup.query('begin');
      await sup.query(`insert into public.aura_users (id, email) values ($1, 'phase2-verify@local.invalid')`, [HELPERS.userId]);
      await sup.query(`insert into public.accounts (id, name, user_id) values ($1, 'phase2-verify', $2)`, [HELPERS.acctId, HELPERS.userId]);
      await sup.query(`insert into public.trades (id, account_id, ticket) values ($1, $2, 900000001)`, [HELPERS.tradeId, HELPERS.acctId]);
      await sup.query(`insert into public.roi_transactions (id, transaction_date, transaction_type, amount, user_id)
                       values ('12121212-1212-4212-8212-121212121212', '2026-01-04', 'expense', 25, $1)`, [HELPERS.userId]);

      await sup.query(`update public.aura_users set updated_at = '2000-01-01T00:00:00Z' where id = $1`, [HELPERS.userId]);
      await sup.query(`update public.trades set updated_at = '2000-01-01T00:00:00Z', pnl = 1 where id = $1`, [HELPERS.tradeId]);
      await sup.query(`update public.roi_transactions set updated_at = '2000-01-01T00:00:00Z', amount = 26
                        where id = '12121212-1212-4212-8212-121212121212'`);

      const a1 = await sup.query(`select (updated_at > '2020-01-01T00:00:00Z') as advanced
                                    from public.aura_users where id = $1`, [HELPERS.userId]);
      const b1 = await sup.query(`select (updated_at > '2020-01-01T00:00:00Z') as advanced
                                    from public.trades where id = $1`, [HELPERS.tradeId]);
      const c1 = await sup.query(`select (updated_at > '2020-01-01T00:00:00Z') as advanced
                                    from public.roi_transactions where id = '12121212-1212-4212-8212-121212121212'`);
      if (a1.rows[0].advanced) ok('set_updated_at() fires on aura_users'); else bad('set_updated_at() did NOT fire on aura_users');
      if (b1.rows[0].advanced) ok('handle_updated_at() fires on trades'); else bad('handle_updated_at() did NOT fire on trades');
      if (c1.rows[0].advanced) ok('handle_updated_at() fires on roi_transactions'); else bad('handle_updated_at() did NOT fire on roi_transactions');
    } catch (e) {
      bad(`updated_at behaviour test errored: ${e.code || ''} ${e.message}`);
    } finally {
      await sup.query('rollback').catch(() => {});
    }

    // ── aura_app privileges (grant matrix) ─────────────────────────────────
    section(`privileges of "${app}" (grant matrix)`);
    const privRes = await sup.query(
      `select t as table_name,
              has_table_privilege($1, 'public.' || t, 'SELECT') as can_select,
              has_table_privilege($1, 'public.' || t, 'INSERT') as can_insert,
              has_table_privilege($1, 'public.' || t, 'UPDATE') as can_update,
              has_table_privilege($1, 'public.' || t, 'DELETE') as can_delete
         from unnest($2::text[]) as t order by t`, [app, Object.keys(EXPECTED)]);
    for (const r of privRes.rows) {
      const readOnly = READ_ONLY_FOR_APP.includes(r.table_name);
      const expected = readOnly
        ? { can_select: true, can_insert: false, can_update: false, can_delete: false }
        : { can_select: true, can_insert: true, can_update: true, can_delete: true };
      const good = ['can_select', 'can_insert', 'can_update', 'can_delete']
        .every((k) => r[k] === expected[k]);
      if (good) ok(`${r.table_name}: ${readOnly ? 'SELECT only' : 'SELECT/INSERT/UPDATE/DELETE'}`);
      else bad(`${r.table_name}: got s=${r.can_select} i=${r.can_insert} u=${r.can_update} d=${r.can_delete}, expected s=${expected.can_select} i=${expected.can_insert} u=${expected.can_update} d=${expected.can_delete}`);
    }
    const schRes = await sup.query(
      `select has_schema_privilege($1, 'public', 'USAGE') as can_use,
              has_schema_privilege($1, 'public', 'CREATE') as can_create`, [app]);
    if (schRes.rows[0].can_use) ok('USAGE on schema public'); else bad('missing USAGE on schema public');
    if (!schRes.rows[0].can_create) ok('NO CREATE on schema public (cannot add objects)');
    else bad('has CREATE on schema public');

    // ── aura_app real DML across every application table (rolled back) ─────
    section(`"${app}" application-level DML across all tables (rolled back)`);
    try {
      await sup.query('begin');
      // The user row is created by the schema owner: aura_app is intentionally
      // NOT allowed to create users in Phase 2.
      await sup.query(`insert into public.aura_users (id, email) values ($1, 'phase2-verify-app@local.invalid')`, [HELPERS.userId]);
      await sup.query(`set local role ${app}`);

      await sup.query(`insert into public.accounts (id, name, user_id) values ($1, 'phase2-app', $2)`, [HELPERS.acctId, HELPERS.userId]);
      await sup.query(`insert into public.user_settings (user_id) values ($1)`, [HELPERS.userId]);
      await sup.query(`insert into public.profiles (id, display_name) values ($1, 'Phase 2 verify')`, [HELPERS.userId]);
      await sup.query(`insert into public.trades (id, account_id, ticket, buy_sell, instrument)
                       values ($1, $2, 900000002, 'Buy', 'EURUSD')`, [HELPERS.tradeId, HELPERS.acctId]);
      await sup.query(`insert into public.prop_firms (id, name) values ('44444444-4444-4444-8444-444444444444', 'Phase2 Firm')`);
      await sup.query(`insert into public.certificates (id, user_id, account_id, passed_date)
                       values ('55555555-5555-4555-8555-555555555555', $1, $2, '2026-01-01')`, [HELPERS.userId, HELPERS.acctId]);
      await sup.query(`insert into public.payouts (id, user_id, firm_name, amount, payout_date)
                       values ('66666666-6666-4666-8666-666666666666', $1, 'Phase2 Firm', 100, '2026-01-02')`, [HELPERS.userId]);
      await sup.query(`insert into public.roi_transactions (id, transaction_date, transaction_type, amount, user_id)
                       values ('77777777-7777-4777-8777-777777777777', '2026-01-03', 'expense', 50, $1)`, [HELPERS.userId]);
      await sup.query(`insert into public.trade_screenshots (id, ticket, storage_path)
                       values ('88888888-8888-4888-8888-888888888888', '900000002', '900000002/EURUSD.png')`);
      ok('core tables: INSERT succeeded under ' + app);

      await sup.query(`insert into public.ai_conversations (id, user_id) values ('99999999-9999-4999-8999-999999999999', $1)`, [HELPERS.userId]);
      await sup.query(`insert into public.ai_messages (id, conversation_id, user_id, role, content)
                       values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '99999999-9999-4999-8999-999999999999', $1, 'user', 'hi')`, [HELPERS.userId]);
      await sup.query(`insert into public.ai_memories (id, user_id, memory, memory_type)
                       values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', $1, 'verify', 'fact')`, [HELPERS.userId]);
      await sup.query(`insert into public.ai_insights (id, user_id, insight_type, title, content)
                       values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', $1, 'coaching_tip', 't', 'c')`, [HELPERS.userId]);
      await sup.query(`insert into public.ai_analyses (id, user_id, account_id, trade_id)
                       values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', $1, $2, $3)`, [HELPERS.userId, HELPERS.acctId, HELPERS.tradeId]);
      await sup.query(`insert into public.behaviors (id, user_id, account_id, name, name_key, behavior_type)
                       values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', $1, $2, 'Revenge trading', 'revenge_trading', 'negative')`, [HELPERS.userId, HELPERS.acctId]);
      await sup.query(`insert into public.behavior_evidence (id, user_id, account_id, behavior_id, trade_id, analysis_id)
                       values ('ffffffff-ffff-4fff-8fff-ffffffffffff', $1, $2, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', $3, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')`, [HELPERS.userId, HELPERS.acctId, HELPERS.tradeId]);
      await sup.query(`insert into public.trading_rules (id, user_id, account_id, rule)
                       values ('1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', $1, $2, 'No revenge entries')`, [HELPERS.userId, HELPERS.acctId]);
      await sup.query(`insert into public.behavior_alerts (id, user_id, account_id, message, dedupe_key)
                       values ('2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b', $1, $2, 'too frequent', 'freq:1')`, [HELPERS.userId, HELPERS.acctId]);
      await sup.query(`insert into public.trading_briefs (id, user_id, account_id, week_start, week_end)
                       values ('3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c', $1, $2, '2026-01-05', '2026-01-11')`, [HELPERS.userId, HELPERS.acctId]);
      await sup.query(`insert into public.behavior_config (id, user_id, account_id)
                       values ('4d4d4d4d-4d4d-4d4d-8d4d-4d4d4d4d4d4d', $1, $2)`, [HELPERS.userId, HELPERS.acctId]);
      ok('AI + behaviour tables: INSERT succeeded under ' + app);

      await sup.query(`update public.user_settings set daily_target_percent = 3 where user_id = $1`, [HELPERS.userId]);
      await sup.query(`update public.trades set pnl = 10, rrr = '2.5' where id = $1`, [HELPERS.tradeId]);
      await sup.query(`update public.behaviors set occurrence_count = 1 where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'`);
      await sup.query(`delete from public.trade_screenshots where id = '88888888-8888-4888-8888-888888888888'`);
      await sup.query(`delete from public.roi_transactions where id = '77777777-7777-4777-8777-777777777777'`);
      ok('UPDATE + DELETE succeeded under ' + app);

      // The application must not be able to bypass CHECK constraints.
      try {
        await sup.query(`insert into public.trades (id, account_id, buy_sell)
                         values ('5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e', $1, 'HOLD')`, [HELPERS.acctId]);
        bad('CHECK trades_buy_sell_check was NOT enforced');
      } catch (e) {
        ok(`CHECK trades_buy_sell_check enforced (SQLSTATE ${e.code || 'error'})`);
      }
    } catch (e) {
      bad(`${app} DML test failed: ${e.code || ''} ${e.message}`);
    } finally {
      await sup.query('rollback').catch(() => {});
    }

  // ── aura_app must be DENIED everything outside its DML grants ──────────
    section(`"${app}" must be DENIED (DDL / role / superuser operations)`);
    const denyInTx = async (label, sql) => {
      try {
        await sup.query('begin');
        await sup.query(`set local role ${app}`);
        await sup.query(sql);
        await sup.query('rollback');
        bad(`${label}: statement was ALLOWED but must be denied`);
      } catch (e) {
        await sup.query('rollback').catch(() => {});
        ok(`${label}: denied (SQLSTATE ${e.code || 'error'})`);
      } finally {
        await sup.query('reset role').catch(() => {});
      }
    };
    await denyInTx('CREATE TABLE in public', 'create table public.phase2_should_fail(id int)');
    await denyInTx('CREATE ROLE', 'create role phase2_should_fail_role');
    await denyInTx('CREATE SCHEMA', 'create schema phase2_should_fail_schema');
    await denyInTx('ALTER TABLE public.trades', 'alter table public.trades add column phase2_should_fail int');
    await denyInTx('DROP TABLE public.trades', 'drop table public.trades');
    await denyInTx('TRUNCATE public.trades', 'truncate public.trades');
    await denyInTx('CREATE EXTENSION', 'create extension if not exists hstore');
    await denyInTx('INSERT into aura_users', `insert into public.aura_users (email) values ('x@local.invalid')`);
    await denyInTx('read pg_authid (superuser-only catalog)', 'select * from pg_authid');
    await denyInTx('UPDATE pg_class (system catalog)', 'update pg_class set relname = relname where false');

    // CREATE DATABASE cannot run inside a transaction block — separate path.
    try {
      await sup.query(`set role ${app}`);
      await sup.query('create database phase2_should_fail_db');
      await sup.query('reset role');
      bad('CREATE DATABASE: was ALLOWED but must be denied');
      await sup.query('drop database phase2_should_fail_db').catch(() => {});
    } catch (e) {
      await sup.query('reset role').catch(() => {});
      ok(`CREATE DATABASE: denied (SQLSTATE ${e.code || 'error'})`);
    }

    // Positive control through the real aura_app connection.
    try {
      const rc = await appClient.query('select count(*)::int as n from public.trades');
      ok(`positive control: aura_app SELECT on public.trades allowed (rows=${rc.rows[0].n})`);
    } catch (e) {
      bad(`positive control failed: ${e.code || ''} ${e.message}`);
    }

    // ── data state: Phase 2 must not have migrated any rows ───────────────
    section('data state (Phase 2 must not migrate data)');
    const countCols = Object.keys(EXPECTED)
      .map((t) => `(select count(*) from public.${t})::bigint as "${t}"`).join(', ');
    const cntRes = await sup.query(`select ${countCols}`);
    const rowCounts = cntRes.rows[0];
    const totalRows = Object.values(rowCounts).reduce((acc, v) => acc + Number(v), 0);
    if (totalRows === 0) ok(`all ${EXPECTED_TABLE_COUNT} tables are EMPTY (Phase 3 has not run yet)`);
    else warning(`total rows = ${totalRows}: ${Object.entries(rowCounts).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${k}=${v}`).join(', ')}`);

    // Every write test ran in a rolled-back transaction — prove it.
    const leftRes = await sup.query(
      `select count(*)::int as n from public.aura_users where email like 'phase2-verify%@local.invalid'`);
    if (leftRes.rows[0].n === 0) ok('no verification rows left behind');
    else bad(`${leftRes.rows[0].n} verification row(s) left behind`);

  } finally {
    await sup.end().catch(() => {});
    await appClient.end().catch(() => {});
  }

  section('summary');
  console.log(`  pass=${pass}  fail=${fail}  warn=${warn}`);
  if (fail > 0) {
    console.error(`\n[verify] ${fail} CHECK(S) FAILED:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\n[verify] ALL CHECKS PASSED');
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });