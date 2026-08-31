#!/usr/bin/env node
/**
 * Phase 2 migration applier — Trading Behavior Engine.
 *
 * Applies the 10 idempotent SQL files in the exact documented order
 * (supabase/README_APPLY_ORDER.md), then runs the full schema verification
 * (supabase/verify_schema.mjs) against the live database.
 *
 * Authenticated access is taken from the environment only:
 *   SUPABASE_DB_URL (or DATABASE_URL)  OR  SUPABASE_ACCESS_TOKEN
 *
 * Usage:
 *   node supabase/apply_migrations.mjs [--dry-run]
 *
 * Guarantees:
 *   - Applies files one at a time, in order; stops at the first failure with
 *     the exact Postgres error (no retries, no force, no destructive SQL).
 *   - Every file is idempotent, so re-running after a fix is safe.
 *   - Never prints credentials.
 */

import { APPLY_ORDER, resolveSqlAccess, execSql, readSqlFile } from './_lib.mjs';
import { runVerify } from './verify_schema.mjs';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const access = resolveSqlAccess();
  const mode =
    access.mode === 'db'
      ? 'direct Postgres (SUPABASE_DB_URL)'
      : `Management API (project ${access.ref})`;
  console.log(`SQL access mode: ${mode}`);
  console.log(`Files to apply (${APPLY_ORDER.length}, in documented order):`);

  if (dryRun) {
    for (const f of APPLY_ORDER) console.log(`  - ${f}`);
    console.log('dry-run: nothing executed.');
    return;
  }

  for (const file of APPLY_ORDER) {
    const sql = readSqlFile(file);
    process.stdout.write(`applying ${file} ... `);
    try {
      await execSql(access, sql);
      console.log('OK');
    } catch (err) {
      console.log('FAILED');
      console.error(`\nFailed on: ${file}`);
      console.error(err.message);
      console.error('\nStopped. Fix the issue and re-run (all files are idempotent; already-applied files are skipped safely).');
      process.exit(1);
    }
  }

  console.log('\nAll Phase 2 migration files applied. Verifying schema...\n');
  const failures = await runVerify(access);
  if (failures > 0) {
    console.error(`\nSCHEMA VERIFICATION FAILED with ${failures} problem(s).`);
    process.exit(1);
  }
  console.log('\nMigration + schema verification complete.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
