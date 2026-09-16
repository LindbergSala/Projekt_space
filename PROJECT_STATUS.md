# Project Status

## Project direction

Projekt_space is a persistent multiplayer sci-fi strategy game. Its intended
scope includes planet development, resources, research, fleets, troop
transport, simulated combat, conquest and plunder, and alliances.

The confirmed stack is Next.js, JavaScript, PostgreSQL, and Prisma. The goal is
a complete, stable, and secure full game, delivered through small, reviewed
tasks. Repository content is written in English; Codex chat reports are written
in Swedish.

Mobile-first design and development are confirmed: player journeys and
interfaces must remain responsive on larger screens with touch-usable controls.
Vercel is the selected hosting platform when deployment becomes appropriate.

## Inspected baseline — 2026-09-09

The Codex repository inspection recorded the following verified checkpoint:

- The `main` branch tracked `origin/main` and the working tree was clean.
- The latest commit was `2bad974 Initial commit`.
- `README.md` was the only tracked file.
- No `AGENTS.md`, application files, `package.json`, lockfile, Prisma schema,
  or Prisma migrations were present.
- Git whitespace checks passed.
- The Codex inspection observed Node.js `v24.20.0` and npm `11.19.0` in its
  local environment. These are environment observations, not pinned project
  requirements.

## Current progress

- Initial repository inspection is complete.
- `PROJECT_STATUS.md` and `AGENTS.md` have been reviewed and committed.
- A proposed background-event architecture is documented in
  [ARCHITECTURE.md](ARCHITECTURE.md) and has been committed.
- The initial application foundation has been reviewed, verified, and committed
  as `4986a3e chore: initialize next.js application`.
- The dependency-aware delivery order is documented in
  [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) and has been committed.
- The isolated local PostgreSQL service is running and verified; its repository
  configuration was reviewed and committed as
  `dacac97 chore: add local postgres service`.
- The pinned Prisma and PostgreSQL JavaScript dependencies were committed as
  `897e7ac chore: add prisma dependencies`. Installation, direct-version
  inspection, lint, and build previously passed. Security triage is complete,
  but the audit findings remain open.
- The restricted local application database role and repeatable setup tooling
  are implemented and verified. The initial credential-handling correction was
  committed as `bf25d02 harden local database credential setup`, and the
  follow-up temporary-file and password-input hardening was reviewed and
  committed as `f433372 fix: secure temporary credentials and password input`.
- Minimal Prisma CLI configuration (`prisma.config.mjs`) and a PostgreSQL-only
  `prisma/schema.prisma` were reviewed and committed as
  `ec7341a feat: add minimal prisma cli configuration`. A `prisma-client-js`
  generator was added and the client was generated successfully, reviewed and
  committed as `0f18b77 feat: configure prisma client generation`. A
  standalone script executed a read-only Prisma query and was reviewed and
  committed as `fd7f489 feat: add read-only prisma connection verification`.
  The shared server-only Prisma client was reviewed and committed as
  `feb6cf8 feat: add shared server-side prisma client`. The development-only
  diagnostic route was committed as
  `dbe3d75 feat: add development-only prisma connectivity route`.
  Safe diagnostic logging was committed as
  `811487d chore: add safe diagnostics to development db check`. Earlier
  requests returned 503 while the database endpoint was unavailable. With the
  existing container healthy, the development route returned HTTP 200 and
  verified the expected request-level database identity. Migration application,
  authentication integration, and gameplay remain pending.
- `better-auth` `1.7.4` is pinned as a runtime dependency. Its Prisma adapter
  export and `disableImplicitLinking` option were confirmed in the installed
  package; offline imports, the dependency tree, lint, and the production build
  passed. A fresh audit still reports the four previously documented
  high-severity Prisma-chain package findings and no new findings. Registry
  access used process-scoped Node system CA support without changing TLS or
  persistent settings. The minimum Prisma authentication schema now defines
  `User`, `Account`, `Session`, and `Verification`, including the core fields,
  relations, uniqueness constraints, and lookup indexes required for the
  installed Better Auth version. The repository-local Prisma `7.10.0` formatter
  and schema validator both passed. The initial migration now exists at
  `prisma/migrations/20260915164738_add_better_auth_schema/migration.sql` and
  remains unapplied, so the four authentication tables do not exist yet.
  Prisma Client generation for this schema remains pending. Authentication
  configuration, explicit account-linking
  enforcement that disables implicit email-based linking, Google OAuth setup,
  and email delivery also remain pending. The schema alone does not make
  authentication functional; this work awaits review and commit.
- The existing local setup now provisions a dedicated
  `projekt_space_shadow` database for Prisma Migrate and configures
  `SHADOW_DATABASE_URL` without exposing credentials. The restricted
  application role owns only that shadow database and still has no superuser,
  `CREATEDB`, role-creation, replication, or row-level-security-bypass
  attribute. An earlier Prisma `migrate dev --create-only` attempt successfully
  used the configured shadow database but was blocked from creating migration
  metadata with the runtime role. The dedicated restricted migration identity
  documented below resolved that separation without broadening runtime access.
- Other foundation documents still need reconciliation and integration.

## Application foundation — 2026-09-09

- The application was set up manually in the existing repository with the
  Next.js App Router and JavaScript application files.
- The project requires Node.js `24.x`, uses npm with `package-lock.json`, plain
  CSS, and ESLint.
- Direct dependencies are pinned to Next.js `16.3.4`, React `19.2.7`, and React
  DOM `19.2.7`.
- Direct development dependencies are pinned to ESLint `9.39.4` and
  `eslint-config-next` `16.3.4`.
- `npm run lint` and `npm run build` passed. Both the development server and
  the built production server returned HTTP 200 for the homepage with the
  expected heading and text.
- The user reported successful manual browser verification at `360×800` and
  `1280×800`: the document title, main heading, and description were correct;
  content was readable and fully visible without clipping or horizontal page
  scrolling; readability was maintained at 200% browser zoom; and the console
  showed no application runtime or hydration errors. The browser name and
  version were not provided, and these results were not agent-observed.
- This foundation does not require a database connection. Authentication,
  database integration, gameplay, and background jobs remain separate tasks.

## Local PostgreSQL foundation — 2026-09-09

- Docker Compose project `projekt-space-local` runs one PostgreSQL service from
  `postgres:18.6-trixie` and publishes it only at `127.0.0.1:55432`.
- Database `projekt_space_dev` and administrative role
  `projekt_space_admin` were initialized with a password from the ignored,
  untracked `.env.postgres.local` file. No credential value was added to the
  repository.
- The service is healthy and uses the Compose-scoped persistent volume
  `projekt-space-local_postgres-data` mounted at `/var/lib/postgresql`.
- Authenticated TCP access, `SELECT 1`, database identity, role identity, and
  PostgreSQL server version 18.6 were verified with the native PostgreSQL
  client. An incorrect password was rejected.
- A disposable regular probe table and marker survived forced recreation of
  only the PostgreSQL container while retaining the volume. The probe table was
  then removed and its absence verified.
- Existing Windows PostgreSQL services and unrelated Docker resources were
  preserved. The verified local service remains running for development.
- The non-administrative application role is now configured as documented
  below. Prisma integration remains pending, so the database-and-Prisma
  milestone is not complete.

### Local application database role — 2026-09-10

- `scripts/setup-local-db-role.mjs` created `projekt_space_app` with login and
  without superuser, database-creation, role-creation, replication, or
  row-level-security bypass attributes. It has no role memberships and owns no
  development database or schema. It now owns only the dedicated
  `projekt_space_shadow` database described below.
- The role has direct `CONNECT` on `projekt_space_dev` and `USAGE` on its
  `public` schema. Effective `CREATE` is absent on both the database and schema;
  scoped default privileges now allow it to use future tables and sequences
  created by `projekt_space_migrator`, without grant options.
- PostgreSQL's effective `PUBLIC` grants were inspected: the target database
  grants `CONNECT` and `TEMPORARY`, and the `public` schema grants `USAGE`.
  Consequently, the application role has effective temporary-table access.
- A real TCP connection with the generated application password verified the
  expected user and database and passed `SELECT 1`; an incorrect password was
  rejected. Regular table creation in `public` failed with
  `insufficient_privilege`, its transaction was rolled back, and no probe
  object remained.
- The generated application `DATABASE_URL` is stored only in ignored
  `.env.local`. A second setup run reused compatible credentials without
  rotating the password and reverified the role, permissions, application
  authentication, cleanup, and administrative connection.
- The PostgreSQL service remains running. Migration application, Prisma Client
  regeneration, and authentication integration remain separate pending work.
  The documented Prisma dependency audit findings also remain open.

#### Credential-handling verification — 2026-09-11

- Environment parsing now uses `dotenv` consistently and rejects duplicate or
  ambiguous `DATABASE_URL` assignments, the literal example password, query
  parameters, fragments, malformed encoding, and incorrect connection targets
  before persistent work begins.
- Existing-role setup authenticates with the stored application credentials
  before compatibility checks and makes no compensating password or grant
  changes. New-role setup atomically saves the credential before a single
  native `psql` transaction creates the role, sets its password, and grants its
  restricted access. Saved credentials remain available after a database
  failure, while a credential-file failure prevents role creation.
- The initial correction's thirteen Node.js regression tests passed. They use
  synthetic credentials, temporary directories, and mocked boundaries; no
  failure-path test used the real credential files or application role.
- A task-owned native `psql` password-setting probe completed within a
  transaction that was rolled back. The probe role was absent afterward, and
  its synthetic password did not appear in process arguments, SQL, or captured
  output.
- The corrected setup ran twice against the existing application role. Both
  runs authenticated and reverified the role, permissions, positive and
  negative password checks, restricted table creation, rollback cleanup, and
  the final administrative connection without mutation or password rotation.
  Internal comparisons confirmed that `.env.local` and
  `.env.postgres.local` remained unchanged.
- The PostgreSQL service is healthy and remains running. Prisma configuration,
  generation, migrations, and runtime database integration remain pending, and
  the documented Prisma dependency audit findings remain open.

#### Temporary credential and password-input hardening — 2026-09-11

- Temporary credentials now use the ignored
  `.env.local.<unique-id>.tmp` naming pattern. The setup verifies ignore
  protection before exclusively creating the temporary file, records ownership
  before writing, removes task-owned partial files after failures, and reports
  cleanup failures without deleting files it did not create.
- Existing destination comparisons and replacement behavior remain in place.
  The comparison immediately before replacement detects observed changes but
  is not a lock and cannot guarantee detection of every concurrent edit.
- Decoded carriage returns, newlines, and NUL characters are rejected before
  persistent mutation and again before a native client process can start.
  Ordinary URL-encoded password characters remain supported.
- All twenty regression tests passed using only synthetic credentials,
  temporary directories, and mocked process or persistence boundaries.
  Disposable test resources were removed. No real setup, Docker, or database
  operation was run for this follow-up.
- Prisma configuration, generation, migrations, and runtime database
  integration remain pending. The documented dependency audit findings remain
  open.

#### Dedicated Prisma shadow database — 2026-09-15

- The existing setup now creates `projekt_space_shadow` with
  `projekt_space_app` as its owner after the restricted role is available. A
  repeat run verifies the exact owner instead of recreating or altering the
  database. The app role can reset only this shadow database and remains
  without `CREATEDB`, superuser, role-creation, replication, or
  row-level-security-bypass attributes.
- The setup safely appends `SHADOW_DATABASE_URL` to the existing ignored,
  untracked `.env.local`, reusing the application credential while targeting a
  database distinct from `projekt_space_dev`. It rejects ambiguous values,
  mismatched credentials, unexpected targets, and tracked credential files.
  `prisma.config.mjs` supplies the optional value as
  `datasource.shadowDatabaseUrl` and rejects equal logical main and shadow
  targets without printing either URL.
