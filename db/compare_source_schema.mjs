#!/usr/bin/env node
/**
 * AURA Dashboard — Phase 3 schema parity check.
 *
 * Compares the LOCAL PostgreSQL schema (information_schema) against the
 * authoritative snapshot of the live Supabase schema captured read-only in
 * db/audit/supabase_schema_snapshot.json.
 *
 * This proves the local schema can reproduce the existing behaviour exactly,
 * independently of db/_expected.mjs (which is the Phase 2 verification contract).
 *
 * Documented, intentional deviations (see db/README.md):
 *   * aura_users has no Supabase counterpart (it replaces auth.users).
 *   * ai_memories.embedding / the HNSW index are intentionally NOT created
 *     locally. Every other column must match exactly.
 *
 * Usage: node db/compare_source_schema.mjs
 * Exits 0 when the only differences are the documented deviations.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvLocal, superuserConfig, appDatabase, connectOrExplain, targetLabel, DB_DIR } from './_lib.mjs';

const SNAPSHOT = path.join(DB_DIR, 'audit', 'supabase_schema_snapshot.json');

/** Columns intentionally not reproduced locally. */
const ALLOWED_MISSING = {
  ai_memories: ['embedding'],
};

function normSourceType(format, type) {
  const raw = String(format || type || '').trim();
  if (!raw) return 'unknown';
  return raw.replace(/^extensions\./, '').replace(/\(\d+\)$/, '').trim();
}

function normLocalType(row) {
  if (row.data_type === 'USER-DEFINED') return row.udt_name;
  if (row.data_type === 'ARRAY') return row.udt_name.replace(/^_/, '') + '[]';
  return row.data_type;
}

async function main() {
  if (!fs.existsSync(SNAPSHOT)) {
    console.error(`[parity] snapshot missing: ${path.relative(process.cwd(), SNAPSHOT)}`);
    console.error('[parity] generate it with the read-only OpenAPI probe first.');
    process.exit(1);
  }
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));

  loadEnvLocal();
  const cfg = superuserConfig({ database: appDatabase() });
  console.log(`[parity] local target: ${targetLabel(cfg)}`);
  console.log(`[parity] source snapshot: ${snapshot.host || '(unknown host)'} captured ${snapshot.capturedAt}`);
  const client = await connectOrExplain(cfg, 'superuser (schema parity read)');

  let problems = [];
  let checkedCols = 0;
  let deviations = 0;

  try {
    const localRes = await client.query(`
      select table_name, column_name, data_type, udt_name, is_nullable
      from information_schema.columns
      where table_schema = 'public'
      order by table_name, ordinal_position
    `);
    const local = new Map();
    for (const r of localRes.rows) {
      if (!local.has(r.table_name)) local.set(r.table_name, new Map());
      local.get(r.table_name).set(r.column_name, r);
    }

    const srcTables = Object.keys(snapshot.tables).sort();
    console.log(`[parity] comparing ${srcTables.length} source tables\n`);

    for (const t of srcTables) {
      const srcCols = snapshot.tables[t].columns;
      const locCols = local.get(t);
      if (!locCols) { problems.push(`TABLE MISSING LOCALLY: ${t}`); continue; }

      const allowedMissing = ALLOWED_MISSING[t] || [];
      for (const [col, meta] of Object.entries(srcCols)) {
        const loc = locCols.get(col);
        if (!loc) {
          if (allowedMissing.includes(col)) {
            deviations++;
            console.log(`  [deviation] ${t}.${col}: intentionally absent locally (documented)`);
            continue;
          }
          problems.push(`COLUMN MISSING: ${t}.${col}`);
          continue;
        }
        checkedCols++;
        const srcType = normSourceType(meta.format, meta.type);
        const locType = normLocalType(loc);
        if (srcType !== locType) {
          problems.push(`TYPE MISMATCH: ${t}.${col} source=${srcType} local=${locType}`);
        }
        const srcNotNull = !!meta.notNull;
        const locNotNull = loc.is_nullable === 'NO';
        if (srcNotNull !== locNotNull) {
          problems.push(`NULLABILITY MISMATCH: ${t}.${col} source.NotNull=${srcNotNull} local.NotNull=${locNotNull}`);
        }
      }

      // Extra local columns (beyond the documented deviations) are a problem.
      for (const col of locCols.keys()) {
        if (!(col in srcCols)) problems.push(`EXTRA LOCAL COLUMN: ${t}.${col}`);
      }
    }

    // Local-only tables: only aura_users is expected.
    for (const t of local.keys()) {
      if (!snapshot.tables[t] && t !== 'aura_users') {
        problems.push(`EXTRA LOCAL TABLE: ${t}`);
      }
    }

    console.log('');
    console.log(`[parity] columns compared: ${checkedCols}`);
    console.log(`[parity] documented deviations: ${deviations}`);
    if (problems.length === 0) {
      console.log('[parity] RESULT: PASS — local schema reproduces the Supabase schema');
      console.log('[parity]         (modulo the documented ai_memories/aura_users deviations)');
    } else {
      console.log(`[parity] RESULT: FAIL — ${problems.length} problem(s):`);
      for (const p of problems) console.log(`  - ${p}`);
      process.exitCode = 1;
    }
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });