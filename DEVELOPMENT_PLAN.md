# Development Plan

This plan defines the overall dependency-aware delivery order. Every milestone
must be divided into bounded implementation tasks that are reviewed and
verified independently. Planned milestones do not represent approved gameplay
rules, infrastructure choices, or completed work.

## Verification principles

Security and relevant verification apply throughout the plan. Server-side code
must remain authoritative, enforce ownership and authorization, validate input,
and preserve transaction correctness. Each task must include meaningful tests
or other appropriate evidence for the behavior and risk it introduces.

Event processing is not complete until ordering, retries, concurrency, and
recovery have been verified. Production readiness requires representative load
validation, operational monitoring evidence, and demonstrated backup
restoration.

## Milestones

### 0. Application foundation — Completed

- **Goal:** Provide the reviewed Next.js App Router and JavaScript foundation.
- **Prerequisites:** Confirmed stack, mobile-first direction, and local runtime.
- **Acceptance gate:** Installation, lint, build, development and production
  HTTP checks, and user-reported mobile, wider-screen, zoom, and console checks
  passed. Committed as `4986a3e`.

### 1. Local PostgreSQL and Prisma foundation — Planned

- **Goal:** Establish a reproducible local PostgreSQL connection and minimal
  Prisma integration without gameplay models.
- **Prerequisites:** Completed application foundation and verified local
  compatibility evidence.
- **Acceptance gate:** Documented setup works from a clean local state; Prisma
  can connect and perform a harmless verified database operation without
  exposing secrets.

### 2. Authentication and authorization — Planned

- **Goal:** Establish player identity and reusable server-side authorization.
- **Prerequisites:** Milestone 1.
- **Acceptance gate:** Authenticated and unauthenticated flows are verified;
  server-side ownership checks reject unauthorized access regardless of client
  input.

### 3. World, planets, and resources — Planned

- **Goal:** Represent world structure, planet ownership, and authoritative
  resource accounting.
- **Prerequisites:** Milestones 1 and 2.
- **Acceptance gate:** Persistence, ownership boundaries, resource invariants,
  capacity behavior, and transactional updates have meaningful tests.

### 4. Reliable offline event processing — Planned

- **Goal:** Process durable game events while players are offline.
- **Prerequisites:** Milestone 3 and an approved event architecture derived
  from [ARCHITECTURE.md](ARCHITECTURE.md).
- **Acceptance gate:** Ordering, idempotent effects, retries, concurrency,
  database-to-runner handoff, reconciliation, and crash recovery are verified.
  Production tooling remains unresolved until separately approved.

### 5. Timed progression — Planned

- **Goal:** Support timed construction, research, and unit production.
- **Prerequisites:** Milestones 3 and 4.
- **Acceptance gate:** Server-authoritative queues and completion are verified
  across elapsed time, capacity changes, retries, concurrency, and offline use.

### 6. Fleets, transport, and travel — Planned

- **Goal:** Support fleet composition, troop and cargo transport, and travel.
- **Prerequisites:** Milestones 3 through 5.
- **Acceptance gate:** Ownership, reservation, dispatch, arrival, and resource
  changes are transactional and verified against duplicate or concurrent
  commands.

### 7. Simulated orbital combat — Planned

- **Goal:** Resolve server-controlled orbital combat before troop landings.
- **Prerequisites:** Milestones 4 and 6 plus separately approved combat rules.
- **Acceptance gate:** Deterministic inputs, event ordering, authorization, and
  exactly-once committed outcomes are covered by meaningful tests.

### 8. Ground combat, plunder, and conquest — Planned

- **Goal:** Resolve troop landings, ground combat, plunder, and ownership
  transfer.
- **Prerequisites:** Milestone 7 plus separately approved ground-combat rules.
- **Acceptance gate:** Orbital prerequisites, troop and resource accounting,
  ownership transitions, retries, and concurrent actions are verified.

### 9. Alliances — Planned

- **Goal:** Add alliance membership and authorized cooperative interactions.
- **Prerequisites:** Milestones 2, 3, 6, 7, and 8.
- **Acceptance gate:** Membership lifecycle, permissions, ownership boundaries,
  and concurrent membership changes have meaningful tests.

### 10. Production readiness and Vercel deployment — Planned

- **Goal:** Prepare the complete verified game for an explicitly authorized
  Vercel deployment.
- **Prerequisites:** All required gameplay milestones and approved production
  database and event-processing plans.
- **Acceptance gate:** Security review, representative load validation,
  monitoring and recovery evidence, successful backup restoration, deployment
  validation, and operational documentation are complete.

## Immediate next task

Inspect the existing local PostgreSQL development prerequisites and recommend a
setup compatible with the current runtime and Prisma. Gather actual environment
evidence and official compatibility information before installing anything; do
not install or configure PostgreSQL or Prisma during that inspection.
