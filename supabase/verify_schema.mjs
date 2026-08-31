#!/usr/bin/env node
/**
 * Phase 2 schema verification — checks the LIVE Supabase database against the
 * exact schema defined by the 10 migration files:
 *
 *   table existence, columns, foreign keys, indexes, unique constraints,
 *   RLS enabled, RLS policies, triggers.
 *
 * Uses the same authenticated SQL path as the applier (env-only credentials).
 * Exit code 0 = all checks pass; 1 = one or more failures.
 *
 * Usage: node supabase/verify_schema.mjs
 */

import { resolveSqlAccess, execSql } from './_lib.mjs';

// ── Expected schema (mirrors the committed SQL files verbatim) ──────────────
export const EXPECTED = {
  tables: {
    ai_analyses: {
      columns: ['id', 'user_id', 'account_id', 'trigger', 'trade_id', 'status', 'attempts', 'max_attempts', 'last_error', 'model', 'prompt_version', 'input_summary', 'raw_response', 'started_at', 'finished_at', 'created_at', 'updated_at'],
      uniques: [],
      fks: [
        { column: 'user_id', ref: 'auth.users', on_delete: 'CASCADE' },
        { column: 'account_id', ref: 'public.accounts', on_delete: 'CASCADE' },
        { column: 'trade_id', ref: 'public.trades', on_delete: 'SET NULL' },
      ],
      indexes: ['idx_ai_analyses_user_created', 'idx_ai_analyses_account_status', 'idx_ai_analyses_status_created'],
      triggers: ['ai_analyses_set_updated_at'],
      policies: ['Users can view own analyses', 'Users can create own analyses', 'Users can update own analyses', 'Users can delete own analyses'],
    },
    behaviors: {
      columns: ['id', 'user_id', 'account_id', 'name', 'name_key', 'behavior_type', 'description', 'status', 'occurrence_count', 'confidence', 'estimated_impact_pnl', 'estimated_impact_r', 'first_detected_at', 'last_detected_at', 'last_confirmed_at', 'model', 'created_at', 'updated_at'],
      uniques: ['behaviors_account_name_key_type_unique'],
      fks: [
        { column: 'user_id', ref: 'auth.users', on_delete: 'CASCADE' },
        { column: 'account_id', ref: 'public.accounts', on_delete: 'CASCADE' },
      ],
      indexes: ['idx_behaviors_user', 'idx_behaviors_account_status', 'idx_behaviors_account_type_status'],
      triggers: ['behaviors_set_updated_at'],
      policies: ['Users can view own behaviors', 'Users can create own behaviors', 'Users can update own behaviors', 'Users can delete own behaviors'],
    },
    behavior_evidence: {
      columns: ['id', 'user_id', 'account_id', 'behavior_id', 'analysis_id', 'trade_id', 'trade_ticket', 'trade_time_open', 'week_start', 'reflection_excerpt', 'reason', 'metrics_snapshot', 'evidence_confidence', 'created_at'],
      uniques: ['behavior_evidence_behavior_trade_unique'],
      fks: [
        { column: 'user_id', ref: 'auth.users', on_delete: 'CASCADE' },
        { column: 'account_id', ref: 'public.accounts', on_delete: 'CASCADE' },
        { column: 'behavior_id', ref: 'public.behaviors', on_delete: 'CASCADE' },
        { column: 'analysis_id', ref: 'public.ai_analyses', on_delete: 'SET NULL' },
        { column: 'trade_id', ref: 'public.trades', on_delete: 'CASCADE' },
      ],
      indexes: ['idx_behavior_evidence_user', 'idx_behavior_evidence_account_created', 'idx_behavior_evidence_behavior', 'idx_behavior_evidence_trade', 'idx_behavior_evidence_week'],
      triggers: [],
      policies: ['Users can view own evidence', 'Users can create own evidence', 'Users can update own evidence', 'Users can delete own evidence'],
    },
    trading_rules: {
      columns: ['id', 'user_id', 'account_id', 'source_behavior_id', 'rule', 'rationale', 'confidence', 'evidence_summary', 'status', 'created_at', 'updated_at'],
      uniques: ['trading_rules_account_rule_unique'],
      fks: [
        { column: 'user_id', ref: 'auth.users', on_delete: 'CASCADE' },
        { column: 'account_id', ref: 'public.accounts', on_delete: 'CASCADE' },
        { column: 'source_behavior_id', ref: 'public.behaviors', on_delete: 'SET NULL' },
      ],
      indexes: ['idx_trading_rules_user', 'idx_trading_rules_account_status'],
      triggers: ['trading_rules_set_updated_at'],
      policies: ['Users can view own trading rules', 'Users can create own trading rules', 'Users can update own trading rules', 'Users can delete own trading rules'],
    },
    behavior_alerts: {
      columns: ['id', 'user_id', 'account_id', 'alert_type', 'severity', 'status', 'message', 'behavior_id', 'trade_id', 'analysis_id', 'dedupe_key', 'created_at'],
      uniques: ['behavior_alerts_account_dedupe_unique'],
      fks: [
        { column: 'user_id', ref: 'auth.users', on_delete: 'CASCADE' },
        { column: 'account_id', ref: 'public.accounts', on_delete: 'CASCADE' },
        { column: 'behavior_id', ref: 'public.behaviors', on_delete: 'SET NULL' },
        { column: 'trade_id', ref: 'public.trades', on_delete: 'SET NULL' },
        { column: 'analysis_id', ref: 'public.ai_analyses', on_delete: 'SET NULL' },
      ],
      indexes: ['idx_behavior_alerts_user', 'idx_behavior_alerts_account_status', 'idx_behavior_alerts_behavior'],
      triggers: [],
      policies: ['Users can view own behavior alerts', 'Users can create own behavior alerts', 'Users can update own behavior alerts', 'Users can delete own behavior alerts'],
    },
    trading_briefs: {
      columns: ['id', 'user_id', 'account_id', 'week_start', 'week_end', 'payload', 'model', 'prompt_version', 'generated_at', 'created_at', 'updated_at'],
      uniques: ['trading_briefs_account_week_unique'],
      fks: [
        { column: 'user_id', ref: 'auth.users', on_delete: 'CASCADE' },
        { column: 'account_id', ref: 'public.accounts', on_delete: 'CASCADE' },
      ],
      indexes: ['idx_trading_briefs_user', 'idx_trading_briefs_account_week'],
      triggers: ['trading_briefs_set_updated_at'],
      policies: ['Users can view own trading briefs', 'Users can create own trading briefs', 'Users can update own trading briefs', 'Users can delete own trading briefs'],
    },
    behavior_config: {
      columns: ['id', 'user_id', 'account_id', 'thresholds', 'created_at', 'updated_at'],
      uniques: ['behavior_config_account_unique'],
      fks: [
        { column: 'user_id', ref: 'auth.users', on_delete: 'CASCADE' },
        { column: 'account_id', ref: 'public.accounts', on_delete: 'CASCADE' },
      ],
      indexes: ['idx_behavior_config_user'],
      triggers: ['behavior_config_set_updated_at'],
      policies: ['Users can view own behavior config', 'Users can create own behavior config', 'Users can update own behavior config', 'Users can delete own behavior config'],
    },
  },
};

