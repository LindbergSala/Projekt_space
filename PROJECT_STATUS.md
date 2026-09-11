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
  committed as `bf25d02 harden local database credential setup`. Follow-up
  temporary-file and password-input hardening is implemented and validated;
  review and commit are pending.
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
  database or schema.
- The role has direct `CONNECT` on `projekt_space_dev` and `USAGE` on its
  `public` schema. Effective `CREATE` is absent on both the database and schema;
  no table or default privileges were added.
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
- The PostgreSQL service remains running. Prisma configuration and client
  generation, migration credentials, future table grants, and runtime database
  access remain separate pending work. The documented Prisma dependency audit
  findings also remain open.

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

## Open decisions

The following are unresolved decisions, not approved choices:

- Production event-processing tooling and architecture. Vercel Workflows is a
  documented candidate, not an approved production choice.
