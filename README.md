# Projekt_space

Projekt_space is the application foundation for a persistent multiplayer
sci-fi strategy game built with Next.js and JavaScript. PostgreSQL and Prisma
are part of the confirmed stack, but this foundation does not require a
database connection yet.

## Requirements

- Node.js 24.x
- npm

## Install

```bash
npm ci
```

## Development

```bash
npm run dev
```

Open `http://localhost:3000` in a browser.

## Validation

```bash
npm run lint
npm run build
```

## Local production start

Build the application first, then run:

```bash
npm run start
```

## Local PostgreSQL

The local PostgreSQL service is isolated from existing database installations.
It uses PostgreSQL 18.6, publishes only on `127.0.0.1:55432`, and stores data in
a Compose-scoped persistent volume. Minimal Prisma CLI configuration now
exists; application runtime database access remains pending.

Create `.env.postgres.local` from `.env.example`, then assign a unique,
cryptographically random value to `PROJEKT_SPACE_POSTGRES_PASSWORD`. The local
credential file is ignored by Git; never display, share, or commit its value.

Validate the Compose definition without printing the resolved configuration:

```bash
docker compose --env-file .env.postgres.local config --quiet
```

Pull the pinned image and start the service:

```bash
docker compose --env-file .env.postgres.local pull postgres
docker compose --env-file .env.postgres.local up -d --wait --wait-timeout 90 --pull never postgres
```

Inspect service health:

```bash
docker compose --env-file .env.postgres.local ps
```

Stop the service without removing its container or persistent volume:

```bash
docker compose --env-file .env.postgres.local stop postgres
```

Start the retained service again with:

```bash
docker compose --env-file .env.postgres.local start postgres
```

The password is applied only when PostgreSQL initializes an empty data
directory. Changing the value in `.env.postgres.local` later does not change
the password stored in an already initialized database. Use an authenticated
database password-change operation when rotation is implemented.

### Local application role

Prerequisites:

- Install the existing npm dependencies.
- Create `.env.postgres.local` as described above.
- Start the healthy `projekt-space-local` PostgreSQL service.

Create or verify the restricted local application role and its credentials:

```bash
node scripts/setup-local-db-role.mjs
```

The script reads the administrative password from `.env.postgres.local` only
for local role setup. It writes the restricted application's `DATABASE_URL` to
the ignored `.env.local` file. Neither credential file may be committed or
shared, and the application must not use the administrative role.

Environment values are parsed with `dotenv`. The setup rejects duplicate or
ambiguous `DATABASE_URL` assignments, the documented example password, URL
parameters or fragments, and connection targets other than the expected local
database before it can change credentials or the database. Passwords whose
decoded values contain carriage returns, newlines, or NUL characters are also
rejected before persistence and again at the native-client boundary.

The `projekt_space_app` role can log in, connect to `projekt_space_dev`, and
use its `public` schema. It is not a superuser, cannot create databases or
roles, cannot bypass row-level security, owns no database or schema, and is not
granted database or schema creation rights. PostgreSQL's effective `PUBLIC`
privileges are inspected and reported separately.

Rerunning the command reuses compatible credentials and verifies the role
without rotating its password. A conflicting role or `DATABASE_URL` causes a
sanitized failure instead of being overwritten or reset.

For a new role, the generated credentials are written through an ignored
`.env.local.<unique-id>.tmp` file before one native `psql` transaction creates
the role, sets its password, and grants the restricted access. The setup checks
the temporary path's ignore protection, exclusively creates the file before
writing, removes task-owned partial files after failures, and reports cleanup
failures. A credential-file failure prevents database creation. If database
setup fails after the credentials are saved, they remain available for a safe
retry. Existing unrelated environment entries are preserved. Content
comparisons before replacement detect observed conflicting changes, but they
are not a file lock and cannot guarantee detection of every concurrent edit.

Run the credential-handling regression tests with:

```bash
node --test tests/setup-local-db-role.test.mjs
```

Migration credentials, Prisma client generation, and future table or default
privileges are separate implementation tasks. Minimal Prisma CLI configuration
and schema validation are described below.

## Prisma configuration

`prisma.config.mjs` at the repository root is the minimal Prisma CLI
configuration. It resolves `prisma/schema.prisma` and `.env.local` as absolute
paths relative to its own file location, so it behaves the same regardless of
the caller's working directory. It loads `.env.local` with the installed
`dotenv` package using `{ quiet: true }` so no configuration values are
printed, and it never reads the administrative `.env.postgres.local` file. The
restricted application `DATABASE_URL` is required: if it is missing, Prisma's
own `env()` helper throws an error naming only the missing variable, never its
value.