function catalogQuery(tableNames) {
  const list = tableNames.map((t) => `'${t}'`).join(', ');
  return `
    select c.relname as table_name, c.relrowsecurity as rls_enabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in (${list}) and c.relkind = 'r';
  `;
}

function columnsQuery(tableNames) {
  const list = tableNames.map((t) => `'${t}'`).join(', ');
  return `
    select table_name, column_name, data_type
    from information_schema.columns
    where table_schema = 'public' and table_name in (${list})
    order by table_name, ordinal_position;
  `;
}

function constraintsQuery(tableNames) {
  const list = tableNames.map((t) => `'public.${t}'::regclass`).join(', ');
  return `
    select conrelid::regclass::text as table_name, conname, contype,
           pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid in (${list});
  `;
}

function indexesQuery(tableNames) {
  const list = tableNames.map((t) => `'${t}'`).join(', ');
  return `
    select tablename as table_name, indexname
    from pg_indexes
    where schemaname = 'public' and tablename in (${list});
  `;
}

function triggersQuery(tableNames) {
  const list = tableNames.map((t) => `'${t}'`).join(', ');
  return `
    select event_object_table as table_name, trigger_name
    from information_schema.triggers
    where trigger_schema = 'public' and event_object_table in (${list});
  `;
}

function policiesQuery(tableNames) {
  const list = tableNames.map((t) => `'${t}'`).join(', ');
  return `
    select tablename as table_name, policyname
    from pg_policies
    where schemaname = 'public' and tablename in (${list});
  `;
}

/**
 * Runs every check against the live DB via the provided access handle.
 * Returns the number of failures; prints a detailed report.
 */