- The provisioning command completed successfully against the existing
  container. Sanitized metadata checks confirmed that
  `projekt_space_dev` remains owned by `projekt_space_admin`, the new shadow
  database is owned by `projekt_space_app`, and the app role's administrative
  attributes remain absent. The container remained healthy at
  `127.0.0.1:55432`.
- Syntax checks passed, all 28 focused Node.js tests passed, and the
  repository-local Prisma `7.10.0` schema validator passed with distinct main
  and shadow URLs loaded from local configuration.
- `prisma migrate dev --create-only --name add_better_auth_schema` reached and
  soft-reset the dedicated shadow database, then exited with code 1 because it
  attempted to create `_prisma_migrations` in `projekt_space_dev.public`, where
  the restricted role intentionally has no `CREATE` privilege. Read-only
  metadata checks confirmed that the four authentication tables and
  `_prisma_migrations` are absent from the development database. No migration
  directory or SQL artifact was generated, and no migration was applied.
- The subsequent read-only `prisma migrate status` check exited with code 1,
  reporting that the current database is not managed by Prisma Migrate and that
  no migration exists in `prisma/migrations`. Consequently,
  `add_better_auth_schema` cannot yet be pending: generation must succeed first.
- This historical generation blocker was resolved by the subsequently
  authorized restricted migration role documented below. Prisma Client
  regeneration, migration application, Better Auth configuration, explicit
  account-linking enforcement, Google OAuth, email delivery, and functional
  authentication testing remain pending. The existing Prisma dependency
  security findings remain open and unchanged.

#### Restricted Prisma migration role — 2026-09-15

- The existing provisioning workflow now creates or verifies the independent
  `projekt_space_migrator` login and stores its separately generated credential
  only as `MIGRATION_DATABASE_URL` in ignored, untracked `.env.local`. Repeat
  setup requires successful authentication and an exact compatible role,
  target, grant, and default-privilege configuration; it does not silently
  rotate credentials or repair conflicting roles.
- The migration role is `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`,
  `NOREPLICATION`, and `NOBYPASSRLS`, has no role memberships, and owns neither
  database nor the `public` schema. Its only direct database grant is `CONNECT`
  on `projekt_space_dev`; its only direct schema grants are `USAGE` and `CREATE`
  on `projekt_space_dev.public`, without grant options. It has no `CREATE` or
  `USAGE` on the shadow database's `public` schema. The runtime role still has
  no `CREATE` in the development database or schema.
- Default privileges for objects created by `projekt_space_migrator` in
  `projekt_space_dev.public` grant `projekt_space_app` exactly `SELECT`,
  `INSERT`, `UPDATE`, and `DELETE` on tables and `USAGE` and `SELECT` on
  sequences, without grant options. Transactional table and sequence probes
  verified ownership and effective grants, were rolled back, and left no probe
  objects.
- `prisma.config.mjs` uses `MIGRATION_DATABASE_URL` as the optional Prisma CLI
  datasource when present, requires it to identify the same logical database as
  `DATABASE_URL`, and requires both to remain separate from
  `SHADOW_DATABASE_URL`. Application runtime code remains unchanged and reads
  only `DATABASE_URL`.
- Repository-local Prisma `7.10.0` generated
  `20260915164738_add_better_auth_schema` with `migrate dev --create-only`.
  Review confirmed only the `user`, `session`, `account`, and `verification`
  tables; all committed columns and PostgreSQL types; four primary keys; the
  three required unique indexes; three lookup indexes; and the two User foreign
  keys with `ON DELETE CASCADE`. String IDs have no database defaults. No
  extension, grant, role, destructive, unrelated, or gameplay SQL is present.
- The generated migration remains pending. Prisma created the allowed, empty
  `_prisma_migrations` metadata table, but none of the four Better Auth tables.
  Migration status exited with code 1 solely because the one migration is
  unapplied. The metadata table initially inherited runtime `SELECT`, `INSERT`,
  `UPDATE`, and `DELETE` from the migration role's table defaults; the
  restricted migration workflow documented below now revokes all runtime
  privileges from this table without changing the application-object defaults.
  Authentication is not functional.
