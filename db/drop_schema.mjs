#!/usr/bin/env node
/**
 * Drop and re-apply the local PostgreSQL schema for aura_dashboard.
 * Uses the superuser to drop (aura_app cannot drop tables by design).
 * Only used when schema correction is needed and the DB is empty.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  loadEnvLocal, superuserConfig, appDatabase,
  connectOrExplain, targetLabel, readSql, APPLY_ORDER, quoteIdent,
} from './_lib.mjs';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];

/** Every application table — used by the non-empty safety guard. */
const APP_TABLES = [
  'aura_users', 'profiles', 'prop_firms', 'accounts', 'trades', 'user_settings',
  'certificates', 'payouts', 'roi_transactions', 'trade_screenshots',
  'ai_conversations', 'ai_messages', 'ai_memories', 'ai_insights', 'ai_analyses',
  'behaviors', 'behavior_evidence', 'behavior_alerts', 'behavior_config',
  'trading_rules', 'trading_briefs',
];

// Drop everything in dependency-safe order
const DROP_SQL = `
  drop table if exists public.trades cascade;
  drop table if exists public.ai_analyses cascade;
  drop table if exists public.behavior_evidence cascade;
  drop table if exists public.behaviors cascade;
  drop table if exists public.trading_rules cascade;
  drop table if exists public.behavior_alerts cascade;
  drop table if exists public.trading_briefs cascade;
  drop table if exists public.behavior_config cascade;
  drop table if exists public.ai_messages cascade;
  drop table if exists public.ai_conversations cascade;
  drop table if exists public.ai_memories cascade;
  drop table if exists public.ai_insights cascade;
  drop table if exists public.certificates cascade;
  drop table if exists public.payouts cascade;
  drop table if exists public.roi_transactions cascade;
  drop table if exists public.trade_screenshots cascade;
  drop table if exists public.user_settings cascade;
  drop table if exists public.accounts cascade;
  drop table if exists public.profiles cascade;
  drop table if exists public.aura_users cascade;
  drop table if exists public.prop_firms cascade;
  drop function if exists public.set_updated_at() cascade;
  drop function if exists public.handle_updated_at() cascade;
`;

async function main() {
  const envFileLoaded = loadEnvLocal();
  const database = appDatabase();
  const cfg = superuserConfig({ database });
  console.log(`[reset] db/.env.local loaded: ${envFileLoaded ? 'yes' : 'no'}`);
  console.log(`[reset] target: ${targetLabel(cfg)}`);

  if (!LOCAL_HOSTS.includes(cfg.host)) {
    console.error(`[reset] REFUSING non-local host: ${cfg.host}`);
    process.exit(1);
  }

  const client = await connectOrExplain(cfg, 'superuser (schema reset)');
  try {
    // SAFETY: refuse to drop anything if any application table still holds rows.
    let totalRows = 0;
    const nonEmpty = [];
    for (const t of APP_TABLES) {
      const exists = await client.query(
        `select 1 from information_schema.tables where table_schema='public' and table_name=$1`,
        [t],
      );
      if (exists.rowCount === 0) continue;
      const c = await client.query(`select count(*)::int as n from public.${quoteIdent(t)}`);
      if (c.rows[0].n > 0) { nonEmpty.push(`${t}=${c.rows[0].n}`); totalRows += c.rows[0].n; }
    }
    if (totalRows > 0) {
      console.error(`[reset] ABORT: ${totalRows} row(s) present -> ${nonEmpty.join(', ')}`);
      console.error('[reset] refusing to drop a non-empty database.');
      process.exit(2);
    }
    console.log('[reset] safety check passed: all application tables are empty.');

    console.log('[reset] dropping all tables...');
    await client.query(DROP_SQL);
    console.log('[reset] all tables and functions dropped.');

    console.log('[reset] re-applying schema...');
    for (const file of APPLY_ORDER) {
      const sql = readSql(file);
      await client.query(sql);
      console.log(`[reset]   ${file} ... OK`);
    }

    console.log('[reset] schema re-applied successfully.');
    console.log('[reset] run: node db/verify_schema.mjs to confirm');
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });

