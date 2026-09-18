# AURA Dashboard — local PostgreSQL (Phase 2 foundation)

This directory is the **Phase 2 deliverable**: the local PostgreSQL 18 database
foundation for the AURA Trading Dashboard. It creates the database, a
least-privilege application role and a complete, versioned copy of the
application data model currently living in Supabase.

**Target:** local PostgreSQL 18 on Windows, service `postgresql-x64-18`,
`127.0.0.1:5432`. No Oracle VM. No Docker. Supabase remains fully intact and is
still the runtime database — nothing in the application was modified.

---

## Phase status

| Item | Status |
|---|---|
| Phase 2 — local database + schema + least-privilege role | **DONE** |
| Phase 3 — migrate existing Supabase data + parity verification | **DONE (81/81 checks passed)** |
| Phase 4 — point the backend at local PostgreSQL | NOT STARTED |
| Phase 5–7 — verification / ingestion / reconciliation | NOT STARTED |
| Phase 8 — remove Supabase runtime dependencies | NOT STARTED |

**Explicitly NOT touched in Phase 2:** application code, frontend, Auth,
Storage, Realtime, Render deployment, `@supabase/supabase-js`, and the Supabase
project itself.

---

## Layout

```
db/
├── README.md                      this document
├── .env.example                   credential template (copy to .env.local)
├── .gitignore                     ignores .env.local, *.dump, *.sql.gz, *.log
│                                  (⚠ does NOT ignore audit/phase3_dumps/*.sql)
├── _lib.mjs                       shared helpers (env-only credentials)
├── _expected.mjs                  verification contract (21 tables, 256 columns)
├── bootstrap_database.mjs         step 1: create role + database (inspects first)
├── apply_schema.mjs               step 2: apply schema/*.sql in order (idempotent)
├── verify_schema.mjs              step 3: 247 structural + privilege checks
└── schema/
    ├── 00_functions.sql             set_updated_at() + handle_updated_at()
    ├── 01_aura_users.sql            local user table (PHASE 2 PLACEHOLDER)
    ├── 02_prop_firms.sql
    ├── 03_accounts.sql
    ├── 04_trades.sql                incl. partial unique index on ticket
    ├── 05_user_settings.sql         35 columns, PK = user_id
    ├── 06_profiles.sql              recovered from the live project
    ├── 07_certificates.sql          certificates + payouts
    ├── 08_roi_transactions.sql
    ├── 09_trade_screenshots.sql
    ├── 10_ai_core.sql               conversations/messages/memories/insights
    ├── 11_ai_analyses.sql           analysis job/audit layer
    ├── 12_behavior_engine.sql       behaviors + evidence
    ├── 13_trading_rules_alerts.sql  trading_rules + behavior_alerts
    ├── 14_trading_briefs_config.sql trading_briefs + behavior_config
    ├── 15_grants.sql                least-privilege grants for aura_app
    ── optional/
        ── ai_memories_pgvector.sql NOT applied — documents the ai_memories
                                     deviation and how to undo it later
```

---

## How to run

### 1. Credentials (never hard-coded, never generated)

```bat
copy db\.env.example db\.env.local
```

Then fill in `db\.env.local` (gitignored):

| Variable | Meaning |
|---|---|
| `AURA_PG_SUPERUSER` | superuser role used only to create the database/role and apply DDL (default `postgres`) |
| `AURA_PG_SUPERUSER_PASSWORD` | the password **you** set for that role during PostgreSQL installation |
| `AURA_APP_PASSWORD` | the password **you** choose for the new `aura_app` role |
| `AURA_APP_DB` / `AURA_APP_USER` | defaults `aura_dashboard` / `aura_app` |
| `PGHOST` / `PGPORT` | defaults `127.0.0.1` / `5432` |

Environment variables override the file, and the file is only a convenience —
the scripts never print, log, store or generate passwords. If `AURA_APP_PASSWORD`
is missing while the role still has to be created, `bootstrap_database.mjs`
stops with instructions instead of inventing one.

### 2. Run the three steps

