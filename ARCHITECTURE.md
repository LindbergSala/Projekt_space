# Architecture

## Confirmed foundation

- The approved application stack is Next.js with JavaScript, PostgreSQL, and
  Prisma.
- Player journeys and interfaces are mobile-first, responsive on larger
  screens, and usable through touch controls.
- Vercel is the selected hosting platform when deployment is authorized.

## Confirmed Materials production

- Passive Materials production is computed per planet from a persisted
  `materialsProductionCursor` and authoritative PostgreSQL time.
- The level-0 rate is 10 Materials per completed hour (Orthevan 11). Each
  completed Extractor level adds another base rate, up to 60/66 at level 5.
- Each planet stores at most 72 completed hours of unclaimed production. There
  is no Materials capacity.
- Ordinary claims advance the cursor by only the completed claimed hours, so
  sub-hour progress is preserved. Claims at or beyond the cap award exactly 72
  hours and reset the cursor to current database time. These are the first 72
  earned hours after the cursor; subsequent over-cap time is discarded.
- Historical Extractor completion timestamps partition those credited hours.
  Exact `bigint` rate × interval-milliseconds sums preserve a fractional
  numerator in `Planet.materialsProductionRemainder`, bounded to [0, 3600000).
  Whole Materials use integer division by 3600000. The remainder survives both
  ordinary and capped claims; completion never retroactively boosts production.
- Status reads are read-only. Claims are explicit server commands that derive
  ownership, faction, time, rate, delta, and resulting balance on the server.
  The User and owned Planet are locked in that order; balance, cursor, remainder and one
  immutable Materials-ledger row commit atomically.
- This system deliberately requires no scheduled job, polling process, queue,
  or background worker. It does not resolve the broader event-processing
  architecture below.

## Confirmed timed planet infrastructure

- The approved rules live in `PROJECT_SPACE_INFRASTRUCTURE_CANON.md` and the
  shared executable registry `lib/planet-infrastructure.js`. Command starts at
  level 1, all other facilities at 0. The baseline is implicit; migrations and
  starter creation fabricate no paid construction or resource history.
- `PlanetConstruction` is both the paid order and durable level history:
  building key, preceding/target level, cost, database-derived start and finish,
  owner-scoped operation identity and planet relation. Unique planet/building/
  target-level indexing prevents duplicate transitions; checks constrain known
  buildings, one-step levels, positive cost and increasing timestamps.
- Commands lock User then the owned Planet, verify its random incarnation UUID
  (`infrastructureEpoch`), derive faction and canonical requirements, and allow
  only one active work item. Different planets can have overlapping work.
  Debit, construction and one negative resource-ledger row commit together.
  Unclaimed production never pays a construction bill.
- The operation identity hashes authenticated owner + validated intent UUID.
  Exact replay returns the saved order before busy/level checks, including after
  completion. Reusing it for different intent fails. Expected-level intent
  prevents an old form from accidentally ordering the following level. Reset
  removes transitions before the planet; a fresh incarnation rejects old forms
  even if its deterministic starter ID is reused.
- Completed levels are a pure projection of saved completion timestamps against
  PostgreSQL time. Historical Command requirements, canonical costs/durations
  and nonoverlapping transitions are validated. A future transition preserves
  the old effective level until its exact saved millisecond. No read finalizes
  an order or moves its completion time.
- Detail and Command Center each read faction and planet/history data in one
  RepeatableRead snapshot. A single database clock value, captured after the
  first snapshot read, evaluates both infrastructure and resource production.
  Separate HTTP requests can naturally observe different times. Page refresh
  updates the presentation; clients never authorize completion.
- Unit/ship unlocks are descriptive eligibility only. Recruitment, ship
  production, transport and combat are not implemented. Factory time bonuses
  are recorded for future orders and do not change building durations.

This bounded timestamp model requires no scheduler and does not resolve the
shared-world event ordering and offline combat proposal below.

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
