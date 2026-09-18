/**
 * AURA Dashboard — Phase 3 shared helpers.
 *
 * SOURCE (Supabase, strictly read-only):
 *   SUPABASE_DB_URL is read from the gitignored db/.env.local.
 *   Supabase's direct DB host (db.<ref>.supabase.co) is IPv6-ONLY and is
 *   unreachable from machines without global IPv6. When the URL points at that
 *   host we automatically re-target it to Supabase's IPv4 Supavisor pooler.
 *   The region is NOT guessed: it is resolved from the direct host's IPv6
 *   address using AWS's official ip-ranges.json, then verified by a real
 *   connection.
 *
 * Every source session runs with default_transaction_read_only = on, so the
 * server itself rejects any write.
 */
import fs from 'node:fs';
import dns from 'node:dns/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  DB_DIR, ROOT, loadEnvLocal, superuserConfig, appConfig, appDatabase,
} from './_lib.mjs';

export const require_ = createRequire(path.join(ROOT, 'aura-backend', 'package.json'));
export const PG_BIN = 'C:/Program Files/PostgreSQL/18/bin';
export const AUDIT_DIR = path.join(DB_DIR, 'audit');
export const DUMP_DIR = path.join(AUDIT_DIR, 'phase3_dumps');

/** FK-safe load order (parents first). */
export const FK_ORDER = [
  'aura_users', 'prop_firms', 'profiles', 'accounts', 'user_settings', 'trades',
  'ai_analyses', 'ai_conversations', 'ai_messages', 'ai_memories', 'ai_insights',
  'behaviors', 'behavior_evidence', 'behavior_alerts', 'behavior_config',
  'trading_rules', 'trading_briefs', 'certificates', 'payouts',
  'roi_transactions', 'trade_screenshots',
];

/** Tables with data in Supabase (aura_users is synthesised from auth.users). */
export const SUPABASE_TABLES = FK_ORDER.filter(t => t !== 'aura_users');

/** Phase 1 audit baseline (row counts). */
export const EXPECTED_COUNTS = {
  prop_firms: 7, profiles: 12, accounts: 53, user_settings: 12, trades: 2057,
  ai_analyses: 921, ai_conversations: 3, ai_messages: 33, ai_memories: 0,
  ai_insights: 0, behaviors: 91, behavior_evidence: 950, behavior_alerts: 0,
  behavior_config: 0, trading_rules: 0, trading_briefs: 0, certificates: 4,
  payouts: 0, roi_transactions: 27, trade_screenshots: 203,
};

export function supabaseUrl() {
  loadEnvLocal();
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('SUPABASE_DB_URL not set (expected in gitignored db/.env.local).');
  return url;
}

export function projectRef(url) {
  const u = new URL(url);
  const m = u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)
    || u.username.match(/^postgres\.([a-z0-9]+)$/i)
    || u.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i);
  if (!m) throw new Error('Cannot determine Supabase project ref from SUPABASE_DB_URL.');
  return m[1];
}

function ipv6ToBigInt(a) {
  const parts = a.split(':');
  const full = [];
  const empty = parts.indexOf('');
  if (empty !== -1) {
    const head = parts.slice(0, empty);
    const tail = parts.slice(empty + 1).filter(Boolean);
    while (head.length + tail.length < 8) head.push('0');
    full.push(...head, ...tail);
  } else full.push(...parts);
  let n = 0n;
  for (const h of full) n = (n << 16n) + BigInt(parseInt(h || '0', 16));
  return n;
}

async function discoverRegion(hostname) {
  const addrs = await dns.resolve6(hostname).catch(() => []);
  if (!addrs.length) throw new Error('Cannot resolve IPv6 address for ' + hostname);
  const target = ipv6ToBigInt(addrs[0]);
  const ranges = await (await fetch('https://ip-ranges.amazonaws.com/ip-ranges.json')).json();
  const hit = (ranges.ipv6_prefixes || []).filter(p => {
    const [net, bits] = p.ipv6_prefix.split('/');
    const shift = 128n - BigInt(bits);
    return (ipv6ToBigInt(net) >> shift) === (target >> shift);
  });
  const regions = [...new Set(hit.map(h => h.region))];
  if (!regions.length) throw new Error('Could not map the database IPv6 range to an AWS region.');
  return regions[0];
}
/**
 * Resolve a working IPv4 session-pooler endpoint for the project.
 * The endpoint is verified by an actual read-only connection.
 */