- All 50 focused tests, JavaScript syntax checks, Prisma schema validation, and
  lint pass. Migration application, Prisma Client
  regeneration, Better Auth configuration, explicit account-linking
  enforcement, Google OAuth, email delivery, Vercel/Neon setup, and functional
  authentication testing remain pending. Existing Prisma dependency security
  findings remain open and unchanged.

#### Restricted local Prisma migration workflow — 2026-09-16

- `npm run prisma:migrate:dev -- [options]` is the supported local `migrate dev`
  entry point. Its cross-platform Node wrapper invokes only the repository-local
  Prisma CLI and accepts no arguments or the limited `--create-only` and
  `--name` forms. It rejects datasource, schema, config, destructive-command,
  and arbitrary option overrides before starting Prisma.
- After every accepted Prisma invocation, including a nonzero exit or process
  startup failure, the wrapper runs an idempotent metadata hardener through
  `MIGRATION_DATABASE_URL`. The hardener verifies
  `projekt_space_migrator` on `projekt_space_dev`, treats an absent metadata
  table as a successful no-op, and requires the existing table to be an
  ordinary table owned by the migration role before issuing the fixed
  `REVOKE ALL PRIVILEGES` from `projekt_space_app`. It then verifies that no
  direct or effective runtime table privilege remains. Errors are sanitized.
- The hardener ran once against the current development database. The empty
  `_prisma_migrations` table remains structurally intact and owned by
  `projekt_space_migrator`; `projekt_space_app` now has zero direct and
  effective table privileges and still lacks schema `CREATE`. The existing
  table defaults (`SELECT`, `INSERT`, `UPDATE`, and `DELETE`) and sequence
  defaults (`USAGE` and `SELECT`) for future application objects remain
  unchanged and have no grant option.
- The Better Auth migration and Prisma schema hashes remained unchanged. The
  migration is still pending, its four application tables remain absent, and
  the metadata table remains empty. No migration was regenerated or applied.
  Prisma Client generation, migration application, Better Auth configuration,
  explicit account-linking enforcement, Google OAuth, email delivery,
  Vercel/Neon setup, and functional authentication testing remain pending.
  Existing Prisma dependency security findings remain open and unchanged.

#### Minimal Prisma CLI configuration — 2026-09-11

- `prisma.config.mjs` resolves `prisma/schema.prisma` and `.env.local` as
  absolute paths relative to its own file location. It loads only the
  restricted application `.env.local` file through the installed `dotenv`
  package with output suppressed, never reads administrative credentials, and
  requires `DATABASE_URL` through Prisma's own `env()` helper, which fails with
  a variable-name-only error if it is missing.
- `prisma/schema.prisma` defines only a PostgreSQL `datasource` block with no
  `url`, models, enums, generators, migrations, or seed data. The connection
  URL is supplied exclusively through `prisma.config.mjs`, the configuration
  API the pinned `prisma` `7.10.0` CLI supports.
- `node --check prisma.config.mjs` and the repository-local Prisma CLI's
  `validate` command both passed, confirming the config file loads,
  `DATABASE_URL` resolves, and the schema is syntactically and semantically
  valid. `npm run lint` continued to pass.
- Schema validation does not open a database connection and does not
  demonstrate working Prisma runtime integration; both remain unverified.
  Client generation, migrations, and runtime database access remain separate,
  unimplemented tasks, and the documented Prisma dependency audit findings
  remain open and unaffected by this configuration.

#### Prisma client generation — 2026-09-11

- `prisma/schema.prisma` now also defines a `prisma-client-js` generator
  (`generator client`), chosen because the newer default `prisma-client`
  generator only emits TypeScript sources and requires an explicit `output`
  path, while this project has no TypeScript toolchain. `prisma-client-js`
  needed no explicit `output`; its default location
  (`node_modules/@prisma/client`, re-exporting `node_modules/.prisma/client`)
  is already covered by the existing `node_modules/` Git ignore rule.
