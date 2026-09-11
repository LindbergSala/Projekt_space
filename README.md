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

`prisma/schema.prisma` defines only a PostgreSQL datasource:

```prisma
datasource db {
  provider = "postgresql"
}
```

Its connection URL is supplied entirely through `prisma.config.mjs`
(`datasource.url`), which is the configuration API this pinned Prisma version
supports; the schema intentionally has no `url`, models, enums, generators,
migrations, or seed data yet.

Validate the schema with the repository-local Prisma CLI, without letting any
tool install or download a CLI:

```bash
node_modules/.bin/prisma validate
```

On Windows PowerShell, run `.\node_modules\.bin\prisma.cmd validate` instead.
This command only confirms that `prisma.config.mjs` loads, that
`DATABASE_URL` resolves, and that the schema is syntactically and semantically
valid. It does not open a database connection and does not prove that Prisma
can read or write data at runtime. Client generation, migrations, and runtime
integration remain separate, unimplemented tasks. The open Prisma dependency
audit findings in [PROJECT_STATUS.md](PROJECT_STATUS.md) are unaffected by
this configuration and remain unresolved.
