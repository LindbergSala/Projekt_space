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

## Open decisions

The following are unresolved decisions, not approved choices:

- Production event-processing tooling and architecture. Vercel Workflows is a
  documented candidate, not an approved production choice.
