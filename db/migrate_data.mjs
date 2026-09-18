#!/usr/bin/env node
/**
 * AURA Dashboard — PHASE 3 data migration
 *
 * Migrates data from the existing live Supabase project into the local
 * PostgreSQL 18 database (aura_dashboard), WITHOUT modifying Supabase.
 *
 * Source: Supabase PostgREST API (service_role key, read-only) + Auth Admin API
 * Target: local PostgreSQL 18 @ 127.0.0.1:5432/aura_dashboard as role aura_app
 *
 * SAFETY:
 *   - Supabase is READ-ONLY. No inserts/updates/deletes/truncates.
 *   - Local PG writes via aura_app (least-privilege).
 *   - FK dependency order. UUIDs/timestamps/JSONB preserved exactly.
 *   - Idempotent: re-running skips tables that already have data.
 *   - Manifest at db/migration_manifest.json records rows exported/imported.
 *
 * Prerequisites (db/.env.local):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   AURA_APP_DB, AURA_APP_USER, AURA_APP_PASSWORD
 *
 * Usage: node db/migrate_data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  loadEnvLocal, appConfig, connectOrExplain, targetLabel,
} from './_lib.mjs';

const require = createRequire('../aura-backend/package.json');
const { Client } = require('pg');

// FK dependency order (parent -> child)
const TABLE_ORDER = [
  'prop_firms', 'aura_users', 'profiles', 'accounts', 'user_settings', 'trades',
  'ai_analyses', 'ai_conversations', 'ai_messages', 'ai_memories', 'ai_insights',
  'behaviors', 'behavior_evidence', 'behavior_alerts', 'behavior_config',
  'trading_rules', 'trading_briefs', 'certificates', 'payouts',
  'roi_transactions', 'trade_screenshots',
];

// Expected baseline row counts (from Phase 1 audit)
const EXPECTED_COUNTS = {
  prop_firms: 7, profiles: 12, accounts: 53, user_settings: 12,
  trades: 2057, ai_analyses: 921, ai_conversations: 3, ai_messages: 33,
  ai_memories: 0, ai_insights: 0, behaviors: 91, behavior_evidence: 950,
  behavior_alerts: 0, behavior_config: 0, trading_rules: 0, trading_briefs: 0,
  certificates: 4, payouts: 0, roi_transactions: 27, trade_screenshots: 203,
};

// Explicit column lists matching the LIVE Supabase schema exactly.
// (Verified via PostgREST sample rows + column probe on 2026-09-18.)
// For empty tables, the column list is taken from the local schema
// (0 rows means no data to mismatch, but the INSERT must use local columns).
const TABLE_COLUMNS = {
  prop_firms: ['id', 'name', 'logo_url', 'website_url', 'created_at'],
  profiles: ['id', 'display_name', 'avatar_url', 'started_trading_date', 'created_at', 'updated_at'],
  accounts: ['id', 'name', 'account_number', 'initial_balance', 'profit_target_percent',
    'max_total_drawdown_percent', 'daily_loss_limit_percent', 'start_date', 'status', 'notes',
    'created_at', 'updated_at', 'user_id', 'phase', 'prop_firm_id', 'platform',
    'drawdown_mode', 'drawdown_basis', 'drawdown_stop_at_initial_balance', 'drawdown_eod_timezone'],
  user_settings: ['user_id', 'daily_target_percent', 'weekly_r_target', 'default_chart_mode',
    'trading_day_reset_time', 'default_account_id', 'show_account_balance', 'show_pnl',
    'show_trading_activity', 'show_news_calendar', 'aura_enabled', 'aura_travel_duration_ms',
    'aura_min_delay_ms', 'aura_max_delay_ms', 'aura_trail_length_percent', 'aura_stroke_width',
    'aura_head_radius', 'aura_bloom_intensity', 'aura_fade_duration_ms', 'aura_color_start',
    'aura_color_mid', 'aura_color_peak', 'aura_color_head', 'aura_min_targets', 'aura_max_targets',
    'notifications_enabled', 'daily_goal_notification', 'goal_notification_sound',
    'notification_volume', 'live_trade_sound_threshold', 'live_trade_high_priority_sound_threshold',
    'positive_gauge_percent_max', 'per_trade_gauge_auto_close_enabled',
    'created_at', 'updated_at'],
  trades: ['id', 'buy_sell', 'commission', 'daily_reflection', 'time_open', 'time_close',
    'instrument', 'lots', 'pips', 'pnl', 'rules_violated', 'weekly_retrospective', 'mfe',
    'price_close', 'price_open', 'risk_per_trade', 'rrr', 'sl', 'swap', 'ticket', 'tp',
    'created_at', 'updated_at', 'held', 'account_id', 'mae', 'time_open_ph', 'time_close_ph'],
  ai_analyses: ['id', 'user_id', 'account_id', 'trigger', 'trade_id', 'status', 'attempts',
    'max_attempts', 'last_error', 'model', 'prompt_version', 'input_summary', 'raw_response',
    'started_at', 'finished_at', 'created_at', 'updated_at'],
  ai_conversations: ['id', 'user_id', 'title', 'summary', 'created_at', 'updated_at'],
  ai_messages: ['id', 'conversation_id', 'user_id', 'role', 'content', 'tool_calls',
    'tool_name', 'token_count', 'created_at'],
  // ai_memories: 0 rows in Supabase. Local schema uses 'content' (not 'memory').
  // Export uses select=* on 0 rows → safe. Import uses local columns.
  ai_memories: ['id', 'user_id', 'memory_type', 'content', 'importance', 'source',
    'created_at', 'updated_at'],
  ai_insights: ['id', 'user_id', 'insight_type', 'title', 'content', 'severity',
    'related_data', 'created_at'],
  behaviors: ['id', 'user_id', 'account_id', 'name', 'name_key', 'behavior_type', 'description',
    'status', 'occurrence_count', 'confidence', 'estimated_impact_pnl', 'estimated_impact_r',
    'first_detected_at', 'last_detected_at', 'last_confirmed_at', 'model', 'created_at', 'updated_at'],
  behavior_evidence: ['id', 'user_id', 'account_id', 'behavior_id', 'analysis_id', 'trade_id',
    'trade_ticket', 'trade_time_open', 'week_start', 'reflection_excerpt', 'reason',
    'metrics_snapshot', 'evidence_confidence', 'created_at'],
  behavior_alerts: ['id', 'account_id', 'alert_type', 'severity', 'status', 'message',
    'dedupe_key', 'created_at'],
  behavior_config: ['id', 'account_id', 'thresholds', 'updated_at', 'created_at'],
  trading_rules: ['id', 'account_id', 'rule', 'status', 'source_behavior_id', 'created_at', 'updated_at'],
  trading_briefs: ['id', 'account_id', 'week_start', 'payload', 'created_at', 'updated_at'],
  certificates: ['id', 'user_id', 'program_name', 'passed_date', 'status', 'file_path',
    'notes', 'created_at', 'account_id'],
  payouts: ['id', 'certificate_id', 'user_id', 'amount', 'proof_url', 'created_at'],
  roi_transactions: ['id', 'transaction_date', 'transaction_type', 'amount', 'note', 'image_url',
    'account_id', 'updated_at', 'user_id', 'created_at'],
  trade_screenshots: ['id', 'ticket', 'symbol', 'storage_path', 'captured_at', 'created_at'],
};

// Tables to export from Supabase (all except aura_users which comes from auth.users)
const SUPABASE_TABLES = TABLE_ORDER.filter(t => t !== 'aura_users');

async function exportFromSupabase(supabaseUrl, supabaseKey, table, columns) {
  const selectCols = columns.join(',');
  const allRows = [];
  const batchSize = 1000;
  let offset = 0;
  while (true) {
    const url = `${supabaseUrl}/rest/v1/${table}?select=${selectCols}&offset=${offset}&limit=${batchSize}`;
    const res = await fetch(url, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Accept': 'application/json' },
    });
    if (!res.ok) { const body = await res.text(); throw new Error(`Export ${table}: HTTP ${res.status} — ${body}`); }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    allRows.push(...rows); offset += batchSize;
    if (rows.length < batchSize) break;
  }
  return allRows;
}

async function importTable(pg, table, columns, rows) {
  if (rows.length === 0) return 0;
  const colList = columns.map(c => `"${c}"`).join(',');
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(',');
  const sql = `INSERT INTO public.${table} (${colList}) VALUES (${placeholders})`;
  let imported = 0;
  for (const row of rows) {
    const values = columns.map(c => { const v = row[c]; return v === undefined || v === null ? null : v; });
    await pg.query(sql, values);
    imported++;
  }
  return imported;
}

async function exportAuthUsers(supabaseUrl, supabaseKey) {
  const url = `${supabaseUrl}/auth/v1/admin/users?per_page=1000`;
  const res = await fetch(url, { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } });
  if (!res.ok) { const body = await res.text(); throw new Error(`Auth Admin API: HTTP ${res.status} — ${body}`); }
  const data = await res.json();
  return data.users || [];
}

async function countTable(pg, table) {
  const res = await pg.query(`SELECT count(*)::int as n FROM public.${table}`);
    return Number(res.rows[0].n);
}

async function main() {
  console.log('[migrate] AURA Dashboard Phase 3 — Supabase → Local PostgreSQL');
  const envFileLoaded = loadEnvLocal();
  console.log(`[migrate] db/.env.local loaded: ${envFileLoaded ? 'yes' : 'no (using process environment)'}`);

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('[migrate] FATAL: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found');
    process.exit(1);
  }

  const pgCfg = appConfig();
  console.log(`[migrate] target: ${targetLabel(pgCfg)}`);
  const pg = await connectOrExplain(pgCfg, 'application role (data import)');
  const manifest = { createdAt: new Date().toISOString(), source: 'Supabase (read-only)', target: targetLabel(pgCfg), exported: {}, imported: {}, discrepancies: [] };

  try {
    // Step 1: auth.users → aura_users
    console.log('\n[migrate] === Step 1: auth.users → aura_users ===');
    const existingUsers = await countTable(pg, 'aura_users');
    if (existingUsers > 0) {
      console.log(`[migrate]   aura_users already has ${existingUsers} rows — skipping`);
      manifest.imported['aura_users'] = existingUsers;
    } else {
      const users = await exportAuthUsers(supabaseUrl, supabaseKey);
      console.log(`[migrate]   auth.users: ${users.length} rows`);
      let imported = 0;
      for (const u of users) {
        await pg.query('INSERT INTO public.aura_users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $4)',
          [u.id, u.email || null, u.created_at, u.updated_at || u.created_at]);
        imported++;
      }
      console.log(`[migrate]   imported ${imported} users`);
      manifest.exported['aura_users'] = users.length;
      manifest.imported['aura_users'] = imported;
    }

    // Step 2: Application tables (FK order)
    console.log('\n[migrate] === Step 2: Application tables ===');
    for (const table of SUPABASE_TABLES) {
      const cols = TABLE_COLUMNS[table];
      if (!cols) { manifest.discrepancies.push(`No column definition for ${table}`); continue; }
      const existing = await countTable(pg, table);
      if (existing > 0) {
        console.log(`[migrate]   ${table}: ${existing} rows — skipping (idempotent)`);
        manifest.imported[table] = existing; continue;
      }
      console.log(`[migrate]   ${table}: exporting...`);
      const rows = await exportFromSupabase(supabaseUrl, supabaseKey, table, cols);
      console.log(`[migrate]   ${table}: ${rows.length} rows exported.`);
      const imported = await importTable(pg, table, cols, rows);
      console.log(`[migrate]   ${table}: ${imported} rows imported.`);
      manifest.exported[table] = rows.length;
      manifest.imported[table] = imported;
      if (rows.length !== imported) manifest.discrepancies.push(`${table}: exported ${rows.length}, imported ${imported}`);
    }

    // Step 3: Verify counts
    console.log('\n[migrate] === Step 3: Verify row counts ===');
    let allOk = true;
    for (const [table, expected] of Object.entries(EXPECTED_COUNTS)) {
      const actual = await countTable(pg, table);
      const ok = actual === expected;
      if (!ok) allOk = false;
      console.log(`  ${table}: ${actual} / ${expected} ${ok ? 'ok' : 'MISMATCH'}`);
      if (!ok) manifest.discrepancies.push(`${table}: expected ${expected}, got ${actual}`);
    }

    // Step 4: Save manifest
    fs.writeFileSync('db/migration_manifest.json', JSON.stringify(manifest, null, 2));
    console.log('\n[migrate] Manifest written to db/migration_manifest.json');
    if (manifest.discrepancies.length > 0) {
      console.error(`\n[migrate] ${manifest.discrepancies.length} DISCREPANCIES:`);
      for (const d of manifest.discrepancies) console.error(`  - ${d}`);
    }
    const totalImported = Object.values(manifest.imported).reduce((a, b) => a + b, 0);
    console.log(`\n[migrate] DONE. ${totalImported} total rows imported.`);
    if (!allOk) process.exitCode = 1;
  } finally {
    await pg.end().catch(() => {});
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });