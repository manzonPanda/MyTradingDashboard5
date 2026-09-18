#!/usr/bin/env node
/**
 * AURA Dashboard — PHASE 3 step 2: export (pg_dump) + import (psql).
 *
 * FIDELITY: uses PostgreSQL 18's own pg_dump/psql over the IPv4 Supavisor
 * session pooler, so data crosses as COPY text — no JSON/float round-trip.
 * numeric, timestamps (µs), JSONB, UUIDs, booleans, NULLs and text are
 * preserved byte-for-byte.
 *
 * SAFETY
 *   - Supabase is READ-ONLY: every source connection sets
 *     default_transaction_read_only = on (pg_dump inherits it via PGOPTIONS).
 *   - Refuses to run if the local database already holds application rows.
 *   - aura_users is populated by an explicit 4-column projection of auth.users
 *     (never a blind import of auth.*).
 *   - ai_memories has 0 source rows and is skipped, so the source-only
 *     `embedding vector(1536)` column is never referenced locally.
 *
 * Output: db/audit/phase3_dumps/<table>.sql + db/audit/phase3_manifest.json
 * Usage : node db/phase3_migrate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  resolveSource, connectSourceReadOnly, SUPABASE_TABLES, EXPECTED_COUNTS,
  AUDIT_DIR, DUMP_DIR, PG_BIN, localConfigs, sourcePgEnv,
} from './_source.mjs';
import { connectOrExplain, targetLabel, quoteIdent } from './_lib.mjs';

const sha256 = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** Environment for local psql/pg_dump (never inherits the source SSL settings). */
function localPgEnv(cfg) {
  return {
    ...process.env,
    PGHOST: cfg.host, PGPORT: String(cfg.port), PGUSER: cfg.user,
    PGPASSWORD: cfg.password || '', PGDATABASE: cfg.database,
    PGSSLMODE: 'disable',
    PGOPTIONS: '',
  };
}

function run(cmd, args, env, label) {
  const r = spawnSync(cmd, args, { env, encoding: 'utf8' });
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  if (r.status !== 0) {
    const err = (r.stderr || '').trim().split('\n').slice(0, 6).join('\n');
    throw new Error(`${label}: exit ${r.status}\n${err}`);
  }
  return r;
}

/** pg_dump one table's data from the read-only source. */
function dumpTable(src, table, file) {
  run(path.join(PG_BIN, 'pg_dump.exe'), [
    '--data-only', '--no-owner', '--no-privileges', '--no-comments',
    '--table', `public.${table}`, '--file', file,
  ], sourcePgEnv(src), `pg_dump ${table}`);
}

/** psql-load one dump into the local database. */
function loadTable(cfg, file, table) {
  run(path.join(PG_BIN, 'psql.exe'), [
    '-v', 'ON_ERROR_STOP=1', '-q', '--no-psqlrc', '-f', file,
  ], localPgEnv(cfg), `psql ${table}`);
}

// ---------------------------------------------------------------------------
// Internal logger: this script spawns pg_dump/psql child processes, which can
// defeat the terminal's output capture. Mirror every line to a log file.
// ---------------------------------------------------------------------------
fs.mkdirSync(AUDIT_DIR, { recursive: true });
const LOG_FILE = path.join(AUDIT_DIR, 'phase3_migrate.log');
fs.writeFileSync(LOG_FILE, '');
{
  const origLog = console.log, origErr = console.error;
  const write = (s) => { try { fs.appendFileSync(LOG_FILE, s + '\n'); } catch { /* ignore */ } };
  console.log = (...a) => { const s = a.join(' '); write(s); origLog(s); };
  console.error = (...a) => { const s = a.join(' '); write(s); origErr(s); };
}

