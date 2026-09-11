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
a Compose-scoped persistent volume. Prisma and application database access are
not configured yet.

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
database before it can change credentials or the database.

The `projekt_space_app` role can log in, connect to `projekt_space_dev`, and
use its `public` schema. It is not a superuser, cannot create databases or
roles, cannot bypass row-level security, owns no database or schema, and is not
granted database or schema creation rights. PostgreSQL's effective `PUBLIC`
privileges are inspected and reported separately.

Rerunning the command reuses compatible credentials and verifies the role
without rotating its password. A conflicting role or `DATABASE_URL` causes a
sanitized failure instead of being overwritten or reset.

For a new role, the generated credentials are written atomically before one
native `psql` transaction creates the role, sets its password, and grants the
restricted access. A credential-file failure prevents database creation. If
database setup fails after the credentials are saved, they remain available
for a safe retry. Existing unrelated environment entries are preserved, while
concurrent or conflicting file changes cause the setup to stop.

Run the credential-handling regression tests with:

```bash
node --test tests/setup-local-db-role.test.mjs
```

Migration credentials, Prisma configuration and generation, and future table
or default privileges are separate implementation tasks.
