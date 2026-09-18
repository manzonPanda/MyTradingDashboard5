#!/usr/bin/env node
/**
 * AURA Dashboard — PHASE 2 step 2
 * Apply the versioned schema in db/schema/ to the local database (idempotent).
 *
 * Every file is written to be re-runnable:
 *   create table if not exists / create index if not exists / create or replace
 *   function / drop trigger if exists + create trigger / grant + revoke.
 * Existing tables are never DROPPED or ALTERED — the pre-scan only REPORTS
 * which expected tables already exist.
 *
 * SAFETY
 *   - Local hosts only (127.0.0.1 / localhost / ::1); remote use is refused.
 *   - Requires PostgreSQL >= 13 (gen_random_uuid is built in; PG 18 expected).
 *   - --dry-run prints the apply order without touching the database.
 *   - Stops at the first failing file with the exact Postgres error.
 *   - Never prints credentials.
 *
 * Usage:  node db/apply_schema.mjs [--dry-run]
 */
import {
  APPLY_ORDER, loadEnvLocal, superuserConfig, appDatabase,
  readSql, connectOrExplain, targetLabel,
} from './_lib.mjs';
import { EXPECTED } from './_expected.mjs';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];
const dryRun = process.argv.includes('--dry-run');
const tableNames = Object.keys(EXPECTED);

async function main() {
  const envFileLoaded = loadEnvLocal();
  const database = appDatabase();
  const cfg = superuserConfig({ database });

  console.log('[apply] AURA Dashboard Phase 2 — local schema apply');
  console.log(`[apply] target  : ${targetLabel(cfg)}`);
  console.log(`[apply] env file: db/.env.local ${envFileLoaded ? 'loaded' : 'not present (using process environment)'}`);
  console.log(`[apply] files   : ${APPLY_ORDER.length} (${dryRun ? 'DRY RUN' : 'live run'})`);
  console.log('');

  if (dryRun) {
    for (const f of APPLY_ORDER) console.log(`  ${f}`);
    console.log('');
    console.log('[apply] dry run: nothing executed.');
    return;
  }

  if (!LOCAL_HOSTS.includes(cfg.host)) {
    console.error(`[apply] REFUSING to run against non-local host "${cfg.host}". Phase 2 targets the local PostgreSQL only.`);
    process.exit(1);
  }

  const client = await connectOrExplain(cfg, 'schema owner/superuser');
  try {
    const ver = await client.query('show server_version');
    const major = Number(String(ver.rows[0].server_version).split('.')[0]);
    console.log(`[apply] connected. server_version=${ver.rows[0].server_version}`);
    if (major < 13) {
      console.error('[apply] FATAL: PostgreSQL >= 13 is required (gen_random_uuid is built in).');
      process.exit(1);
    }

    // Pre-scan: report (never modify) tables that already exist.
    const pre = await client.query(
      `select t as table_name, to_regclass('public.' || t) is not null as exists
         from unnest($1::text[]) as t order by t`, [tableNames]);
    const preExisting = pre.rows.filter((r) => r.exists).map((r) => r.table_name);
    console.log(`[apply] pre-scan: ${preExisting.length} of ${tableNames.length} expected tables already exist.`);
    if (preExisting.length) {
      console.log(`[apply] already present (left untouched): ${preExisting.join(', ')}`);
    }
    console.log('');

    for (const file of APPLY_ORDER) {
      const sql = readSql(file);
      const started = Date.now();
      process.stdout.write(`[apply] ${file} ... `);
      try {
        await client.query(sql);
        console.log(`OK (${Date.now() - started} ms)`);
      } catch (err) {
        console.log('FAILED');
        console.error('');
        console.error(`[apply] Failed on: ${file}`);
        console.error(`[apply] Postgres error: ${err.message}`);
        if (err.code) console.error(`[apply] SQLSTATE: ${err.code}`);
        if (err.position) console.error(`[apply] position: ${err.position}`);
        console.error('[apply] Stopped. Every file is idempotent, so a fixed re-run is safe.');
        process.exitCode = 1;
        return;
      }
    }

    const post = await client.query(
      `select t as table_name, to_regclass('public.' || t) is not null as exists
         from unnest($1::text[]) as t order by t`, [tableNames]);
    const missing = post.rows.filter((r) => !r.exists).map((r) => r.table_name);
    console.log('');
    if (missing.length) {
      console.error(`[apply] ${missing.length} expected table(s) still missing: ${missing.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    console.log(`[apply] all ${tableNames.length} expected tables are present.`);
    console.log('[apply] done. Next step: node db/verify_schema.mjs');
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});