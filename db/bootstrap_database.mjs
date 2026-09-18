#!/usr/bin/env node
/**
 * AURA Dashboard — PHASE 2 step 1
 * Create the local application database + least-privilege application role.
 *
 *   role      : aura_app      (login, NOSUPERUSER, NOCREATEDB, NOCREATEROLE,
 *                              NOREPLICATION, NOBYPASSRLS)
 *   database  : aura_dashboard (owner = the superuser running this script)
 *
 * SAFETY
 *   - If the role or the database already exists it is INSPECTED and reported,
 *     never overwritten. An existing SUPERUSER role with the same name aborts.
 *   - The application password is read from the environment / db/.env.local
 *     (AURA_APP_PASSWORD) and is NEVER printed or generated. If it is missing
 *     while the role has to be created, the script exits with instructions.
 *   - Remote hosts are refused: this tooling targets the local cluster only.
 *
 * Usage:  node db/bootstrap_database.mjs
 */
import {
  loadEnvLocal, superuserConfig, appDatabase, appRole,
  quoteLiteral, quoteIdent, connectOrExplain, targetLabel,
} from './_lib.mjs';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];

async function main() {
  const envFileLoaded = loadEnvLocal();
  const database = appDatabase();
  const role = appRole();
  const cfg = superuserConfig();

  if (!LOCAL_HOSTS.includes(cfg.host)) {
    console.error(`[bootstrap] REFUSING to run against non-local host "${cfg.host}". Phase 2 targets the local PostgreSQL only.`);
    process.exit(1);
  }

  const client = await connectOrExplain(cfg, 'superuser (role + database creation)');
  console.log(`[bootstrap] connected: ${targetLabel(cfg)}`);
  console.log(`[bootstrap] db/.env.local loaded: ${envFileLoaded ? 'yes' : 'no (using process environment)'}`);

  let roleCreated = false;
  let dbCreated = false;

  try {
    // ── 1. role ────────────────────────────────────────────────────────────
    const existing = await client.query(
      `select rolname, rolsuper, rolcanlogin, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
         from pg_roles where rolname = $1`, [role]);

    if (existing.rows.length) {
      const r = existing.rows[0];
      if (r.rolsuper) {
        console.error(`[bootstrap] FATAL: role "${role}" already exists and IS A SUPERUSER.`);
        console.error('[bootstrap] Phase 2 requires a least-privilege role; nothing was changed. Resolve this manually.');
        process.exit(1);
      }
      console.log(`[bootstrap] role "${role}" ALREADY EXISTS — inspected only, left untouched.`);
      console.log(`            login=${r.rolcanlogin} superuser=${r.rolsuper} createdb=${r.rolcreatedb} createrole=${r.rolcreaterole} replication=${r.rolreplication} bypassrls=${r.rolbypassrls}`);
    } else {
      const pw = process.env.AURA_APP_PASSWORD;
      if (!pw) {
        console.error([
          `[bootstrap] role "${role}" does not exist and AURA_APP_PASSWORD is not set.`,
          'Choose the password yourself — this tooling never generates or guesses one:',
          '  copy db/.env.example to db/.env.local (gitignored) and set AURA_APP_PASSWORD, or',
          '  set AURA_APP_PASSWORD in your shell for this session.',
          'Nothing was created.',
        ].join('\n'));
        process.exit(1);
      }
      await client.query(
        `create role ${quoteIdent(role)} login password ${quoteLiteral(pw)}
           nosuperuser nocreatedb nocreaterole noreplication nobypassrls`);
      roleCreated = true;
      console.log(`[bootstrap] role "${role}" CREATED (login; no superuser/createdb/createrole/replication/bypassrls). Password not printed.`);
    }

    // ── 2. database ────────────────────────────────────────────────────────
    const dbExisting = await client.query(
      `select datname, pg_get_userbyid(datdba) as owner,
              pg_encoding_to_char(encoding) as encoding, datcollate, datctype
         from pg_database where datname = $1`, [database]);

    if (dbExisting.rows.length) {
      const d = dbExisting.rows[0];
      console.log(`[bootstrap] database "${database}" ALREADY EXISTS — inspected only, left untouched.`);
      console.log(`            owner=${d.owner} encoding=${d.encoding} collate=${d.datcollate} ctype=${d.datctype}`);
    } else {
      await client.query(`create database ${quoteIdent(database)}`);
      dbCreated = true;
      const after = await client.query(
        `select pg_get_userbyid(datdba) as owner,
                pg_encoding_to_char(encoding) as encoding, datcollate, datctype
           from pg_database where datname = $1`, [database]);
      const d = after.rows[0];
      console.log(`[bootstrap] database "${database}" CREATED. owner=${d.owner} encoding=${d.encoding} collate=${d.datcollate} ctype=${d.datctype}`);
    }

    console.log('');
    console.log(`[bootstrap] summary: roleCreated=${roleCreated} databaseCreated=${dbCreated}`);
    console.log('[bootstrap] next step: node db/apply_schema.mjs');
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});