`prisma/schema.prisma` defines a `prisma-client-js` generator and a PostgreSQL
datasource, with no models, enums, migrations, or seed data yet:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}
```

`prisma-client-js` was chosen over the newer default `prisma-client`
generator because `prisma-client` only emits TypeScript sources and requires
an explicit `output` path, while this project has no TypeScript toolchain.
`prisma-client-js` emits directly runnable JavaScript at its built-in default
location (`node_modules/@prisma/client`, re-exporting
`node_modules/.prisma/client`), already covered by the existing
`node_modules/` ignore rule, so no `output` path or `.gitignore` change was
needed.

Its connection URL is supplied entirely through `prisma.config.mjs`
(`datasource.url`), which is the configuration API this pinned Prisma version
supports.

Validate the schema and generate the client with the repository-local Prisma
CLI, without letting any tool install or download a CLI:

```bash
node_modules/.bin/prisma validate
node_modules/.bin/prisma generate
```

On Windows PowerShell, use `.\node_modules\.bin\prisma.cmd` instead. Both
commands passed without opening a database connection: `validate` confirms
`prisma.config.mjs` loads, `DATABASE_URL` resolves, and the schema is valid;
`generate` produced the client above even with no models defined. A
`require('@prisma/client')` check confirmed `PrismaClient` and `Prisma` are
exported, without instantiating a client. Neither command proves working
runtime database integration. Migrations and runtime integration remain
separate, unimplemented tasks. The open Prisma dependency audit findings in
[PROJECT_STATUS.md](PROJECT_STATUS.md) are unaffected by this configuration
and remain unresolved.

### Standalone Prisma connectivity check

`scripts/verify-prisma-connection.mjs` is a small, repeatable script that
confirms Prisma can open a real connection and execute a read-only query
through the installed `@prisma/adapter-pg` driver adapter (`PrismaPg`). It
loads only `.env.local`
(never the administrative `.env.postgres.local`), resolving both that file
and its `DATABASE_URL` requirement relative to the script's own location
rather than `prisma.config.mjs` or the caller's working directory. It reuses
the reviewed `parseCompatibleDatabaseUrl` check from
`scripts/setup-local-db-role.mjs` to reject any URL that does not target the
documented local host, port, database, and `projekt_space_app` role,
including query-parameter or fragment overrides.

With a compatible URL, it connects using `PrismaClient` and `PrismaPg` with a
bounded 5-second connection and query timeout, and runs one fixed read-only
query (`SELECT 1`, `current_user`, `current_database()`), verifying the
returned identity before reporting success. Failures print a sanitized
message only—either the reviewed validation error or a bare error code—and
exit non-zero; the connection URL and password are never printed. The
adapter's internally owned pool is released through `prisma.$disconnect()` in
a `finally` block after a client is created. The mismatched-URL test was
rejected before client construction or connection, so it did not exercise pool
cleanup after a database error; that cleanup path is supported by code
inspection, not an executed failure-path test.

Run it with:

```bash
node scripts/verify-prisma-connection.mjs
```

This passed against the running local PostgreSQL service, confirming Prisma
can connect, authenticate, and query as `projekt_space_app` on
`projekt_space_dev`. The check was reviewed and committed as `fd7f489`.

### Shared server-side Prisma client

`lib/prisma.js` exports a shared `PrismaClient` using `PrismaPg` and the
server-provided `DATABASE_URL`. Import it only from Next.js server code. Its
`server-only` import prevents use from Client Components; Next.js loads the
environment, so the module does not load credential files or Prisma CLI
configuration itself. A missing URL raises an error naming only the variable.

In development, the client is cached on `globalThis` across hot reloads. In
production, normal module caching reuses it. The adapter is constructed from
a connection configuration and owns its pool; do not disconnect the shared
client after individual requests. Code inspection found no connection or query
during module import. Lint passed, but this task's production build was blocked
before app compilation by the local SWC binary policy and a failed certificate
check during Next.js's fallback download. The module is not imported by an
application entry point, so request-level database access remains unverified
regardless of build outcome. Models, migrations, and application use remain
separate tasks. The documented Prisma dependency audit findings in
[PROJECT_STATUS.md](PROJECT_STATUS.md) remain unresolved.