export async function runVerify(access) {
  const tableNames = Object.keys(EXPECTED.tables);
  let failures = 0;
  const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`); };
  const ok = (msg) => console.log(`  ✓ ${msg}`);

  const [tablesRes, colsRes, consRes, idxRes, trigRes, polRes] = await Promise.all([
    execSql(access, catalogQuery(tableNames)),
    execSql(access, columnsQuery(tableNames)),
    execSql(access, constraintsQuery(tableNames)),
    execSql(access, indexesQuery(tableNames)),
    execSql(access, triggersQuery(tableNames)),
    execSql(access, policiesQuery(tableNames)),
  ]);

  const rows = (r) => (Array.isArray(r) ? r : r?.rows ?? []);
  const tables = new Map(rows(tablesRes).map((r) => [r.table_name, r]));
  const colsByTable = new Map();
  for (const r of rows(colsRes)) {
    if (!colsByTable.has(r.table_name)) colsByTable.set(r.table_name, new Set());
    colsByTable.get(r.table_name).add(r.column_name);
  }
  const consByTable = new Map();
  for (const r of rows(consRes)) {
    const t = String(r.table_name).replace(/^public\./, '');
    if (!consByTable.has(t)) consByTable.set(t, []);
    consByTable.get(t).push(r);
  }
  const idxByTable = new Map();
  for (const r of rows(idxRes)) {
    if (!idxByTable.has(r.table_name)) idxByTable.set(r.table_name, new Set());
    idxByTable.get(r.table_name).add(r.indexname);
  }
  const trigByTable = new Map();
  for (const r of rows(trigRes)) {
    if (!trigByTable.has(r.table_name)) trigByTable.set(r.table_name, new Set());
    trigByTable.get(r.table_name).add(r.trigger_name);
  }
  const polByTable = new Map();
  for (const r of rows(polRes)) {
    if (!polByTable.has(r.table_name)) polByTable.set(r.table_name, new Set());
    polByTable.get(r.table_name).add(r.policyname);
  }

  for (const [table, spec] of Object.entries(EXPECTED.tables)) {
    console.log(`\n■ ${table}`);
    if (!tables.has(table)) {
      fail('table does not exist');
      continue;
    }
    ok('table exists');

    if (tables.get(table).rls_enabled) ok('RLS enabled');
    else fail('RLS is NOT enabled');

    const actualCols = colsByTable.get(table) || new Set();
    const missingCols = spec.columns.filter((c) => !actualCols.has(c));
    if (missingCols.length === 0) ok(`all ${spec.columns.length} columns present`);
    else fail(`missing columns: ${missingCols.join(', ')}`);

    const cons = consByTable.get(table) || [];
    const pk = cons.find((c) => c.contype === 'p');
    if (pk) ok(`primary key: ${pk.conname}`);
    else fail('primary key missing');

    for (const u of spec.uniques) {
      if (cons.some((c) => c.conname === u)) ok(`unique constraint: ${u}`);
      else fail(`unique constraint missing: ${u}`);
    }

    for (const fk of spec.fks) {
      const found = cons.find(
        (c) =>
          c.contype === 'f' &&
          c.def.includes(`(${fk.column})`) &&
          c.def.toLowerCase().includes(fk.ref.split('.').pop()) &&
          c.def.toUpperCase().replace(/\s+/g, ' ').includes(`ON DELETE ${fk.on_delete}`)
      );
      if (found) ok(`FK ${fk.column} → ${fk.ref} ON DELETE ${fk.on_delete}`);
      else fail(`FK missing or wrong: ${fk.column} → ${fk.ref} ON DELETE ${fk.on_delete}`);
    }

    const idxs = idxByTable.get(table) || new Set();
    for (const i of spec.indexes) {
      if (idxs.has(i)) ok(`index: ${i}`);
      else fail(`index missing: ${i}`);
    }

    const trigs = trigByTable.get(table) || new Set();
    for (const t of spec.triggers) {
      if (trigs.has(t)) ok(`trigger: ${t}`);
      else fail(`trigger missing: ${t}`);
    }

    const pols = polByTable.get(table) || new Set();
    for (const p of spec.policies) {
      if (pols.has(p)) ok(`policy: "${p}"`);
      else fail(`policy missing: "${p}"`);
    }
    if (spec.policies.length > 0 && pols.size < spec.policies.length) {
      fail(`expected ${spec.policies.length} policies, found ${pols.size}`);
    }
  }

  console.log(`\n${failures === 0 ? 'ALL SCHEMA CHECKS PASSED' : failures + ' SCHEMA CHECK(S) FAILED'}\n`);
  return failures;
}

async function main() {
  const access = resolveSqlAccess();
  const failures = await runVerify(access);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv[1] && process.argv[1].endsWith('verify_schema.mjs')) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}