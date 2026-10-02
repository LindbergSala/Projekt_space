import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"

import {
  CIVILIZATION_RESET_ERROR,
  RESET_CIVILIZATION_CONFIRMATION,
  readStrictResetConfirmation,
  resetCivilizationForUser,
} from "../lib/civilization-policy.js"
import {
  FACTION_QUERY_ERROR,
  FACTION_SELECTION_ERROR,
  factionSummaryFromStoredKey,
  queryFactionForUser,
  readStrictFactionSelection,
  selectFactionForUser,
} from "../lib/faction-policy.js"
import {
  getPlanetaryFactionSummaries,
  getPlanetaryFactionSummary,
} from "../lib/planetary-units.js"
import { ensureStarterPlanetForOwner } from "../lib/starter-planet-policy.js"
import { parseCompatibleDatabaseUrl } from "../scripts/setup-local-db-role.mjs"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIRECTORY = path.resolve(TEST_DIRECTORY, "..")
const FACTION_KEYS = getPlanetaryFactionSummaries().map((faction) => faction.key)

async function source(relativePath) {
  return readFile(path.join(ROOT_DIRECTORY, relativePath), "utf8")
}

function localPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL
  assert.equal(typeof databaseUrl, "string")
  parseCompatibleDatabaseUrl(databaseUrl)

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  })
}

function formData(entries) {
  const value = new FormData()
  for (const [name, entry] of entries) {
    value.append(name, entry)
  }
  return value
}

test("schema and migration add only the nullable constrained account faction", async () => {
  const schema = await source("prisma/schema.prisma")
  const directories = await readdir(
    path.join(ROOT_DIRECTORY, "prisma/migrations"),
    { withFileTypes: true },
  )
  const migrationDirectory = directories.find(
    (entry) => entry.isDirectory() && entry.name.endsWith("_add_user_faction"),
  )

  assert.match(schema, /factionKey\s+String\?\s+@db\.VarChar\(32\)/u)
  assert.ok(migrationDirectory)

  const migration = await source(
    `prisma/migrations/${migrationDirectory.name}/migration.sql`,
  )
  assert.match(
    migration,
    /ALTER TABLE "user" ADD COLUMN\s+"factionKey" VARCHAR\(32\);/u,
  )
  assert.match(migration, /CONSTRAINT "user_factionKey_valid" CHECK/u)
  assert.doesNotMatch(migration, /DEFAULT|NOT NULL|CREATE INDEX|UPDATE|INSERT|DELETE|DROP/iu)
  assert.equal((migration.match(/ALTER TABLE/gu) ?? []).length, 2)
  assert.equal((migration.match(/ALTER TABLE "user"/gu) ?? []).length, 2)
  assert.doesNotMatch(migration, /"planet"|"account"|"session"|"verification"/u)

  const migrationKeys = [...migration.matchAll(/'([^']+)'/gu)].map(
    (match) => match[1],
  )
  assert.deepEqual(migrationKeys, FACTION_KEYS)
  assert.equal(new Set(migrationKeys).size, 4)
})

test("canonical faction summaries and strict public form parsing fail closed", () => {
  assert.deepEqual(FACTION_KEYS, [
    "orthevan-directorate",
    "zhyreth-brood",
    "nhalorin-continuum",
    "draskyr-clans",
  ])

  for (const key of FACTION_KEYS) {
    const summary = getPlanetaryFactionSummary(key)
    assert.deepEqual(readStrictFactionSelection(formData([["factionKey", key]])), key)
    assert.deepEqual(factionSummaryFromStoredKey(key), summary)
    assert.deepEqual(Object.keys(summary), ["key", "name", "uniqueUnitNames"])
    assert.equal(summary.uniqueUnitNames.length, 2)
  }

  for (const invalid of [
    new FormData(),
    formData([["factionKey", "unknown"]]),
    formData([["factionKey", "orthevan-directorate"], ["factionKey", "draskyr-clans"]]),
    formData([["factionKey", "orthevan-directorate"], ["userId", "another-user"]]),
    formData([["ownerId", "another-user"]]),
  ]) {
    assert.throws(() => readStrictFactionSelection(invalid), {
      message: FACTION_SELECTION_ERROR,
    })
  }

  for (const invalid of ["unknown", " ORTHEVAN-DIRECTORATE", undefined]) {
    assert.throws(() => factionSummaryFromStoredKey(invalid), {
      message: FACTION_QUERY_ERROR,
    })
  }
  assert.equal(factionSummaryFromStoredKey(null), null)

  assert.equal(
    readStrictResetConfirmation(
      formData([["confirmation", RESET_CIVILIZATION_CONFIRMATION]]),
    ),
    RESET_CIVILIZATION_CONFIRMATION,
  )
  for (const invalid of [
    new FormData(),
    formData([["confirmation", "reset civilization"]]),
    formData([["confirmation", `${RESET_CIVILIZATION_CONFIRMATION} `]]),
    formData([["confirmation", RESET_CIVILIZATION_CONFIRMATION], ["userId", "other"]]),
  ]) {
    assert.throws(() => readStrictResetConfirmation(invalid), {
      message: CIVILIZATION_RESET_ERROR,
    })
  }
})

test("nullable faction query selects only factionKey and selection is locked and idempotent", async () => {
  let receivedQuery
  assert.equal(
    await queryFactionForUser({
      userId: "authenticated-user",
      userModel: {
        async findUnique(query) {
          receivedQuery = query
          return { factionKey: null }
        },
      },
    }),
    null,
  )
  assert.deepEqual(receivedQuery, {
    where: { id: "authenticated-user" },
    select: { factionKey: true },
  })

  const calls = []
  let currentFaction = null
  const prismaClient = {
    async $transaction(run) {
      return run({
        async $queryRaw() {
          calls.push("lock-user")
          return [{ factionKey: currentFaction }]
        },
        user: {
          async updateMany(query) {
            calls.push("set-faction")
            assert.deepEqual(query.where, {
              id: "authenticated-user",
              factionKey: null,
            })
            currentFaction = query.data.factionKey
            return { count: 1 }
          },
        },
      })
    },
  }

  const first = await selectFactionForUser({
    userId: "authenticated-user",
    factionKey: "orthevan-directorate",
    prismaClient,
  })
  const retry = await selectFactionForUser({
    userId: "authenticated-user",
    factionKey: "orthevan-directorate",
    prismaClient,
  })
  assert.equal(first.key, "orthevan-directorate")
  assert.deepEqual(retry, first)
  assert.deepEqual(calls, ["lock-user", "set-faction", "lock-user"])

  await assert.rejects(
    selectFactionForUser({
      userId: "authenticated-user",
      factionKey: "draskyr-clans",
      prismaClient,
    }),
    { message: FACTION_SELECTION_ERROR },
  )
})

