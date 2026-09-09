# Agent Instructions

## Project context

Projekt_space is a complete, stable, and secure persistent multiplayer sci-fi
strategy game. The confirmed stack is Next.js, JavaScript, PostgreSQL, and
Prisma; application code is JavaScript. The developer is experienced with
Next.js and Prisma. Read `PROJECT_STATUS.md` for verified evidence and open
decisions before starting work.

## Product and platform decisions

- Design and develop mobile-first player journeys and interfaces. They must be
  responsive on larger screens and controls must remain usable through touch.
- Vercel is the selected hosting platform. Deployment requires a separately
  authorized task.
- Background-event processing remains unresolved.

## Working practices

- Complete one bounded task at a time. Keep code readable, avoid unnecessary
  refactors, and preserve unrelated work.
- Write code, comments, documentation, and UI in English. Write user reports
  in Swedish.
- Enforce server-side authorization and input validation where relevant.
  Clients must not determine ownership, balances, or battle outcomes.
- Never expose, log, or commit secrets. Use harmless placeholders in example
  configuration.
- Verify changes with relevant repository commands and, for risky behavior,
  appropriate browser, API, or integration evidence. Report failed and unrun
  checks honestly. Inspect untracked files directly because Git diff checks do
  not include them.
- Remove disposable temporary files, but retain intentional regression tests.
- Do not commit, push, deploy, or run destructive operations unless explicitly
  authorized.

## Completion reports

Report changes, validation, risks, and an accurate conventional commit
suggestion. Read-only tasks need no new commit.
