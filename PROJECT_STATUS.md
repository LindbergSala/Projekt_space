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
Vercel is the selected hosting platform. The first Preview and Production
deployments are reported as Ready, with the evidence boundary and remaining
limitations recorded in the 2026-09-22 checkpoint below.

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
  verified the expected request-level database identity. Authentication
  integration is now implemented as described below; gameplay remains pending.
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
  has been applied to the local development database. The four authentication
  tables exist, match the Prisma schema, and are empty. Prisma Client `7.10.0`
  has been regenerated for this schema, and a bounded read-only check through
  the shared runtime client returned zero rows for all four tables under the
  expected restricted identity. The minimum Better Auth server configuration
  and App Router handler now exist as documented below. Implicit email-based
  account linking is disabled. The complete local email/password request flow
  has now passed as documented below. The minimum email/password UI is
  implemented with server-side account protection, and its complete visible
  flow has been manually verified at a mobile viewport as documented below.
  Automated browser E2E and browser-console verification were not performed.
  Google credentials and resources, email verification, password reset,
  explicit linking UX, OAuth testing, and comprehensive production
  authentication verification remain pending. One limited Production sign-in
  and account-page result is user-reported in the 2026-09-22 checkpoint;
  authentication is not complete.
- Repository-level Vercel and Neon preparation is implemented as documented
  below. Clean Vercel Linux installs have a fixed Prisma Client generation
  hook, production migration has a separate argumentless `migrate deploy`
  wrapper, pooled/direct Neon endpoints are matched by full endpoint identity,
  and Better Auth has fail-closed Production and Preview origin handling. The
  user reports that separate Neon Preview and Production branches are now
  provisioned and migrated and that both Vercel environments have reached
  Ready; these external results were not independently inspected from the
  repository.
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

## First Vercel deployments — 2026-09-22

- Repository inspection independently confirms that `main` and `origin/main`
  point to `c4f40fe fix(auth): trust generated Vercel production origin`. The
  committed `20260915164738_add_better_auth_schema` migration defines the four
  Better Auth tables, and the authentication configuration on that revision
  validates and trusts the exact generated Vercel Production origin alongside
  the explicit HTTPS base origin. These are repository facts, not verification
  of external deployment or database state.
- The user reports that the committed Prisma migration succeeded on separate
  Neon Preview and Production branches. The user also reports that the former
  Neon Vercel Marketplace resource was disconnected and that `DATABASE_URL`
  and Better Auth secrets were configured separately in Vercel. No connection
  string, secret value, Vercel control-plane state, or Neon database state was
  accessed or independently verified for this checkpoint.
- The user reports that Preview and Production deployments reached Ready and
  that the Production deployment for `c4f40fe` is assigned the project domain
  `projekt-space.vercel.app`. The user successfully signed in and viewed
  `/account` on the generated Production deployment URL. After an SSL error on
  the user's desktop, the user separately reported that sign-in worked on a
  mobile phone over mobile data. These browser results were not agent-observed;
  the cause of the desktop SSL error remains unknown, and the report does not
  establish that the short project domain works on every device or network.
- Registration by a new, independent test user on the latest Production
  deployment has not been verified. Email delivery, Google OAuth, explicit
  account linking, comprehensive Production authentication behavior,
  production security, and operational readiness also remain unverified.
  Gameplay systems and production background-event processing are not
  implemented.

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
- The generated migration was subsequently applied through the restricted
  workflow documented below. Its four Better Auth tables now exist locally and
  remain empty. The metadata table initially inherited runtime `SELECT`,
  `INSERT`, `UPDATE`, and `DELETE` from the migration role's table defaults;
  the wrapper revoked all runtime privileges from this table without changing
  the application-object defaults. Authentication is not functional.
- All 50 focused tests, JavaScript syntax checks, Prisma schema validation, and
  lint pass. Better Auth configuration, explicit account-linking
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
  migration has now been applied locally through the wrapper; the four
  application tables exist and remain empty. Prisma Client generation was
  subsequently completed. Better Auth configuration,
  explicit account-linking enforcement, Google OAuth, email delivery,
  Vercel/Neon setup, and functional authentication testing remain pending.
  Existing Prisma dependency security findings remain open and unchanged.