test("pages, actions, account navigation, and gameplay gates expose no browser identity", async () => {
  const factionPage = await source("app/faction/page.js")
  const factionAction = await source("app/faction/actions.js")
  const resetPage = await source("app/civilization/reset/page.js")
  const resetAction = await source("app/civilization/reset/actions.js")
  const accountPage = await source("app/account/page.js")
  const operation = await source("lib/owned-planets.js")
  const factionOperation = await source("lib/authenticated-faction.js")
  const resetOperation = await source("lib/authenticated-civilization.js")
  const unitsPage = await source("app/units/page.js")
  const factionUnitsPage = await source("app/units/[factionKey]/page.js")

  assert.match(factionPage, /await getAuthenticatedFaction\(\)/u)
  assert.doesNotMatch(factionPage, /requireAuthenticatedFaction/u)
  assert.match(factionPage, />Choose your faction</u)
  assert.match(factionPage, />Your faction</u)
  assert.match(factionPage, /factions\.map\(\(choice\) =>/u)
  assert.match(factionPage, /choice\.uniqueUnitNames\.map/u)
  assert.match(factionPage, /action=\{selectFactionAction\}/u)
  assert.match(factionAction, /export async function selectFactionAction\(formData\)/u)
  assert.doesNotMatch(`${factionPage}\n${factionAction}`, /name=["'](?:userId|ownerId|accountId)["']/u)

  assert.match(resetPage, /await requireAuthenticatedFaction\(\)/u)
  assert.match(resetPage, /All owned planets and their names/u)
  assert.match(resetPage, /All Materials transaction history/u)
  assert.match(resetPage, /Better Auth sessions and credentials/u)
  assert.match(resetPage, /ability to choose a new faction/u)
  assert.match(resetPage, /htmlFor="reset-confirmation"/u)
  assert.match(resetPage, /name="confirmation"/u)
  assert.doesNotMatch(resetPage, /name=["'](?:userId|ownerId|planetId)["']/u)
  assert.match(resetAction, /export async function resetCivilizationAction\(formData\)/u)
  assert.match(resetOperation, /const userId = await requireAuthenticatedUserId\(\)/u)

  assert.match(accountPage, /<dt>Name<\/dt>[\s\S]*\{user\.name\}/u)
  assert.match(accountPage, /<dt>Email<\/dt>[\s\S]*\{user\.email\}/u)
  assert.match(accountPage, />Faction not selected</u)
  assert.match(accountPage, /href="\/faction"/u)
  assert.match(accountPage, /href=\{`\/units\/\$\{faction\.key\}`\}/u)
  assert.match(accountPage, /href="\/civilization\/reset"/u)

  assert.equal(
    (operation.match(/requireFactionForAuthenticatedUserId\(ownerId\)/gu) ?? []).length,
    6,
  )
  assert.match(factionOperation, /redirect\("\/faction"\)/u)
  assert.match(factionOperation, /const userId = await requireAuthenticatedUserId\(\)/u)
  for (const codexPage of [unitsPage, factionUnitsPage]) {
    assert.match(codexPage, /await requireAuthenticatedUser\(\)/u)
    assert.doesNotMatch(codexPage, /requireAuthenticatedFaction/u)
  }
})

test("local selection is permanent, concurrent, constraint-backed, and preserves existing planets", async () => {
  const prisma = localPrismaClient()
  const testId = randomUUID()
  const ownerIds = FACTION_KEYS.map((_, index) => `faction-owner-${index}-${testId}`)
  const concurrentOwnerId = `faction-concurrent-${testId}`
  const allOwnerIds = [...ownerIds, concurrentOwnerId]
  const terraId = `faction-terra-${testId}`

  try {
    const identity = await prisma.$queryRaw`
      SELECT current_user AS user_name, current_database() AS database_name
    `
    assert.deepEqual(identity, [{
      user_name: "projekt_space_app",
      database_name: "projekt_space_dev",
    }])

    const column = await prisma.$queryRaw`
      SELECT data_type, character_maximum_length, is_nullable, column_default
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'user'
         AND column_name = 'factionKey'
    `
    assert.deepEqual(column, [{
      data_type: "character varying",
      character_maximum_length: 32,
      is_nullable: "YES",
      column_default: null,
    }])

    await prisma.user.createMany({
      data: allOwnerIds.map((id) => ({
        id,
        name: "Faction lifecycle probe",
        email: `${id}@example.invalid`,
      })),
    })
    await prisma.planet.create({
      data: { id: terraId, name: "Terra", ownerId: ownerIds[0] },
    })

    for (let index = 0; index < FACTION_KEYS.length; index += 1) {
      const selected = await selectFactionForUser({
        userId: ownerIds[index],
        factionKey: FACTION_KEYS[index],
        prismaClient: prisma,
      })
      assert.equal(selected.key, FACTION_KEYS[index])
      assert.equal(
        (await queryFactionForUser({
          userId: ownerIds[index],
          userModel: prisma.user,
        })).key,
        FACTION_KEYS[index],
      )
    }

    assert.deepEqual(
      await prisma.planet.findUnique({
        where: { id: terraId },
        select: { name: true, ownerId: true },
      }),
      { name: "Terra", ownerId: ownerIds[0] },
    )
    assert.equal(
      (await selectFactionForUser({
        userId: ownerIds[0],
        factionKey: FACTION_KEYS[0],
        prismaClient: prisma,
      })).key,
      FACTION_KEYS[0],
    )
    await assert.rejects(
      selectFactionForUser({
        userId: ownerIds[0],
        factionKey: FACTION_KEYS[1],
        prismaClient: prisma,
      }),
      { message: FACTION_SELECTION_ERROR },
    )

    const concurrent = await Promise.allSettled([
      selectFactionForUser({
        userId: concurrentOwnerId,
        factionKey: FACTION_KEYS[0],
        prismaClient: prisma,
      }),
      selectFactionForUser({
        userId: concurrentOwnerId,
        factionKey: FACTION_KEYS[3],
        prismaClient: prisma,
      }),
    ])
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1)
    assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1)
    const stored = await prisma.user.findUnique({
      where: { id: concurrentOwnerId },
      select: { factionKey: true },
    })
    assert.equal([FACTION_KEYS[0], FACTION_KEYS[3]].includes(stored.factionKey), true)

    await assert.rejects(
      prisma.user.update({
        where: { id: concurrentOwnerId },
        data: { factionKey: "arbitrary-faction" },
      }),
    )
    assert.equal(
      (await prisma.user.findUnique({
        where: { id: concurrentOwnerId },
        select: { factionKey: true },
      })).factionKey,
      stored.factionKey,
    )
  } finally {
    await prisma.planet.deleteMany({ where: { ownerId: { in: allOwnerIds } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: allOwnerIds } } }).catch(() => {})
    assert.equal(await prisma.user.count({ where: { id: { in: allOwnerIds } } }), 0)
    assert.equal(await prisma.planet.count({ where: { id: terraId } }), 0)
    await prisma.$disconnect()
  }
})

test("local reset is atomic, owner-scoped, retry-safe, preserves auth, and serializes with starter creation", async () => {
  const prisma = localPrismaClient()
  const testId = randomUUID()
  const ownerId = `reset-owner-${testId}`
  const otherOwnerId = `reset-other-${testId}`
  const rollbackOwnerId = `reset-rollback-${testId}`
  const raceOwnerId = `reset-race-${testId}`
  const ownerIds = [ownerId, otherOwnerId, rollbackOwnerId, raceOwnerId]
  const planetId = `reset-planet-${testId}`
  const otherPlanetId = `reset-other-planet-${testId}`
  const rollbackPlanetId = `reset-rollback-planet-${testId}`
  const accountId = `reset-account-${testId}`
  const sessionId = `reset-session-${testId}`
  const token = `reset-token-${testId}`

  try {
    await prisma.user.createMany({
      data: ownerIds.map((id, index) => ({
        id,
        name: "Civilization reset probe",
        email: `${id}@example.invalid`,
        factionKey: FACTION_KEYS[index % FACTION_KEYS.length],
      })),
    })
    await prisma.account.create({
      data: {
        id: accountId,
        accountId: ownerId,
        providerId: "credential",
        userId: ownerId,
        password: "synthetic-hashed-password",
      },
    })
    await prisma.session.create({
      data: {
        id: sessionId,
        token,
        userId: ownerId,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      },
    })
    await prisma.planet.createMany({
      data: [
        { id: planetId, name: "Reset Prime", materials: 8n, ownerId },
        { id: otherPlanetId, name: "Other Prime", materials: 5n, ownerId: otherOwnerId },
        { id: rollbackPlanetId, materials: 3n, ownerId: rollbackOwnerId },
      ],
    })
    await prisma.planetMaterialTransaction.createMany({
      data: [
        { id: `reset-ledger-${testId}`, planetId, delta: 8n, balanceAfter: 8n },
        { id: `reset-other-ledger-${testId}`, planetId: otherPlanetId, delta: 5n, balanceAfter: 5n },
        { id: `reset-rollback-ledger-${testId}`, planetId: rollbackPlanetId, delta: 3n, balanceAfter: 3n },
      ],
    })
    await prisma.planetUnitStack.createMany({
      data: [
        { planetId, unitKey: "line-infantry", quantity: 8n },
        { planetId: otherPlanetId, unitKey: "line-infantry", quantity: 5n },
        { planetId: rollbackPlanetId, unitKey: "line-infantry", quantity: 3n },
      ],
    })
    await prisma.planetUnitTransaction.createMany({
      data: [
        {
          id: `reset-unit-ledger-${testId}`,
          planetId,
          unitKey: "line-infantry",
          delta: 8n,
          quantityAfter: 8n,
        },
        {
          id: `reset-other-unit-ledger-${testId}`,
          planetId: otherPlanetId,
          unitKey: "line-infantry",
          delta: 5n,
          quantityAfter: 5n,
        },
        {
          id: `reset-rollback-unit-ledger-${testId}`,
          planetId: rollbackPlanetId,
          unitKey: "line-infantry",
          delta: 3n,
          quantityAfter: 3n,
        },
      ],
    })

    for (const confirmation of ["reset civilization", `${RESET_CIVILIZATION_CONFIRMATION} `]) {
      await assert.rejects(
        resetCivilizationForUser({ userId: ownerId, confirmation, prismaClient: prisma }),
        { message: CIVILIZATION_RESET_ERROR },
      )
    }
    assert.equal(await prisma.planet.count({ where: { ownerId } }), 1)
    assert.equal(await prisma.planetMaterialTransaction.count({ where: { planetId } }), 1)
    assert.equal(await prisma.planetUnitStack.count({ where: { planetId } }), 1)
    assert.equal(await prisma.planetUnitTransaction.count({ where: { planetId } }), 1)

    await resetCivilizationForUser({
      userId: ownerId,
      confirmation: RESET_CIVILIZATION_CONFIRMATION,
      prismaClient: prisma,
    })
    assert.equal(await prisma.planetMaterialTransaction.count({ where: { planetId } }), 0)
    assert.equal(await prisma.planetUnitStack.count({ where: { planetId } }), 0)
    assert.equal(await prisma.planetUnitTransaction.count({ where: { planetId } }), 0)
    assert.equal(await prisma.planet.count({ where: { ownerId } }), 0)
    assert.equal((await prisma.user.findUnique({ where: { id: ownerId } })).factionKey, null)
    assert.equal(await prisma.account.count({ where: { id: accountId, userId: ownerId } }), 1)
    assert.equal(
      await prisma.account.count({
        where: { id: accountId, password: "synthetic-hashed-password" },
      }),
      1,
    )
    assert.equal(await prisma.session.count({ where: { id: sessionId, token } }), 1)

    assert.equal(await prisma.planet.count({ where: { id: otherPlanetId } }), 1)
    assert.equal(await prisma.planetMaterialTransaction.count({ where: { planetId: otherPlanetId } }), 1)
    assert.equal(await prisma.planetUnitStack.count({ where: { planetId: otherPlanetId } }), 1)
    assert.equal(
      await prisma.planetUnitTransaction.count({ where: { planetId: otherPlanetId } }),
      1,
    )
    assert.equal(
      (await prisma.user.findUnique({ where: { id: otherOwnerId } })).factionKey,
      FACTION_KEYS[1],
    )

    await resetCivilizationForUser({
      userId: ownerId,
      confirmation: RESET_CIVILIZATION_CONFIRMATION,
      prismaClient: prisma,
    })
    assert.equal(await prisma.planet.count({ where: { ownerId: otherOwnerId } }), 1)

    const failingClient = {
      async $transaction(run) {
        return prisma.$transaction(async (transaction) => run({
          $queryRaw: (...args) => transaction.$queryRaw(...args),
          planetUnitTransaction: {
            deleteMany: transaction.planetUnitTransaction.deleteMany.bind(
              transaction.planetUnitTransaction,
            ),
          },
          planetUnitStack: {
            deleteMany: transaction.planetUnitStack.deleteMany.bind(
              transaction.planetUnitStack,
            ),
          },
          planetConstruction: transaction.planetConstruction,
          planetRecruitment: transaction.planetRecruitment,
          planetMaterialTransaction: {
            deleteMany: transaction.planetMaterialTransaction.deleteMany.bind(
              transaction.planetMaterialTransaction,
            ),
          },
          planet: {
            findMany: transaction.planet.findMany.bind(transaction.planet),
            async deleteMany(query) {
              await transaction.planet.deleteMany(query)
              throw new Error("synthetic rollback probe")
            },
          },
          user: {
            updateMany: transaction.user.updateMany.bind(transaction.user),
          },
        }))
      },
    }
    await assert.rejects(
      resetCivilizationForUser({
        userId: rollbackOwnerId,
        confirmation: RESET_CIVILIZATION_CONFIRMATION,
        prismaClient: failingClient,
      }),
      { message: CIVILIZATION_RESET_ERROR },
    )
    assert.equal(await prisma.planet.count({ where: { id: rollbackPlanetId } }), 1)
    assert.equal(
      await prisma.planetMaterialTransaction.count({ where: { planetId: rollbackPlanetId } }),
      1,
    )
    assert.equal(
      await prisma.planetUnitStack.count({ where: { planetId: rollbackPlanetId } }),
      1,
    )
    assert.equal(
      await prisma.planetUnitTransaction.count({ where: { planetId: rollbackPlanetId } }),
      1,
    )
    assert.notEqual(
      (await prisma.user.findUnique({ where: { id: rollbackOwnerId } })).factionKey,
      null,
    )

    await selectFactionForUser({
      userId: ownerId,
      factionKey: FACTION_KEYS[3],
      prismaClient: prisma,
    })
    const freshPlanetId = await ensureStarterPlanetForOwner({ ownerId, prismaClient: prisma })
    assert.equal(await prisma.planet.count({ where: { id: freshPlanetId, ownerId } }), 1)

    const race = await Promise.allSettled([
      ensureStarterPlanetForOwner({ ownerId: raceOwnerId, prismaClient: prisma }),
      resetCivilizationForUser({
        userId: raceOwnerId,
        confirmation: RESET_CIVILIZATION_CONFIRMATION,
        prismaClient: prisma,
      }),
    ])
    assert.equal(race.some((result) => result.status === "fulfilled"), true)
    assert.equal(
      (await prisma.user.findUnique({
        where: { id: raceOwnerId },
        select: { factionKey: true },
      })).factionKey,
      null,
    )
    assert.equal(await prisma.planet.count({ where: { ownerId: raceOwnerId } }), 0)
  } finally {
    const planets = await prisma.planet.findMany({
      where: { ownerId: { in: ownerIds } },
      select: { id: true },
    }).catch(() => [])
    await prisma.planetUnitTransaction.deleteMany({
      where: { planetId: { in: planets.map((planet) => planet.id) } },
    }).catch(() => {})
    await prisma.planetUnitStack.deleteMany({
      where: { planetId: { in: planets.map((planet) => planet.id) } },
    }).catch(() => {})
    await prisma.planetMaterialTransaction.deleteMany({
      where: { planetId: { in: planets.map((planet) => planet.id) } },
    }).catch(() => {})
    await prisma.planet.deleteMany({ where: { ownerId: { in: ownerIds } } }).catch(() => {})
    await prisma.session.deleteMany({ where: { userId: { in: ownerIds } } }).catch(() => {})
    await prisma.account.deleteMany({ where: { userId: { in: ownerIds } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: ownerIds } } }).catch(() => {})

    assert.equal(await prisma.planet.count({ where: { ownerId: { in: ownerIds } } }), 0)
    assert.equal(await prisma.session.count({ where: { userId: { in: ownerIds } } }), 0)
    assert.equal(await prisma.account.count({ where: { userId: { in: ownerIds } } }), 0)
    assert.equal(await prisma.user.count({ where: { id: { in: ownerIds } } }), 0)
    await prisma.$disconnect()
  }
})
