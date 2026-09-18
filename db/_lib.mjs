/**
 * AURA Dashboard — Phase 2 local PostgreSQL tooling (shared helpers).
 *
 * SECURITY RULES (enforced by design):
 *   - Credentials are read from the process environment, or from the
 *     GITIGNORED db/.env.local file (loaded with dotenv). Nothing else.
 *   - Passwords are NEVER printed, logged, written to disk, or generated.
 *   - The scripts run only the versioned, idempotent SQL under db/schema/.
 *     They never DROP or ALTER existing user objects.
 *
 * Mirrors the conventions already used by supabase/_lib.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DB_DIR = __dirname;
export const ROOT = path.resolve(__dirname, '..');
export const SCHEMA_DIR = path.join(__dirname, 'schema');
export const BACKEND_DIR = path.join(ROOT, 'aura-backend');

export const APP_DB_DEFAULT = 'aura_dashboard';
export const APP_ROLE_DEFAULT = 'aura_app';
export const SUPERUSER_DEFAULT = 'postgres';

/** Versioned apply order — must mirror db/README.md exactly. */
export const APPLY_ORDER = [
  '00_functions.sql',
  '01_aura_users.sql',
  '02_prop_firms.sql',
  '03_accounts.sql',
  '04_trades.sql',
  '05_user_settings.sql',
  '06_profiles.sql',
  '07_certificates.sql',
  '08_roi_transactions.sql',
  '09_trade_screenshots.sql',
  '10_ai_core.sql',
  '11_ai_analyses.sql',
  '12_behavior_engine.sql',
  '13_trading_rules_alerts.sql',
  '14_trading_briefs_config.sql',
  '15_grants.sql',
];

/**
 * Load db/.env.local if present. Existing process environment always wins
 * (dotenv does not overwrite already-set variables), so a shell override is
 * possible without editing the file.
 */
export function loadEnvLocal() {
  const file = path.join(DB_DIR, '.env.local');
  if (!fs.existsSync(file)) return false;
  const require = createRequire(path.join(BACKEND_DIR, 'package.json'));
  require('dotenv').config({ path: file });
  return true;
}

/** node-postgres (already installed in aura-backend). */
export function pgLib() {
  const require = createRequire(path.join(BACKEND_DIR, 'package.json'));
  return require('pg');
}

export function appDatabase() {
  return process.env.AURA_APP_DB || APP_DB_DEFAULT;
}

export function appRole() {
  return process.env.AURA_APP_USER || APP_ROLE_DEFAULT;
}

/** Escape a string as a SQL literal (used only for CREATE ROLE ... PASSWORD). */
export function quoteLiteral(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

/** Escape a SQL identifier. */
export function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function baseConfig() {
  return {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    application_name: 'aura-phase2-db-tooling',
    connectionTimeoutMillis: 10000,
    // TLS is not enabled on the local cluster; PGSSLMODE=require opt-in only.
    ssl: (process.env.PGSSLMODE || 'disable') === 'require' ? { rejectUnauthorized: false } : false,
  };
}

/**
 * Superuser config — used ONLY to create the role/database and apply DDL.
 * database: maintenance database (default 'postgres'); pass appDatabase() to
 * connect to the application database.
 */
export function superuserConfig({ database = null } = {}) {
  const cfg = {
    ...baseConfig(),
    user: process.env.AURA_PG_SUPERUSER || process.env.PGUSER || SUPERUSER_DEFAULT,
    database: database || process.env.PGMAINTENANCE_DB || 'postgres',
  };
  const pw = process.env.AURA_PG_SUPERUSER_PASSWORD || process.env.PGPASSWORD;
  if (pw) cfg.password = pw;
  return cfg;
}

/** Least-privilege application role config (used to prove its privileges). */
export function appConfig() {
  const cfg = { ...baseConfig(), user: appRole(), database: appDatabase() };
  const pw = process.env.AURA_APP_PASSWORD;
  if (pw) cfg.password = pw;
  return cfg;
}

export function targetLabel(cfg) {
  return `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`;
}

export function readSql(fileName) {
  return fs.readFileSync(path.join(SCHEMA_DIR, fileName), 'utf8');
}

/** Connect, or throw with exact remediation instructions (no secrets echoed). */
export async function connectOrExplain(cfg, roleLabel) {
  const { Client } = pgLib();
  const client = new Client(cfg);
  try {
    await client.connect();
    return client;
  } catch (err) {
    const reason = err?.code || err?.message || 'unknown error';
    const lines = [
      `Cannot connect to ${targetLabel(cfg)} (${roleLabel}).`,
      `PostgreSQL said: ${reason}`,
      '',
      'Provide credentials WITHOUT hard-coding them. Choose ONE:',
      '  1) copy db/.env.example to db/.env.local (gitignored) and fill in',
      '     AURA_PG_SUPERUSER_PASSWORD (superuser) and/or AURA_APP_PASSWORD',
      '     (the application role) — this avoids shell history entirely;',
      '  2) set the same variables in your shell before running the script;',
      '  3) create a standard pgpass file at',
      '     %APPDATA%\\postgresql\\pgpass.conf (libpq-compatible).',
      '',
      'Passwords are never generated, guessed, printed or stored by this tooling.',
    ];
    throw new Error(lines.join('\n'));
  }
}