```bat
node db\bootstrap_database.mjs    :: create role + database (idempotent, inspects first)
node db\apply_schema.mjs          :: apply the 16 schema files in order
node db\verify_schema.mjs         :: 247 checks; exits non-zero on any failure
```

`node db\apply_schema.mjs --dry-run` prints the apply order without connecting.

Both `bootstrap_database.mjs` and `apply_schema.mjs` **refuse to run against a
non-local host** (`127.0.0.1` / `localhost` / `::1` only).

---

## Apply order (must not be reordered)

`00_functions` → `01_aura_users` → `02_prop_firms` → `03_accounts` → `04_trades`
→ `05_user_settings` → `06_profiles` → `07_certificates` → `08_roi_transactions`
→ `09_trade_screenshots` → `10_ai_core` → `11_ai_analyses` →
`12_behavior_engine` → `13_trading_rules_alerts` →
`14_trading_briefs_config` → `15_grants`

Rules:
* `00_functions.sql` must run before any file that creates an `updated_at` trigger.
* `01_aura_users.sql` must run before every table that references it (17 FKs).
* `15_grants.sql` must run last (it grants on *all* tables).
* `schema/optional/` is **not** part of the apply order.

Every file is idempotent: `create table if not exists`, `create index if not
exists`, `create or replace function`, `drop trigger if exists` + `create
trigger`, `grant`/`revoke`. Re-running `apply_schema.mjs` never drops or alters
an existing table — the pre-scan only *reports* what already exists.

---

## Intentional differences from Supabase

Each difference is deliberate, documented and behaviour-neutral for the current
application. Everything else reproduces the live Supabase schema verbatim
(verified: 21 tables, 256 columns, all PK/FK/CHECK/UNIQUE constraints, all
indexes, all triggers).

### 1. `aura_users` replaces `auth.users` as the FK target
Supabase's `auth.users` holds emails, bcrypt password hashes, confirmation state,
sessions and MFA. Phase 2 implements **none** of that. `public.aura_users(id,
email, created_at, updated_at)` exists only so the 17 `references auth.users(id)`
relationships can be recreated and so the **12 existing user UUIDs** can be
preserved in Phase 3.

* `email` is **nullable and unique** — the real addresses are not readable
  through the PostgREST API, so they are left to be filled in rather than invented.
* No password/token/session columns exist.
* **This is not the final authentication design.** A later phase decides auth.

### 2. `ai_memories` has no `embedding` column and no vector index
Audit evidence: 0 rows, semantic memory retired in
`aura-backend/src/memory.js`, `match_memories`/`match_conversations` called by no
code, and pgvector is not installed in this PostgreSQL 18 instance.

* Nothing in the application selects or writes `embedding`, so no behaviour is lost.
* `ai_memories` keeps its 10 other columns, its CHECK constraints, its FK and its
  `updated_at` trigger.
* To reintroduce it later: install pgvector, then run
  `schema/optional/ai_memories_pgvector.sql` (commented, not in the apply order).
* **Phase 3 impact:** the Supabase export must use an explicit column list for
  `ai_memories` (never `select *`), because the source table has one extra column.

### 3. `profiles` was recovered from the live project
There is no `profiles` DDL anywhere under `supabase/` — the table exists only in
the live project (schema drift found in the audit). Its 6 columns were recovered
from the live PostgREST schema. `profiles.id` now references `aura_users(id)`.

### 4. `handle_updated_at()` is created alongside `set_updated_at()`
The live database uses **both** names: `trades` and `roi_transactions` triggers
call `handle_updated_at()`, while the AI/behaviour tables call
`set_updated_at()`. The repo only defined `set_updated_at()`. Both functions are
created with identical behaviour so no trigger has to be repointed.

### 5. `TABLESPACE pg_default` is omitted
The Supabase DDL carried `TABLESPACE pg_default` (an artefact of pg_dump-style
output). It is the default tablespace and has no behavioural effect.

### 6. Two `updated_at` triggers are added where the live state is unverifiable
`accounts` and `profiles` have `updated_at` columns but **no DDL in the repo**, so
their live trigger state could not be read through the PostgREST API. The
standard `set_updated_at()` trigger is applied to both, matching every other
table. No current code reads `accounts.updated_at` or `profiles.updated_at` for
logic, so this is a safe normalisation.

### 7. No RLS policies, no Realtime publication, no Storage policies
RLS (`auth.uid()`), the `supabase_realtime` publication and `storage.objects`
policies are Supabase-specific. They are not recreated. Isolation moves to the
backend's existing `TradingDataAccess` ownership checks in Phase 4/8 — which also
fixes the audit finding that `trades`, `accounts` and `roi_transactions` are
currently readable without authentication.

### 8. Database encoding/collation
`create database aura_dashboard` uses the cluster's default template (UTF8
encoding; locale inherited from the PostgreSQL installation). Supabase used
`en_US.UTF-8`. Text `ORDER BY` can therefore differ subtly for accented/
case-mixed strings; every ordering the application relies on is by timestamp,
number or UUID, so behaviour is unaffected. The verify step prints the actual
encoding/collation.

---

## Privilege model for `aura_app`

`aura_app` is a plain login role: **NOSUPERUSER, NOCREATEDB, NOCREATEROLE,
NOREPLICATION, NOBYPASSRLS**, and it owns nothing.

| Object | Grants |
|---|---|
| schema `public` | `USAGE` only — **no `CREATE`** (PostgreSQL 15+ already revokes it from PUBLIC) |
| all 20 application tables | `SELECT, INSERT, UPDATE, DELETE` |
| `aura_users` | `SELECT` only — user lifecycle belongs to the future auth service |
| `set_updated_at()`, `handle_updated_at()` | `EXECUTE` (needed by the `updated_at` triggers) |
| sequences | none exist (every primary key is a UUID with a default) |
| default privileges | future tables/functions created by the owner are granted automatically |

Denied (verified with SQLSTATE 42501): `CREATE TABLE`, `CREATE ROLE`,
`CREATE SCHEMA`, `CREATE DATABASE`, `CREATE EXTENSION`, `ALTER TABLE`,
`DROP TABLE`, `TRUNCATE`, `INSERT` into `aura_users`, `SELECT pg_authid`,
`UPDATE pg_class`.

Optional hardening (commented in `15_grants.sql`, not applied): revoke `CONNECT`
from `PUBLIC` so only `aura_app` (and superusers) can reach the database.

---

## Verification (`node db/verify_schema.mjs`)

247 assertions, all passing on PostgreSQL 18.6 at the time of writing:

| Group | What is asserted |
|---|---|
| role | exists, can log in, is not superuser/createdb/createrole/replication/bypassrls |
| tables | all 21 expected tables exist; no unexpected extras |
| columns | exact column set per table (256 columns) |
| types | 22 behaviour-critical column types (e.g. `trades.ticket numeric`, `trades.time_open timestamp without time zone`, `trade_screenshots.ticket text`, `ai_analyses.trigger text`, all `jsonb`) |
| PKs | every primary key by name |
| unique | 8 UNIQUE constraints: `aura_users_email_key`, `prop_firms_name_key`, `behaviors_account_name_key_type_unique`, `behavior_evidence_behavior_trade_unique`, `trading_rules_account_rule_unique`, `behavior_alerts_account_dedupe_unique`, `trading_briefs_account_week_unique`, `behavior_config_account_unique` |
| CHECK | 24 CHECK constraints (catalog `contype='c'`) — accounts ×4, trades ×1, user_settings ×3, certificates ×1, roi_transactions ×2, ai_messages ×1, ai_memories ×2, ai_insights ×2, ai_analyses ×2, behaviors ×2, trading_rules ×1, behavior_alerts ×3 |
| FKs | 39 foreign keys (catalog `contype='f'`) with the exact target table **and** ON DELETE action (CASCADE / SET NULL / RESTRICT / NO ACTION) |
| indexes | all 38 named indexes (67 rows total in `pg_indexes`, which also lists the 21 PK and 8 UNIQUE-constraint indexes) |
| `idx_trades_ticket_unique` | asserted to be a **UNIQUE** index on `public.trades` that is **PARTIAL** with `WHERE (ticket IS NOT NULL)` |
| triggers | all 13 `updated_at` triggers + both functions |
| ownership | no table owned by `aura_app` |
| `updated_at` | writes prove `set_updated_at()` and `handle_updated_at()` actually fire (rolled back) |
| privileges | `has_table_privilege` matrix for all 21 tables; `USAGE` yes / `CREATE` no on `public` |
| DML | real INSERT/UPDATE/DELETE as `aura_app` across **every** application table, plus CHECK-constraint enforcement (rolled back) |
| denials | 11 DDL/role/superuser operations must fail (rolled back) |
| data state | all 21 tables empty (Phase 2 must not migrate data) and no test rows left behind |

Every write performed by the verifier happens inside a transaction that is
rolled back, so the database is left exactly as the schema step created it.

---

## Phase 3 — data migration + parity verification (**DONE**, 2026-09-18)

Phase 3 copied every live Supabase application row into the local PostgreSQL 18
`aura_dashboard` database and proved parity. The Supabase source session was
**read-only for the entire phase** (`set default_transaction_read_only = on`,
`application_name = aura-phase3-readonly`): no writes, DDL, deletes, updates or
truncates were ever issued against Supabase.

| Step | Script | Artefact |
|---|---|---|
| 1. read-only source baseline | `phase3_baseline.mjs` | `audit/phase3_source_baseline.json` |
| 2. data migration | `phase3_migrate.mjs` | `audit/phase3_manifest.json` · `audit/phase3_migrate.log` · `audit/phase3_dumps/*.sql` |
| 3. parity verification | `phase3_verify.mjs` | `audit/phase3_verification.json` |

### Verification result

| Metric | Result |
|---|---|
| checks | **81 pass / 0 fail** |
| application tables with row-count + content-md5 parity | **20 / 20** |
| deep-metric comparisons (timestamps, distinct values, NULLs, sums) | **8 / 8 identical** |
| discovery comparisons (instruments, status values, duplicates, FK orphans) | **11 / 11 identical** |
| migrated application rows | **4,373** (7 of the 20 tables are legitimately empty in the source) |
| `auth.users` → `aura_users` | **12 / 12 UUIDs identical** |
| FK integrity, duplicate tickets, partial unique ticket index | **pass** |

Structural fidelity was re-audited independently against
`audit/supabase_schema_snapshot.json` (captured from the live project's PostgREST
OpenAPI): **19 of 20 tables are column-for-column identical** across source ↔ live
local database ↔ `schema/*.sql`. The single difference is the already-documented
`ai_memories.embedding` omission (see `schema/10_ai_core.sql` header); that table
holds 0 rows and no code reads `embedding`.

### `auth.users` → `aura_users` mapping (intentional, local-only)

`auth.users` does not exist in local PostgreSQL; Phase 2 created `public.aura_users`
holding the same 12 UUIDs. In `phase3_verify.mjs` **only the local** query text is
rewritten with `sql.replace(/auth\.users/g, 'aura_users')` — the source query is
never rewritten, so Supabase is still read through its real `auth.users`.

Exactly one baseline query contains that string: the DISCOVERY probe
`fk_orphans_children_vs_users` (`phase3_baseline.mjs` lines 105–109). `DEEP`
contains no `auth.users` reference, so the mapping inside the DEEP loop is a
harmless no-op kept for symmetry.

### Verifier repair disclosure — `phase3_verify.mjs` vs `.bak`

An earlier partial edit left `phase3_verify.mjs` with a duplicated DEEP/DISCOVERY
block and orphaned checksum fragments interleaved into the checksum loop, which
made the file fail to parse (`SyntaxError: Unexpected token ')'`, line 107).

* `phase3_verify.mjs.bak` (230 lines) preserves that damaged state **verbatim** as
  an audit artefact. It is syntactically invalid on purpose and **no tooling
  references it** (verified by scanning `db/`).
* The current `phase3_verify.mjs` (208 lines) repairs exactly that region: the
  checksum loop closes with its baseline + content-md5 assertions, and the DEEP
  and DISCOVERY loops are restored with the local-only mapping above.