export async function resolveSource({ verify = true } = {}) {
  const url = supabaseUrl();
  const u = new URL(url);
  const ref = projectRef(url);
  const password = decodeURIComponent(u.password);
  const database = u.pathname.replace(/^\//, '') || 'postgres';

  if (/pooler\.supabase\.com$/i.test(u.hostname)) {
    return { host: u.hostname, port: Number(u.port || 5432), user: u.username,
      password, database, ref, via: 'pooler (as provided in SUPABASE_DB_URL)' };
  }

  const region = await discoverRegion(u.hostname);
  const candidates = [`aws-0-${region}.pooler.supabase.com`, `aws-1-${region}.pooler.supabase.com`];
  const { Client } = require_('pg');

  if (!verify) {
    return { host: candidates[0], port: 5432, user: `postgres.${ref}`, password,
      database, ref, region, via: 'pooler aws-0 (unverified)' };
  }

  for (const host of candidates) {
    const c = new Client({
      host, port: 5432, user: `postgres.${ref}`, password, database,
      ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
      application_name: 'aura-phase3-resolve',
    });
    try {
      await c.connect();
      await c.query('set default_transaction_read_only = on');
      await c.end();
      return { host, port: 5432, user: `postgres.${ref}`, password, database,
        ref, region, via: 'pooler (verified, IPv4)' };
    } catch { await c.end().catch(() => {}); }
  }
  throw new Error(
    'Could not reach the Supavisor pooler. Provide the Session-pooler connection ' +
    'string from Supabase (Connect -> Session pooler) as SUPABASE_DB_URL.',
  );
}

/** Open a READ-ONLY source connection. */
export async function connectSourceReadOnly(src) {
  const { Client } = require_('pg');
  const client = new Client({
    host: src.host, port: src.port, user: src.user, password: src.password,
    database: src.database, ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000, statement_timeout: 900000,
    application_name: 'aura-phase3-readonly',
  });
  await client.connect();
  await client.query('set default_transaction_read_only = on');
  return client;
}

/** pg_dump/psql environment for the SOURCE (the URL/password is never printed). */
export function sourcePgEnv(src) {
  return {
    ...process.env,
    PGHOST: src.host, PGPORT: String(src.port), PGUSER: src.user,
    PGPASSWORD: src.password, PGDATABASE: src.database,
    PGSSLMODE: 'require',
    PGOPTIONS: '-c default_transaction_read_only=on',
  };
}

/** Local (target) connection settings, reused by every Phase 3 step. */
export function localConfigs() {
  loadEnvLocal();
  return {
    superuser: superuserConfig({ database: appDatabase() }),
    app: appConfig(),
    database: appDatabase(),
  };
}

/** Column list per table, taken from the LOCAL schema. */
export async function localColumns(client) {
  const res = await client.query(
    `select table_name, column_name from information_schema.columns
      where table_schema='public' order by table_name, ordinal_position`);
  const map = new Map();
  for (const r of res.rows) {
    if (!map.has(r.table_name)) map.set(r.table_name, []);
    map.get(r.table_name).push(r.column_name);
  }
  return map;
}

/** Column list per table, taken from the SUPABASE source. */
export async function supabaseColumns(client) {
  const res = await client.query(
    `select table_name, column_name from information_schema.columns
      where table_schema='public' and table_name = any($1)
      order by table_name, ordinal_position`,
    [SUPABASE_TABLES]);
  const map = new Map();
  for (const r of res.rows) {
    if (!map.has(r.table_name)) map.set(r.table_name, []);
    map.get(r.table_name).push(r.column_name);
  }
  return map;
}