#### Initial Better Auth migration application — 2026-09-16

- `npm run prisma:migrate:dev` applied exactly
  `20260915164738_add_better_auth_schema` with no additional migration. Prisma
  reported the database in sync, and repository-local `prisma migrate status`
  subsequently reported one migration and an up-to-date schema.
- The recorded migration row is finished, has one applied step, and is not
  rolled back. The `user`, `session`, `account`, and `verification` tables match
  the committed columns and PostgreSQL types. They have four primary keys, the
  three required unique indexes, three lookup indexes, and the two User foreign
  keys with `ON DELETE CASCADE`.
- All four application tables are empty and owned by
  `projekt_space_migrator`. `projekt_space_app` has exactly `SELECT`, `INSERT`,
  `UPDATE`, and `DELETE` on each, without `TRUNCATE`, `REFERENCES`, `TRIGGER`,
  ownership, or schema `CREATE`. It has zero direct or effective privileges on
  `_prisma_migrations`, which remains owned by the migration role.
- Read-only catalog comparisons found no additional application table, schema,
  extension, role, role membership, or leftover probe object. The three role
  attribute sets remain unchanged. Repository-local `prisma migrate diff
  --from-config-datasource --to-schema prisma/schema.prisma --exit-code`
  reported no difference.
- The Prisma schema and migration SQL hashes remained unchanged, and no tracked
  file changed during migration execution. Prisma emitted no Client-generation
  output during that step; generation was subsequently completed as documented
  below. Better Auth configuration, explicit account-linking enforcement,
  Google OAuth, email delivery, Vercel/Neon setup, and functional authentication
  testing remain pending. Authentication is not functional, and the existing
  dependency security findings remain open.

#### Prisma Client regeneration for authentication models — 2026-09-16

- Repository-local `prisma` `7.10.0` successfully ran
  `.\node_modules\.bin\prisma.cmd generate --schema prisma\schema.prisma` and
  generated Prisma Client `7.10.0` in the expected ignored dependency location.
  No package, lockfile, schema, migration, or tracked generated artifact changed.
- An offline import confirmed the `PrismaClient` and `Prisma` exports. Generated
  DMMF contains exactly `User`, `Account`, `Session`, and `Verification`, with
  their expected scalar fields and the User-Session and User-Account relations;
  no gameplay model is present. Instantiating the existing shared client exposed
  the `user`, `account`, `session`, and `verification` delegates.
- One bounded read-only runtime check through `lib/prisma.js` used only
  `DATABASE_URL`, connected as `projekt_space_app` to `projekt_space_dev`, and
  returned zero from each model's `count()` query. The same check confirmed no
  effective runtime privilege on `_prisma_migrations`, then disconnected the
  shared client cleanly. No database schema or data write occurred.
- The repository-local `prisma migrate status` command could not be repeated in
  this environment because Windows application-control policy blocked the
  committed `schema-engine-windows.exe` from starting (`spawn UNKNOWN`). No
  policy or dependency file was changed or bypassed. Read-only runtime queries
  still confirmed all four empty tables and the expected database identity.
  A separate read-only metadata query confirmed exactly one finished,
  non-rolled-back migration record with one applied step.
- This verifies generated-client metadata and restricted read access only.
  Better Auth configuration, explicit account-linking policy, routes, sessions,
  Google OAuth, email delivery, Vercel/Neon setup, and functional authentication
  testing remain pending. Authentication is not functional, and the existing
  dependency security findings remain open and unchanged.

#### Smart App Control-compatible Prisma migration tooling — 2026-09-16

- `npm run prisma:migrate:dev -- [options]` now starts only the fixed,
  ephemeral `prisma-tooling` service from `compose.prisma.yaml`. The host
  launcher and the existing inner wrapper independently allow only no options,
  `--create-only`, and the documented `--name` forms. The inner wrapper refuses
  to start Prisma unless it is running on Linux with the tooling marker, so the
  supported Windows workflow cannot execute the blocked Windows schema engine.
