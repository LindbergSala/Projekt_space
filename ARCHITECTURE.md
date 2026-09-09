# Architecture

## Confirmed foundation

- The approved application stack is Next.js with JavaScript, PostgreSQL, and
  Prisma.
- Player journeys and interfaces are mobile-first, responsive on larger
  screens, and usable through touch controls.
- Vercel is the selected hosting platform when deployment is authorized.

## Proposed event processing

This section documents a proposal, not an approved production architecture or
a validated implementation.

- PostgreSQL stores authoritative game state and durable pending events.
- Server-controlled UTC timestamps and stable event identities identify and
  order work.
- Fleet reservation, the mission, and its arrival event are persisted
  atomically.
- Dispatch intent is persisted in the same transaction through an outbox or an
  equivalent durable handoff. Workflow scheduling occurs only after commit.
- Vercel Workflows is a candidate for delayed execution and retries.
- Periodic reconciliation finds unscheduled or unfinished work.
- Resource accrual uses elapsed server time, respects capacity, and accounts
  for production changes at their effective times.

## Required correctness

Any eventual event-processing design must satisfy these unverified
requirements:

- Processing operates while players are offline.
- Retried or concurrent processing produces at most one committed gameplay
  effect for an event.
- Gameplay changes and event completion are committed together.
- The system recovers when scheduling fails after a mission is saved, and when
  a worker crashes after committing an outcome but before acknowledging it.
- Relevant earlier events are processed before later player commands.
- Events affecting shared state have defined ordering; independent workflow
  wake-up order does not determine combat results.
- Scheduled game time is distinguished from actual processing time.
- Execution is not promised at an exact wall-clock instant.

## Open decisions

- Acceptable processing delay and intended operating scale.
- Same-time event ordering and reinforcement timing.
- Vercel Workflows suitability, compatible versions, limits, and cost.
- Reconciliation frequency, runtime plan, and operational monitoring.
- Detailed concurrency controls and recovery policy.

## Planned verification

The following checks are planned and have not been executed:

- Completion while all affected players are offline.
- Duplicate delivery and concurrent processing.
- Recovery across the database-to-scheduler handoff.
- Recovery after a committed result but before acknowledgment.
- Correct ordering when an earlier event is processed late.
- Measured delay and recovery under representative load.