- The repository-local Prisma CLI's `validate` and `generate` commands both
  passed with no models defined in the schema and no automatic download;
  `generate` produced the client in 52ms.
- An offline `require('@prisma/client')` import check confirmed `PrismaClient`
  and `Prisma` are exported; no client was instantiated and no database
  connection was opened or attempted.
- This confirms successful generation only, not working runtime database
  integration. Migrations, runtime integration, and the documented Prisma
  dependency audit findings remain open and unaddressed by this task.

#### Standalone Prisma connectivity verification — 2026-09-11

- `scripts/verify-prisma-connection.mjs` loads only `.env.local`, resolves it
  and requires `DATABASE_URL` relative to the script file (not
  `prisma.config.mjs`, which does not configure standalone runtime scripts),
  and reuses the reviewed `parseCompatibleDatabaseUrl` check from
  `scripts/setup-local-db-role.mjs` to reject unexpected hosts, ports,
  databases, usernames, or query/fragment overrides before connecting.
- It connects with `PrismaClient` and the installed `@prisma/adapter-pg`
  (`PrismaPg`), using a bounded 5-second connection and query timeout, and
  runs one fixed read-only query (`SELECT 1`, `current_user`,
  `current_database()`).
- Run twice against the existing local PostgreSQL service, the script
  connected and queried successfully as `projekt_space_app` on
  `projekt_space_dev` both times, and a deliberately mismatched `DATABASE_URL`
  was rejected before any connection attempt with a sanitized message. The
  rejected URL therefore did not test pool cleanup after a database error.
  Code inspection shows that `prisma.$disconnect()` runs in a `finally` block
  after client construction; database-error cleanup was not exercised by that
  test.
- This verifies standalone Prisma connectivity only. The script is not wired
  into the Next.js application; models, migrations, application integration,
  and the documented Prisma dependency audit findings remain open.

#### Shared server-side Prisma client — 2026-09-13

- `lib/prisma.js` uses the installed `PrismaClient` and `PrismaPg` with
  `process.env.DATABASE_URL`, without importing credential files, `dotenv`, or
  Prisma CLI configuration. Its `server-only` import guards against Client
  Component use, and a missing URL error does not include its value.
- The module reuses a `globalThis` client during development hot reload and
  normal module caching in production. Its adapter is created from a
  configuration object and owns its pool; no per-request disconnect or
  import-time connection/query is present.
- `npm run lint` passed. The initial `npm run build` attempt failed before app
  compilation because Windows policy blocked native SWC and the fallback
  download failed certificate verification. A later production build passed
  with `NODE_USE_SYSTEM_CA=1` scoped to its process. No fallback download was
  observed in that successful build, so the flag was not proven necessary.
  The build did not exercise request-level database access.
- `GET /api/dev/db-check` uses this client only after checking for development
  mode. It runs a fixed, parameterized read-only identity query and has
  uncached, identity-free responses. One GET against the local development
  server returned HTTP 503 and `{"ok":false}` with `Cache-Control: no-store`.
  A follow-up with development-only, fixed-label diagnostics returned the same
  HTTP result and logged `query` stage with allowlisted code `P2010`. The
  existing standalone verifier also returned `P2010`; a credential-free TCP
  check of `127.0.0.1:55432` returned `ECONNREFUSED`. The local database
  endpoint was unavailable at that check, so no application-code correction
  or repeat HTTP attempt was justified. Later, the existing PostgreSQL
  container was observed running and healthy at `127.0.0.1:55432`. One GET
  returned HTTP 200 and `{"ok":true}` with `Cache-Control: no-store`, verifying
  the expected application role and database through Next.js. No route code,
  credentials, roles, or permissions were changed for this success. The
  authentication models are now defined in the Prisma schema, but migrations,
  database tables, client regeneration, authentication integration, gameplay,
  and the documented dependency audit findings remain pending.

## Prisma dependency foundation — 2026-09-09

- Runtime dependencies are pinned to `@prisma/client` `7.10.0`,
  `@prisma/adapter-pg` `7.10.0`, `pg` `8.23.0`, and `dotenv` `17.4.2`.