- The tooling image uses the official digest-pinned
  `node:24.20.0-bookworm-slim` base, installs the unchanged lockfile with
  `npm ci`, and has no global Prisma installation. It runs as UID 1000 (`node`)
  with a read-only root filesystem, no published ports, no Linux capabilities,
  and `no-new-privileges`. Only the Prisma config, schema, three reviewed
  workflow scripts, and migration directory are mounted; only the migration
  directory is writable. Credential files are excluded from the build context
  and are not mounted.
- The host launcher reads the three existing restricted database URLs without
  printing them, rejects duplicate or unexpected values, preserves credentials
  and database names, and translates only `127.0.0.1:55432` to the existing
  Compose network endpoint `postgres:5432`. Only `DATABASE_URL`,
  `MIGRATION_DATABASE_URL`, and `SHADOW_DATABASE_URL` are exposed to the
  tooling service. The separate Compose definition joins the existing external
  PostgreSQL network and neither needs nor duplicates the administrative
  credential.
- The final image contains Node.js `24.20.0`, local Prisma `7.10.0`, and
  `schema-engine-debian-openssl-3.0.x`. Direct engine execution reported
  `schema-engine-cli 0edf323efd1d98336f3f0a68684b56f689b900d3`; its size is
  23,510,888 bytes and SHA-256 is
  `29557c21d47da6f1695ec1a747cb6c607dade5e44e8b3e4fa687bd4dc226956d`.
- Container-based `prisma migrate status` found the single committed migration
  and reported the database schema up to date. Container-based `prisma validate`
  passed, and a read-only migration diff reported no difference. No migration,
  database write, Prisma Client generation, or Windows policy change occurred;
  Smart App Control remains enabled. The development migration and schema files
  remained unchanged.
- All 18 focused migration-workflow tests passed, including allowed and rejected
  arguments, fixed-service invocation, endpoint translation and rejection,
  exit propagation, secret redaction, metadata-hardener conditions, and the
  host-engine guard. The previously documented four high-severity Prisma-chain
  findings remain open and unchanged. Better Auth configuration, explicit
  account-linking enforcement, Google OAuth, email delivery, Vercel/Neon setup,
  and functional authentication testing remain pending; authentication is not
  functional.

#### Better Auth server foundation — 2026-09-17

- `lib/auth.js` is a server-only Better Auth `1.7.4` module that reuses the
  existing shared Prisma Client through the installed `prismaAdapter` with
  `provider: "postgresql"`. Email/password is enabled. No second Prisma client,
  custom ID generator, session implementation, password hashing, OAuth state,
  cookie handling, or token handling was added.
- The module requires an explicit non-placeholder `BETTER_AUTH_SECRET` of at
  least 32 characters and accepts `BETTER_AUTH_URL` as the server origin.
  Google is omitted when both provider variables are absent, enabled only when
  both are present, and a partial pair fails with a fixed non-secret error.
  Real Google credentials or provider resources were not configured.
- `account.accountLinking.disableImplicitLinking` is explicitly `true`.
  Better Auth's installed OAuth linking implementation checks this flag before
  linking an OAuth identity to an existing email match, so matching email alone
  cannot merge accounts. Explicit authenticated account linking remains future
  work.
- `app/api/auth/[...all]/route.js` uses the installed
  `better-auth/next-js` `toNextJsHandler`, exports only `GET` and `POST`, selects
  the Node.js runtime, and forces dynamic rendering. A task-owned development
  server received one unauthenticated `GET /api/auth/get-session`; it returned
  HTTP 200, JSON `null`, `Cache-Control: no-store`, and `Pragma: no-cache`.
  The server was stopped and its port was released.
- Read-only snapshots before and after the request both reported zero User,
  Account, Session, and Verification rows. No schema, migration, generated
  client, database object, or data changed. Seven focused tests, all 63 Node
  tests, lint, and one production build with synthetic non-production auth
  values passed. The build recognized the auth catch-all route as dynamic.
- Google credentials and OAuth resources, email verification delivery,
  password-reset delivery, authentication UI, explicit account-linking UX,
  and real sign-up, sign-in, sign-out, linking, and OAuth testing remain
  pending. Authentication is not complete. The four previously documented
  high-severity Prisma-chain dependency findings remain open and unchanged.

