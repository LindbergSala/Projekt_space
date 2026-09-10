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
- The pinned Prisma and PostgreSQL JavaScript dependencies are installed;
  direct-version, lint, and build checks passed, while audit findings remain
  open. Review and commit of these dependency changes are pending.
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
- Prisma integration and creation of a non-administrative application role are
  pending; the database-and-Prisma milestone is not complete.

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

## Open decisions

The following are unresolved decisions, not approved choices:

- Production event-processing tooling and architecture. Vercel Workflows is a
  documented candidate, not an approved production choice.