- The Prisma CLI development dependency is pinned to `prisma` `7.10.0`.
- One `npm install` completed successfully, and `npm ls --depth=0` confirmed
  the requested direct versions. `npm run lint` and `npm run build` passed.
- `npm audit --audit-level=moderate` failed with four high-severity findings in
  the transitive Prisma CLI dependency chain, involving `deepmerge-ts` and
  `mysql2`. npm only proposed a forced breaking downgrade to Prisma `6.19.3`,
  which was not applied.
- Prisma configuration and client generation, a non-administrative application
  database role, and runtime database access remain pending and unverified. No
  Prisma schema, migration, database connection, or application behavior was
  introduced by the dependency installation task.

### Prisma dependency security review — 2026-09-10

The completed read-only security inspection recorded these dependency paths:

- `prisma@7.10.0` → `@prisma/config@7.10.0` → `deepmerge-ts@7.1.5`.
- `prisma@7.10.0` → `mysql2@3.15.3`.

Three distinct advisories affect the two underlying packages:

- [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)
  is high severity, affects `deepmerge-ts <8.0.0`, and is patched in `8.0.0`.
  It requires recursive object graphs to reach the merge operation.
- [GHSA-3f6p-5ww8-9rcr](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr)
  is high severity, affects `mysql2 <3.22.0`, and is patched in `3.22.0`.
  It involves a malicious MySQL authentication exchange requesting plaintext
  credentials.
- [GHSA-rgwj-5xj2-c3m3](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3)
  is moderate severity, affects `mysql2 <=3.23.0`, and is patched in `3.23.1`.
  It requires compressed MySQL communication with a malicious or compromised
  endpoint.

`@prisma/config` and `prisma` added two propagated package findings. Both the
full audit and `--omit=dev` audit reported four high package findings and exited
with code 1. The optional Prisma peer relationship from `@prisma/client`
explains why the inspected audit graph retained the findings when Prisma was
declared as a development dependency; this does not establish application
runtime reachability.

At review time, the project had no Prisma configuration, schema, runtime
database integration, or MySQL usage, and no current matching attack path was
established. The packages remain unpatched, however, and exposure must be
reassessed as integration changes. No compatible stable fix was verified, and
no forced downgrade, override, or script-policy change was applied.

The installation warning did not block script execution. Prisma's preinstall
and the engines postinstall recorded successful exits; the individual
`unrs-resolver` script result was not preserved. The original warning could not
be recovered verbatim.

Bounded local PostgreSQL development may continue using trusted repository
configuration while these findings remain open. Reassess them when Prisma
configuration or runtime usage changes and during production security review.
Prefer a verified compatible stable upstream fix that patches or removes both
affected paths; any major-version upgrade requires a separate compatibility
review. Future remediation must repeat full and `--omit=dev` audits, dependency
path inspection, lint, build, and relevant Prisma integration checks once that
integration exists. Prisma configuration, client generation, application-role
creation, and runtime database access remain pending.

#### Reassessment for the new Prisma configuration — 2026-09-11

- `prisma.config.mjs` is a new, reviewed, repository-controlled configuration
  file. The repository-local Prisma CLI's `validate` command reported
  "Loaded Prisma config from prisma.config.mjs", confirming the module
  loaded successfully.
- No matching attack path was identified in this configuration: it is a
  small, static, developer-authored object with two shallow fields (`schema`,
  `datasource.url`), no attacker-controlled, externally supplied, or deeply
  recursive input, and no `mysql2` connection, import, or provider. This does
  not establish that exploitation is impossible, only that this review found
  no such path.
- This is a reassessment of exposure, not remediation. No dependency was
  upgraded, downgraded, overridden, or patched, and no new audit was run as
  part of this task. The four high-severity findings remain open and must be
  reassessed again once client generation, migrations, or runtime database
  access are implemented.

## Open decisions

The following are unresolved decisions, not approved choices:

- Production event-processing tooling and architecture. Vercel Workflows is a
  documented candidate, not an approved production choice.