#### Better Auth email/password HTTP verification — 2026-09-17

- One task-owned Next.js development server used a process-scoped synthetic
  Better Auth secret and local base URL with the existing restricted database
  configuration. A real HTTP flow passed in this order: sign-up, authenticated
  session read, sign-out, rejected stale session, sign-in with the same
  credentials, authenticated session read, sign-out, and a second rejected
  stale session. Every request returned HTTP 200. Both authenticated session
  reads belonged to the expected temporary User, and both post-sign-out reads
  returned JSON `null`.
- Sign-up and sign-in returned only the expected public User fields alongside
  a session token; no password field was exposed and `emailVerified` remained
  false. The development HTTP session cookie was
  `better-auth.session_token` with `HttpOnly`, `SameSite=Lax`, `Path=/`, and
  `Max-Age`. `Secure` was absent on the local HTTP origin. Each sign-out set the
  same cookie name with `Max-Age=0`.
- Baseline counts were zero for User, Account, Session, and Verification.
  Sign-up created exactly one temporary User, one credential Account using the
  User ID as its account identity, and one Session. Password storage was
  present and did not equal the plaintext password. Sign-out removed its
  Session, sign-in created one new Session, the second sign-out removed it, and
  no Verification row was created.
- Cleanup ran in `finally`, selected the task-owned User by its exact unique
  `example.invalid` email, deleted it, and relied on the committed cascade for
  its Account and any Session. The separately scoped Verification cleanup found
  nothing to delete. Prisma disconnected, all four counts returned exactly to
  the zero baseline, and no existing row was available to modify. The
  task-owned server stopped, its port had zero listeners, and PostgreSQL
  remained running and healthy.
- No application defect was found, so authentication code and tests were not
  changed and lint and build were not rerun. Google OAuth, email verification
  and password-reset delivery, authentication UI, explicit account-linking UX,
  linking and OAuth tests, and production authentication verification remain
  pending. This local result does not establish production readiness or make
  authentication complete. The four previously documented high-severity
  Prisma-chain dependency findings remain open and unchanged.

#### Email/password authentication UI — 2026-09-17

- `/register` provides labelled name, email, password, and password-confirmation
  fields, client-side confirmation matching, the installed Better Auth
  8–128-character password limits, pending controls, `aria-live` errors, and
  safe generic failure messages. `/login` provides labelled email and password
  fields, generic invalid-credential feedback, pending controls, and a link to
  registration. Both use a shared same-origin client created by the official
  `better-auth/react` `createAuthClient` export; no server configuration,
  token, cookie, session, password, or OAuth handling is duplicated.
- `/account` remains an async Server Component. Its server-only adapter passes
  awaited Next.js request headers to `auth.api.getSession`, redirects a missing
  session to `/login`, and reduces the authenticated user to name and email
  before rendering. The only client island is a logout button that calls
  Better Auth, navigates to `/login`, and refreshes server state. No internal
  user, account, session, or token identifier is rendered.
- Shared CSS supplies a mobile-first single-column layout, 44-pixel minimum
  controls, visible labels and focus outlines, overflow-safe account values,
  and responsive spacing. The public page now has only two small authentication
  entry links; no gameplay or general redesign was introduced.
- A task-owned development server returned HTTP 307 from signed-out `/account`
  to `/login`; `/login` and `/register` returned HTTP 200 and rendered all
  required labels and autocomplete values. The user then manually verified the
  complete visible flow at approximately 390 px: registration navigated to
  `/account`, the expected name and email were displayed, logout navigated to
  `/login`, signed-out `/account` redirected to `/login`, login with the same
  credentials succeeded, the account page was reached again, and final logout
  succeeded. No horizontal scrolling or visibly broken mobile layout was
  observed. This was manual verification; automated browser E2E, browser-console
  verification, and comprehensive keyboard and focus verification were not
  performed.
- Exactly one user-confirmed temporary test identity was located by its exact
  email and had one credential Account, no Session, and no matching Verification
  row. No unrelated authentication row existed. The User was deleted, its
  Account was removed by the committed cascade, and all User, Account, Session,
  and Verification counts returned to zero. The personal address was not added
  to repository content. Port 3021 had no listener, and PostgreSQL remained
  running and healthy.