* `git diff --no-index phase3_verify.mjs.bak phase3_verify.mjs` is the
  authoritative record of the change. No verification logic was weakened to
  manufacture a pass; the pass/fail conditions are unchanged from the baseline.

### Outstanding — Storage binaries were NOT migrated

`trade_screenshots` **metadata** (203 rows, incl. `storage_path`) is migrated and
verified, but **no binary object was copied**. About 217 Storage objects (~200
trade screenshots + ~17 certificate/receipt files) still live only in Supabase
Storage, and `storage_path` / `roi_transactions.image_url` still hold Supabase
Storage object keys. Downloading them into local storage is an explicit later
task — **not done in Phase 3**.

### Known stale contract — `verify_schema.mjs` empty-table assertion

`verify_schema.mjs` line 404 asserts all tables are EMPTY ("Phase 3 has not run
yet"). That Phase 2 contract is intentionally **left unchanged**, so re-running it
now reports one failure because the tables are populated. It is not part of Phase 3
verification — use `phase3_verify.mjs` for data parity.

### .gitignore coverage — read before `git add db/`

`db/.gitignore` currently ignores: `.env.local`, `*.dump`, `*.sql.gz`, `*.log`.

* Covered: the migration credentials (`db/.env.local` → ignored) and the logs.
* **Not covered: `audit/phase3_dumps/*.sql`**, which contains real production data
  (trades, profile e-mails, messages). Add `audit/phase3_dumps/` there before
  staging this directory.
* `aura-backend/.env` (Supabase credentials) is already ignored by
  `aura-backend/.gitignore`.

---

## Phase 3 original plan (historical record — superseded by the section above)

Phase 3 will copy the live Supabase data into this schema. Planned approach:

1. Obtain `SUPABASE_DB_URL` (Supabase → Project Settings → Database → Connection
   string) or the Management API token — the highest-fidelity path, and the only
   way to read `auth.users` for the 12 existing users.
2. `pg_dump` (from `C:\Program Files\PostgreSQL\18\bin`) the 20 `public` tables
   with `--no-owner --no-privileges` into a custom-format dump.
3. Import in FK order: `aura_users` (from `auth.users` / `profiles`) → `prop_firms`
   → `accounts` → `trades` → the rest. Use **explicit column lists**, especially
   for `ai_memories` (the source has an extra `embedding` column).
4. Cross-check row counts against the audit baseline: trades 2,057 · accounts 53 ·
   ai_analyses 921 · behavior_evidence 950 · behaviors 91 · trade_screenshots 203 ·
   roi_transactions 27 · user_settings 12 · profiles 12 · prop_firms 7 ·
   certificates 4 · ai_conversations 3 · ai_messages 33 · ai_memories 0 ·
   ai_insights 0 · payouts 0 · behavior_alerts 0 · trading_rules 0 ·
   trading_briefs 0 · behavior_config 0.
5. Verify `trades.time_open` range `2023-10-27T14:20:00` → `2026-09-17T13:35:03`,
   15 distinct instruments, 0 duplicate non-null tickets, 0 duplicate
   `(behavior_id, trade_id)` evidence pairs.
6. Migrate the ~217 Storage objects (200 trade screenshots + 17 certificate/receipt
   files) separately — Storage is not PostgreSQL and is out of scope for Phase 2/3.

Supabase data is **read-only** throughout: no deletes, no updates, no truncates.

---

## Safety rules honoured by this directory

* Credentials come from the environment or the gitignored `db/.env.local` only;
  they are never printed, logged, stored or generated.
* Both mutating scripts refuse non-local hosts.
* Existing role/database/tables are inspected and reported, never overwritten.
* No destructive SQL anywhere: no `DROP TABLE`, no `ALTER TABLE ... DROP COLUMN`,
  no `TRUNCATE` (the only `drop` statements are `drop trigger if exists` before
  re-creating a trigger, and `drop policy`-style guards do not exist here).
* No application code, frontend, Auth, Storage, Realtime or Render configuration
  is touched. `@supabase/supabase-js` stays installed and Supabase stays the
  runtime database until Phase 4+.