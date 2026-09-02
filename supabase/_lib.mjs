/**
 * Shared helpers for the Supabase Phase 2 migration + verification tooling.
 *
 * SECURITY RULES (enforced by design):
 *   - Credentials are read from environment variables ONLY
 *     (SUPABASE_DB_URL / DATABASE_URL or SUPABASE_ACCESS_TOKEN), with local
 *     .env files used as fallback for the non-secret REST config.
 *   - Secrets are NEVER printed, logged, or written anywhere by these scripts.
 *   - No destructive SQL: this tooling only runs the versioned, idempotent
 *     files already committed under supabase/ (create if not exists, drop
 *     policy if exists before create, create or replace function).
 *
 * Two authenticated SQL paths are supported (whichever is available):
 *   1. SUPABASE_ACCESS_TOKEN  -> Supabase Management API
 *      POST /v1/projects/{ref}/database/query
 *   2. SUPABASE_DB_URL / DATABASE_URL -> direct Postgres (pg driver already
 *      installed in aura-backend; no new dependencies).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SQL_DIR = __dirname;
export const ROOT = path.resolve(__dirname, '..');
export const BACKEND_DIR = path.join(ROOT, 'aura-backend');
export const FRONTEND_ENV = path.join(ROOT, 'trading-dashboard', 'src', 'environments', 'environment.ts');

/** Phase 2 apply order — mirrors supabase/README_APPLY_ORDER.md exactly. */
export const APPLY_ORDER = [
  'function_set_updated_at.sql',
  'table_ai_analyses.sql',
  'table_behaviors.sql',
  'table_behavior_evidence.sql',
  'table_trading_rules.sql',
  'table_behavior_alerts.sql',
  'table_trading_briefs.sql',
  'table_behavior_config.sql',
  'ai_analyses_rls.sql',
  'behavior_engine_rls.sql',
  'realtime_behavior_engine.sql',
];

export function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/** Non-secret REST config (URL + keys), env first, local .env fallback. */
export function supabaseRestConfig() {
  const fromEnv = {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const fromDotenv = parseEnvFile(path.join(BACKEND_DIR, '.env'));
  const url = (fromEnv.url || fromDotenv.SUPABASE_URL || '').replace(/\/+$/, '');
  const serviceKey = fromEnv.serviceKey || fromDotenv.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !serviceKey) {
    throw new Error('REST config unavailable: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not found.');
  }
  const ref = new URL(url).hostname.split('.')[0];
  return { url, serviceKey, ref };
}

/** Public (anon) key — read from the frontend environment file (publishable by design). */
export function anonKey() {
  if (process.env.SUPABASE_ANON_KEY) return process.env.SUPABASE_ANON_KEY;
  if (fs.existsSync(FRONTEND_ENV)) {
    const src = fs.readFileSync(FRONTEND_ENV, 'utf8');
    const m = src.match(/anonKey:\s*'([^']+)'/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Resolve which authenticated SQL path is available.
 * Throws with exact remediation instructions when neither exists.
 */
export function resolveSqlAccess() {
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (dbUrl) return { mode: 'db', conn: dbUrl };

  // Token may be provided as a process env var, or (user-approved, temporary)
  // inside the gitignored aura-backend/.env — loaded into memory only and
  // never printed, logged, or persisted anywhere by this tooling.
  const token = process.env.SUPABASE_ACCESS_TOKEN
    || parseEnvFile(path.join(BACKEND_DIR, '.env')).SUPABASE_ACCESS_TOKEN;
  if (token) {
    const { ref } = supabaseRestConfig();
    return { mode: 'token', token, ref };
  }

  throw new Error(
    [
      'No authenticated SQL access is available.',
      'Provide exactly ONE of the following as an environment variable (never in source files):',
      '  1. SUPABASE_DB_URL   — Supabase database connection string, e.g.',
      '     postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres',
      '     (Dashboard -> Project Settings -> Database -> Connection string)',
      '  2. SUPABASE_ACCESS_TOKEN — a Management API personal access token',
      '     (https://supabase.com/dashboard/account/tokens)',
      'Then run: node supabase/apply_migrations.mjs',
    ].join('\n')
  );
}

/**
 * Execute one SQL batch through the available authenticated path.
 * Returns structured result; never echoes credentials.
 */
export async function execSql(access, sql) {
  if (access.mode === 'db') return execSqlViaPg(access.conn, sql);
  return execSqlViaManagementApi(access, sql);
}

async function execSqlViaPg(conn, sql) {
  const require = createRequire(path.join(BACKEND_DIR, 'package.json'));
  const pg = require('pg');
  const client = new pg.Client({
    connectionString: conn,
    ssl: { rejectUnauthorized: false },
    application_name: 'phase2-migration-tooling',
  });
  await client.connect();
  try {
    const res = await client.query(sql);
    return { rowCount: res.rowCount ?? null, rows: res.rows ?? [] };
  } finally {
    await client.end().catch(() => {});
  }
}

async function execSqlViaManagementApi(access, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${access.ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 500);
    try {
      const j = JSON.parse(text);
      msg = j.message || j.error_description || j.error || msg;
    } catch { /* keep raw text */ }
    throw new Error(`Management API query failed (HTTP ${res.status}): ${msg}`);
  }
  let rows = null;
  try { rows = JSON.parse(text); } catch { /* non-JSON (e.g. empty) */ }
  return { rowCount: Array.isArray(rows) ? rows.length : null, rows: Array.isArray(rows) ? rows : [] };
}

export function readSqlFile(fileName) {
  return fs.readFileSync(path.join(SQL_DIR, fileName), 'utf8');
}