- All seven focused UI tests and all 70 Node tests passed. Lint passed, and one
  production build with process-scoped synthetic auth values passed, rendering
  `/account` dynamically and `/login` and `/register` statically. Google OAuth,
  email verification and password-reset delivery, explicit account linking,
  automated browser end-to-end verification, deployment, and gameplay remain
  pending. The local email/password UI is manually verified and usable, but
  authentication is not production-ready. Existing dependency security findings
  remain open and unchanged.

#### Vercel and Neon repository preparation — 2026-09-17

This section preserves the repository-preparation state recorded on its date.
Its then-pending external deployment steps are superseded by the user-reported
2026-09-22 checkpoint above.

- `postinstall` now runs `scripts/prisma-generate-vercel.mjs`. The wrapper
  accepts no arguments and invokes only pinned repository-local Prisma `7.10.0`
  `generate` when both Linux and Vercel's `VERCEL=1` marker are present. It
  removes migration and shadow URLs from the child environment. Windows,
  ordinary local Linux, and the locked Prisma migration-tooling image skip
  generation without starting Prisma, preserving the Smart App Control-safe
  local workflow. Generated Client files remain ignored under `node_modules`.
- `npm run prisma:migrate:deploy` is a separate production release command. Its
  wrapper accepts no arguments, refuses non-Linux hosts, requires a
  syntactically valid direct Neon `MIGRATION_DATABASE_URL`, removes runtime and
  shadow URLs from the Prisma child, and invokes only repository-local
  `prisma migrate deploy` with the fixed `prisma.deploy.config.mjs`. The
  dedicated config loads no credential file and defines no shadow database. It
  is not called by install, build, startup, or ordinary deployment.
- `prisma.config.mjs` retains the same-host local runtime/migrator layout and
  separate-shadow validation. For Neon it now accepts only the documented
  pooled runtime label and direct migration label for the same complete
  endpoint identity, routing domain, port, and database. Unrelated branches,
  reversed or ambiguous pooler pairs, malformed URLs, and database-name
  mismatches fail with value-free errors. The local Docker launcher continues
  to enforce distinct application and migration credentials.
- Better Auth `1.7.4` was checked from its installed types and implementation:
  static `baseURL` and `trustedOrigins` are supported. Local development keeps
  an explicit origin, Production requires explicit HTTPS, and Vercel Preview
  derives HTTPS only from a validated single-label `*.vercel.app` `VERCEL_URL`
  while `VERCEL=1` and `VERCEL_ENV=preview`. Missing, arbitrary, or conflicting
  Preview origins fail closed. The resolved origin is the sole trusted origin;
  request and forwarded-host inference is not used.
- Vercel runtime must use pooled `DATABASE_URL`. Neon's direct/unpooled value
  is mapped to `MIGRATION_DATABASE_URL` only for the separate migration step.
  Preview must use an isolated Neon branch or database and never Production.
  Local Docker variables remain local-only, and `SHADOW_DATABASE_URL` is not a
  Vercel variable.
- Prisma schema and migration SQL remain unchanged. The existing four
  high-severity Prisma-chain findings remain open and were not remediated or
  altered.
- Initial focused tests passed 31/31, the corrected explicit complete Node
  invocation passed 88/88, lint passed, isolated network-disabled Linux
  generation produced Prisma Client `7.10.0`, and one production build with
  process-scoped synthetic values passed. Final review then corrected the
  tooling-image build context for the guarded `postinstall`; all nine changed
  JavaScript files passed syntax checks, all ten affected readiness tests
  passed, lint passed again, and the tooling Compose definition validated.
  The earlier directory-form Node command ran no repository tests because that
  invocation is unsupported on this Windows Node version.
- Vercel CLI installation and login, project linking, Neon provisioning,
  environment-variable writes, production migration, Preview and Production
  deployment, Google OAuth, email delivery, and functional production
  authentication verification remain pending. No external resource was
  created or modified, and production readiness has not been claimed.

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
