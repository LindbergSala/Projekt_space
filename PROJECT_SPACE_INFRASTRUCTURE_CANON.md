# Planetary infrastructure canon

These rules were approved by the project owner on 2026-10-02. The executable
registry is `lib/planet-infrastructure.js`; server commands and presentation
derive costs, durations, requirements, effects, and unlocks from that registry.
The existing `lib/planetary-units.js` remains authoritative for faction and
ground-unit keys, names, roles, and rosters.

## Buildings and progression

A planet has at most one of each building. Level 0 means absent; completed
levels are 1 through 5. Every existing and newly created planet begins with
Planetary Command level 1 and all other buildings absent. This baseline does
not create a paid order or fabricate economic history. Starting Materials
remain zero, so the first Extractor requires the first complete production hour.

Each order advances exactly one level. Only one construction or upgrade may
be active per planet; separate planets can build concurrently. Stored Materials
are paid when the order starts. Unclaimed production cannot fund an order.
The completed level remains effective during an upgrade. The new level becomes
effective at its persisted completion time, including while the player is
offline; no collection command is required.

Command level 1 allows Materials Extractor and Barracks, level 2 also allows
War Factory, and level 3 also allows Space Station. Every non-Command building's
target level requires a completed Command level of at least that level, as well
as its building-specific unlock. Command itself upgrades from its preceding
completed level. Command level 1 is a free baseline, never a buildable order.

| Key | Building | Initial level | Minimum Command level |
| --- | --- | ---: | ---: |
| `planetary-command` | Planetary Command | 1 | Baseline |
| `materials-extractor` | Materials Extractor | 0 | 1 |
| `barracks` | Barracks | 0 | 1 |
| `war-factory` | War Factory | 0 | 2 |
| `space-station` | Space Station | 0 | 3 |

Costs are exact integer Materials for the step to the target level:

| Building | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Planetary Command | Included | 50 | 100 | 200 | 400 |
| Materials Extractor | 10 | 20 | 40 | 80 | 160 |
| Barracks | 20 | 40 | 80 | 160 | 320 |
| War Factory | 50 | 100 | 200 | 400 | 800 |
| Space Station | 100 | 200 | 400 | 800 | 1600 |

Durations replace the earlier proposed doubling rule. Registry durations use
exact integer seconds; persisted start and completion timestamps are separated
by exactly that duration. A day means 86,400 seconds.

| Building | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Planetary Command | Included | 30 minutes | 4 hours | 1 day | 3 days |
| Materials Extractor | 1 minute | 30 minutes | 4 hours | 1 day | 3 days |
| Barracks | 2 minutes | 1 hour | 6 hours | 2 days | 5 days |
| War Factory | 5 minutes | 2 hours | 12 hours | 3 days | 7 days |
| Space Station | 10 minutes | 4 hours | 1 day | 5 days | 14 days |

## Materials Extractor

| Completed level | Other factions, Materials/hour | Orthevan Directorate, Materials/hour |
| --- | ---: | ---: |
| 0 | 10 | 11 |
| 1 | 20 | 22 |
| 2 | 30 | 33 |
| 3 | 40 | 44 |
| 4 | 50 | 55 |
| 5 | 60 | 66 |

Orthevan's bonus applies to the entire production rate. Each new rate starts
at the saved completion time, never at the later page read or next claim.

Claims remain manual and cover complete elapsed hours measured from the saved
production cursor. Within those hours, production is integrated across every
Extractor completion boundary with exact `bigint` arithmetic:

`numerator = savedRemainder + sum(ratePerHour * intervalMilliseconds)`

The claim credits `numerator / 3600000` whole Materials and stores
`numerator % 3600000` for the next claim. The remainder is an integer numerator
in Materials-milliseconds, not a new balance or spendable Materials. Its valid
range is 0 through 3,599,999. For example, Orthevan production with 30 minutes
at level 0 and 30 minutes at level 1 earns 16 Materials and carries a 1,800,000
remainder (half a Material). A later claim preserves that value exactly.

An ordinary claim moves the cursor forward by its claimed whole hours; partial
hour progress remains pending. At or beyond 72 complete hours, storage contains
the **first 72 earned hours after the cursor**, and production after that window
is discarded. A capped claim resets the cursor to database time and discards
over-cap and partial elapsed time, preserving the old cap/cursor behavior. It
still retains fractional Materials earned inside the credited window. A later
Extractor completion outside that window cannot retrospectively raise stored
production. Displayed current production uses the level effective at the read's
database timestamp even when storage is full.

The complete ascending transition history is required for calculation, including
transitions before the cursor. Future transitions may be present but have no
effect before their timestamp. No transition history and a zero remainder yield
the previous Materials amounts and cursor behavior exactly.

## Unit and ship unlocks

Unlocks are cumulative. This delivery displays eligibility only; recruitment,
unit production, ship production, transport, and combat are unavailable. No ship
statistics or unit cost/base-time values are invented.

| Barracks level | General unit |
| --- | --- |
| 1 | Line Infantry (`line-infantry`) |
| 2 | Assault Infantry (`assault-infantry`) |
| 3 | Heavy Weapons Infantry (`heavy-weapons-infantry`) |
| 4 | Combat Engineer (`combat-engineer`) |

| War Factory level | General unit or effect |
| --- | --- |
| 1 | Light Tank (`light-tank`) |
| 2 | Field Artillery (`field-artillery`) |
| 3 | Heavy Tank (`heavy-tank`) |
| 4 | New factory unit orders take 90% of their base production time |
| 5 | New factory unit orders take 80% of their base production time |

Factory time reductions are not cumulative, do not affect Materials costs,
and apply only to future unit orders after the building upgrade completes.
This rule is recorded for eventual unit production; construction durations
above never receive the factory time reduction.

| Canonical faction | Barracks level 5 | War Factory level 5 |
| --- | --- | --- |
| Orthevan Directorate (`orthevan-directorate`) | Vanguard Exosuit (`vanguard-exosuit`) | Siege Strider (`siege-strider`) |
| Zhyreth Brood (`zhyreth-brood`) | Razor Beast (`razor-beast`) | Spore Caster (`spore-caster`) |
| Nhalorin Continuum (`nhalorin-continuum`) | Phase Reaper (`phase-reaper`) | Aegis Construct (`aegis-construct`) |
| Draskyr Clans (`draskyr-clans`) | Scrap Brute (`scrap-brute`), Rift Raider (`rift-raider`) | No additional unit; time reduction still applies |

| Space Station level | Ships |
| --- | --- |
| 1 | Scout Corvette; Cargo / Trade Freighter |
| 2 | Escort Frigate; Troop Transport; Supply Ship |
| 3 | Attack Destroyer; Assault Lander; Vehicle Carrier |
| 4 | Carrier Ship; Repair Tender |
| 5 | Capital Battleship |

## Authority and persistence boundaries

PostgreSQL time and persisted level transitions determine completion. Reads
evaluate those transitions without writing. A client countdown is presentation
only; native forms and reloads work without JavaScript. An accepted build must
atomically store its order, debit the balance, and append one negative Materials
ledger row, under the existing User-to-Planet lock order and server-derived
ownership/faction. Exact retries are idempotent even after completion, and
conflicting reuse fails. Reset removes the planet's orders/history and invalidates
old civilization references even when a starter planet ID is reused.

This bounded timestamp model does not select a scheduler or resolve offline
combat, shared-world event ordering, or the broader background-event design.