async function main() {
  const src = await resolveSource();
  console.log(`[migrate] source: ${src.host}:${src.port}/${src.database} (${src.via})`);
  const { superuser: su, app, database } = localConfigs();
  console.log(`[migrate] target: ${targetLabel(su)}`);

  fs.mkdirSync(DUMP_DIR, { recursive: true });

  const suDb = await connectOrExplain(su, 'superuser (guard + import)');
  const srcDb = await connectSourceReadOnly(src);

  const manifest = {
    startedAt: new Date().toISOString(),
    source: { host: src.host, port: src.port, database: src.database,
      projectRef: src.ref, region: src.region || null, mechanism: src.via, readOnly: true },
    target: targetLabel(su),
    steps: {}, dumps: {}, discrepancies: [],
  };

  try {
    const ro = (await srcDb.query('show transaction_read_only')).rows[0].transaction_read_only;
    if (ro !== 'on') throw new Error('source session is not read-only — aborting');
    console.log(`[migrate] source read-only enforced: ${ro}`);

    // ---- guard: local must be empty --------------------------------------
    const occupied = [];
    for (const t of SUPABASE_TABLES.concat('aura_users')) {
      const c = await suDb.query(`select count(*)::int as n from public.${quoteIdent(t)}`);
      if (c.rows[0].n > 0) occupied.push(`${t}=${c.rows[0].n}`);
    }
    if (occupied.length) {
      console.error(`[migrate] ABORT: local database is not empty -> ${occupied.join(', ')}`);
      process.exit(2);
    }
    console.log('[migrate] guard passed: local database is empty');

    // ---- step 1: auth.users -> aura_users (explicit 4-column projection) --
    console.log('\n[migrate] === Step 1: auth.users -> aura_users ===');
    const users = (await srcDb.query(
      `select id::text as id, email, created_at, updated_at
         from auth.users order by created_at, id`)).rows;
    console.log(`[migrate]   auth.users rows: ${users.length}`);
    let uIns = 0;
    for (const u of users) {
      await suDb.query(
        `insert into public.aura_users (id, email, created_at, updated_at)
         values ($1,$2,$3,$4)`,
        [u.id, u.email, u.created_at, u.updated_at || u.created_at]);
      uIns++;
    }
    manifest.steps.aura_users = {
      sourceRows: users.length, inserted: uIns,
      projection: ['id', 'email', 'created_at', 'updated_at'],
      note: 'explicit projection; other auth.* metadata intentionally not migrated',
    };
    console.log(`[migrate]   inserted ${uIns} rows into aura_users`);

    // ---- step 2: pg_dump (source) -> psql (local) in FK order ------------
    console.log('\n[migrate] === Step 2: pg_dump (source) -> psql (local), FK order ===');
    for (const t of SUPABASE_TABLES) {
      const expected = EXPECTED_COUNTS[t] ?? 0;
      const srcCount = Number((await srcDb.query(
        `select count(*)::bigint as n from public.${quoteIdent(t)}`)).rows[0].n);

      if (srcCount === 0) {
        manifest.steps[t] = { sourceRows: 0, imported: 0, skipped: 'zero rows in source' };
        console.log(`  ${t.padEnd(20)} 0 rows - skipped (nothing to copy)`);
        continue;
      }
      if (expected !== srcCount) {
        manifest.discrepancies.push(`${t}: source ${srcCount} != phase-1 baseline ${expected}`);
      }

      const file = path.join(DUMP_DIR, `${t}.sql`);
      dumpTable(src, t, file);
      loadTable(su, file, t);
      const localCount = Number((await suDb.query(
        `select count(*)::bigint as n from public.${quoteIdent(t)}`)).rows[0].n);

      manifest.dumps[t] = {
        file: `db/audit/phase3_dumps/${t}.sql`,
        bytes: fs.statSync(file).size, sha256: sha256(file),
      };
      manifest.steps[t] = {
        sourceRows: srcCount, imported: localCount, baseline: expected,
        match: srcCount === localCount,
      };

      const ok = srcCount === localCount;
      if (!ok) manifest.discrepancies.push(`${t}: dumped ${srcCount}, imported ${localCount}`);
      console.log(`  ${t.padEnd(20)} source=${String(srcCount).padStart(5)} ` +
        `imported=${String(localCount).padStart(5)} ${ok ? 'ok' : 'MISMATCH'}`);
    }

    manifest.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(AUDIT_DIR, 'phase3_manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log('\n[migrate] manifest written: db/audit/phase3_manifest.json');
    console.log(`[migrate] discrepancies: ${manifest.discrepancies.length}`);
    for (const d of manifest.discrepancies) console.log('   - ' + d);
    if (manifest.discrepancies.length) process.exitCode = 1;
    else console.log('[migrate] DONE - every table matches the source row count.');
  } finally {
    await srcDb.end().catch(() => {});
    await suDb.end().catch(() => {});
    void app; void database;
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
// end of file