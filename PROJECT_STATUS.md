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
- `PROJECT_STATUS.md` and `AGENTS.md` are present; review and commit are
  pending.
- Application development has not started.
- Other foundation documents still need reconciliation and integration.

## Open setup decisions

The following are unresolved decisions, not approved choices:

- Supported package versions and local runtime compatibility.
- Next.js router and development tooling.
- Reliable background-event processing.

## Application setup acceptance criteria — proposed

- Router, package versions, and runtime compatibility are established before
  scaffolding.
- The eventual setup task has an explicit file scope and real validation
  commands.
- Its documented start procedure works and the initial page renders.
- Authentication, database integration, and gameplay are separate tasks.
- Future interface work includes browser verification at a narrow mobile
  viewport and a wider-screen viewport.
