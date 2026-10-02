# Timed Line Infantry recruitment canon

These rules were approved by the project owner on 2026-10-02. The shared
executable production registry is `lib/unit-production.js`. Unit and faction
names and membership come from the existing `lib/planetary-units.js` roster;
building names and levels remain defined in `lib/planet-infrastructure.js`.

## Available production

| Unit | Completed building required | Materials per unit | Seconds per unit |
| --- | --- | ---: | ---: |
| Line Infantry (`line-infantry`) | Barracks level 1 | 10 | 300 |

All four canonical factions use exactly these values. Higher Barracks levels
retain access but do not reduce the cost or duration. War Factory time bonuses
do not apply to Barracks recruitment. Other ground units and all ships remain
unavailable for production; their infrastructure unlocks describe future
eligibility. This delivery introduces no combat, transport, upkeep, discount,
faction bonus, waiting queue, cancellation, refund, or partial delivery.

One Line Infantry costs 10 Materials and takes exactly five minutes. Ten cost
100 Materials and take 3,000 seconds (50 minutes). The complete batch becomes
ready simultaneously. Only stored Materials can pay the full cost at acceptance;
unclaimed production is neither claimed nor spent by recruitment.

There is one uncollected recruitment order per planet. A ready order continues
to occupy that slot. Different planets can recruit concurrently. A planet can
recruit and construct infrastructure at the same time, subject to each operation
paying its own full bill from the same locked stored balance.

## Order lifecycle

- **Recruiting:** the order is accepted and paid; PostgreSQL time is before its
  saved `completesAt` timestamp.
- **Ready to collect:** PostgreSQL time is at or after `completesAt`; the whole
  batch can be collected, but it is not yet part of planetary forces.
- **Collected:** an explicit authenticated command delivered the full batch to
  the existing Line Infantry stack, appended its unit ledger row, and saved
  `collectedAt` in one transaction.

Completion uses authoritative database time at millisecond precision. Offline
time has the same effect as time with an open page. A GET or render only projects
status; it never creates units, completes an order by writing, or charges a
balance. There is no scheduler, background worker, automatic client mutation,
or requirement to keep a browser open. The normal forms and reloads work without
JavaScript. Pending recruits are excluded from force totals until collection.

The accepted quantity, total price, start and completion timestamps are saved.
Projection and retries use those saved values, even if a future production rule
changes. They do not move the finish time or reprice an existing order. Collected
orders remain as history until civilization reset.

## Authority, atomicity, and retries

Start accepts only `planetId`, `infrastructureEpoch`, a canonical positive decimal
`quantity`, and an intent UUID `operationKey`. Collect accepts only planet, epoch,
and the saved order identity. String-valued Next.js `$ACTION_` metadata is ignored
for application intent; duplicate fields, files, unexpected application fields,
signed or decimal quantities, exponent notation and leading zeros are rejected.
The server derives ownership, faction, unit, requirements, price and timestamps.

Both commands lock the authenticated User and then its owned Planet. The current
faction and the planet's existing `infrastructureEpoch` are checked before an
idempotent replay can return. Start commits the debit, order and exactly one
negative Materials ledger row together; it creates no units. Collect commits
the stock increase, exactly one positive unit ledger row and `collectedAt`
together; it charges no additional Materials. Any failure rolls back the whole
operation. The partial unique order index enforces at most one uncollected order
per planet independently of application checks.

An owner-scoped, domain-separated hash of the start intent UUID identifies an
order. An exact retry returns its saved order without paying again, including
after completion or collection. Conflicting reuse is rejected before starting
anything else. Delivery has a deterministic identity derived from that saved
order, so retries and concurrent Collect requests cannot deliver twice. A ready
order does not prevent an exact retry from recognizing its original start.

Quantities, cost multiplication and resulting stock use `bigint`. Quantity and
cost must fit positive PostgreSQL `BIGINT`; the resulting stock must fit its
nonnegative range. Duration arithmetic remains integer throughout, including
milliseconds, and completion must be no later than
`9999-12-31T23:59:59.999Z` (253,402,300,799,999 milliseconds since the Unix epoch).
The local Prisma PostgreSQL adapter round-trips that final millisecond exactly,
but cannot round-trip extended ISO years starting at 10000; JavaScript's broader
Date range therefore is not sufficient. Values that exceed either stock, cost,
duration or timestamp bounds are rejected before a debit; inputs are never
clipped or rounded. Stock capacity is checked again
during collection because another authorized unit transaction may have run
while the order was recruiting.

Reset deletes the owner's recruitment history before its planets in the same
existing reset transaction. Authentication and other owners remain intact.
Reusing the established random planet epoch prevents stale start and Collect
forms from affecting a new civilization, even when its starter planet reuses
the same deterministic identifier.

This bounded manual collection lifecycle does not decide the broader scheduler,
shared-world event ordering or offline combat architecture.
