import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"

import {
  MATERIALS_PRODUCTION_CLAIM_ERROR,
  claimPlanetMaterialsProductionForOwner,
  readStrictMaterialsProductionClaim,
} from "../lib/materials-production-claim-policy.js"
import { parseCompatibleDatabaseUrl } from "../scripts/setup-local-db-role.mjs"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIRECTORY = path.resolve(TEST_DIRECTORY, "..")
const HOUR = 3_600_000

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

test("claim form parsing accepts exactly one valid planet id", () => {
  const valid = new FormData()
  valid.set("planetId", "planet-owned")
  assert.deepEqual(readStrictMaterialsProductionClaim(valid), {
    planetId: "planet-owned",
  })

  const invalidClaims = [new FormData(), new FormData(), new FormData()]
  invalidClaims[0].set("planetId", " planet-owned")
  invalidClaims[1].set("planetId", "planet-owned")
  invalidClaims[1].set("returnTo", "/account")
  invalidClaims[2].append("planetId", "planet-one")
  invalidClaims[2].append("planetId", "planet-two")

  for (const formData of invalidClaims) {
    assert.throws(
      () => readStrictMaterialsProductionClaim(formData),
      { message: MATERIALS_PRODUCTION_CLAIM_ERROR },
    )
  }
})

test("claim parsing ignores action metadata and returns only the application planet id", () => {
  for (const metadataFirst of [true, false]) {
    const formData = new FormData()
    if (!metadataFirst) formData.append("planetId", "planet-owned")
    formData.append("$ACTION_ID_synthetic", "")
    formData.append("$ACTION_REF_synthetic", "")
    formData.append("$ACTION_synthetic:0", '{"id":"synthetic","bound":null}')
    formData.append("$ACTION_ownerId", "other-owner")
    formData.append("$ACTION_planetId", "other-planet")
    formData.append("$ACTION_balanceAfter", "999999999999999999")
    formData.append("$ACTION_claimableMaterials", "999999")
    if (metadataFirst) formData.append("planetId", "planet-owned")
    assert.deepEqual(readStrictMaterialsProductionClaim(formData), {
      planetId: "planet-owned",
    })
  }
})

test("metadata never relaxes claim validation or permits uploaded files", () => {
  const invalidEntries = [
    [],
    [["$ACTION_planetId", "planet-owned"]],
    [["planetId", ""]],
    [["planetId", " planet-owned"]],
    [["planetId", "planet-owned "]],
    [["planetId", "x".repeat(129)]],
    [["planetId", new File(["planet-owned"], "planet.txt")]],
    [["planetId", "planet-owned"], ["planetId", "planet-owned"]],
    [["planetId", "planet-owned"], ["planetId", "other-planet"]],
    [["planetId", "planet-owned"], ["$ACTION_file", new File(["ignored"], "metadata.txt")]],
    ...["ownerId", "factionKey", "materials", "balanceAfter", "ratePerHour",
      "claimableMaterials", "currentTime", "materialsProductionCursor", "returnTo",
      "$ACTION", "$action_ID_synthetic", "prefix$ACTION_ID_synthetic",
    ].map((name) => [["planetId", "planet-owned"], [name, "untrusted"]]),
  ]
  for (const entries of invalidEntries) {
    const formData = new FormData()
    formData.append("$ACTION_ID_synthetic", "")
    for (const [name, value] of entries) formData.append(name, value)
    assert.throws(() => readStrictMaterialsProductionClaim(formData), {
      message: MATERIALS_PRODUCTION_CLAIM_ERROR,
    })
  }
})

test("zero-hour claim locks user then planet, uses database time, and writes nothing", async () => {
  const currentTime = new Date("2026-10-01T12:00:00.000Z")
  const calls = []
  const result = await claimPlanetMaterialsProductionForOwner({
    ownerId: "owner",
    planetId: "planet",
    prismaClient: {
      async $transaction(run) {
        return run({
          async $queryRaw(strings) {
            const sql = strings.join("?")
            calls.push(sql)
            if (sql.includes('FROM "user"')) {
              return [{ factionKey: "orthevan-directorate" }]
            }
            if (sql.includes('FROM "planet"')) {
              return [{
                id: "planet",
                materials: 99n,
                materialsProductionCursor: currentTime,
              }]
            }
            return [{ currentTime }]
          },
          planet: {
            async updateMany() {
              assert.fail("zero-hour claim must not update the planet")
            },
          },
          planetMaterialTransaction: {
            async create() {
              assert.fail("zero-hour claim must not create a ledger row")
            },
          },
        })
      },
    },
  })

  assert.match(calls[0], /FROM "user"[\s\S]*FOR UPDATE/u)
  assert.match(calls[1], /FROM "planet"[\s\S]*FOR UPDATE/u)
  assert.match(calls[2], /clock_timestamp\(\)/u)
  assert.deepEqual(result, {
    planetId: "planet",
    claimedMaterials: "0",
    balanceAfter: "99",
    production: {
      ratePerHour: "11",
      availableMaterials: "0",
      claimableHours: "0",
      maximumStoredHours: "72",
      isCapped: false,
      nextProductionAt: "2026-10-01T13:00:00.000Z",
    },
  })
})

test("claim actions expose only the server-owned planet id boundary", async () => {
  const planetActions = await source("app/planets/actions.js")
  const commandActions = await source("app/civilization/actions.js")
  const policy = await source("lib/materials-production-claim-policy.js")

  for (const actions of [planetActions, commandActions]) {
    assert.match(actions, /^"use server"/u)
    assert.match(actions, /readStrictMaterialsProductionClaim\(formData\)/u)
    assert.doesNotMatch(
      actions,
      /ratePerHour|availableMaterials|claimableHours|balanceAfter|factionKey|currentTime/u,
    )
  }
  assert.match(policy, /SELECT "factionKey"[\s\S]*FOR UPDATE/u)
  assert.match(policy, /SELECT "id", "materials", "materialsProductionCursor"[\s\S]*FOR UPDATE/u)
  assert.match(policy, /SELECT clock_timestamp\(\) AS "currentTime"/u)
  assert.match(policy, /planetMaterialTransaction\.create/u)
  assert.doesNotMatch(policy, /Date\.now\(|new Date\(\)/u)
})

test("local claims preserve partial hours, cap offline time, and serialize concurrency", async () => {
  const prisma = localPrismaClient()
  const testId = randomUUID()
  const ownerId = `production-owner-${testId}`
  const otherOwnerId = `production-other-${testId}`
  const partialPlanetId = `production-partial-${testId}`
  const cappedPlanetId = `production-capped-${testId}`
  const concurrentPlanetId = `production-concurrent-${testId}`
  const planetIds = [partialPlanetId, cappedPlanetId, concurrentPlanetId]

  try {
    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          name: "Production Owner",
          email: `${ownerId}@example.invalid`,
          factionKey: "orthevan-directorate",
        },
        {
          id: otherOwnerId,
          name: "Production Other",
          email: `${otherOwnerId}@example.invalid`,
          factionKey: "zhyreth-brood",
        },
      ],
    })
    const [{ currentTime }] = await prisma.$queryRaw`
      SELECT clock_timestamp() AS "currentTime"
    `
    const partialCursor = new Date(currentTime.getTime() - 1.5 * HOUR)
    const cappedCursor = new Date(currentTime.getTime() - 80.5 * HOUR)
    const concurrentCursor = new Date(currentTime.getTime() - 2.5 * HOUR)
    await prisma.planet.createMany({
      data: [
        {
          id: partialPlanetId,
          ownerId,
          materials: 5n,
          materialsProductionCursor: partialCursor,
        },
        {
          id: cappedPlanetId,
          ownerId,
          materials: 0n,
          materialsProductionCursor: cappedCursor,
        },
        {
          id: concurrentPlanetId,
          ownerId,
          materials: 0n,
          materialsProductionCursor: concurrentCursor,
        },
      ],
    })

    const partial = await claimPlanetMaterialsProductionForOwner({
      ownerId,
      planetId: partialPlanetId,
      prismaClient: prisma,
    })
    assert.equal(partial.claimedMaterials, "11")
    assert.equal(partial.balanceAfter, "16")
    assert.deepEqual(
      await prisma.planet.findUnique({
        where: { id: partialPlanetId },
        select: { materials: true, materialsProductionCursor: true },
      }),
      {
        materials: 16n,
        materialsProductionCursor: new Date(partialCursor.getTime() + HOUR),
      },
    )

    const capped = await claimPlanetMaterialsProductionForOwner({
      ownerId,
      planetId: cappedPlanetId,
      prismaClient: prisma,
    })
    assert.equal(capped.claimedMaterials, "792")
    const cappedPlanet = await prisma.planet.findUnique({
      where: { id: cappedPlanetId },
      select: { materials: true, materialsProductionCursor: true },
    })
    const cappedLedger = await prisma.planetMaterialTransaction.findMany({
      where: { planetId: cappedPlanetId },
    })
    assert.equal(cappedPlanet.materials, 792n)
    assert.equal(cappedLedger.length, 1)
    assert.equal(cappedLedger[0].delta, 792n)
    assert.deepEqual(cappedPlanet.materialsProductionCursor, cappedLedger[0].createdAt)

    const concurrent = await Promise.all([
      claimPlanetMaterialsProductionForOwner({
        ownerId,
        planetId: concurrentPlanetId,
        prismaClient: prisma,
      }),
      claimPlanetMaterialsProductionForOwner({
        ownerId,
        planetId: concurrentPlanetId,
        prismaClient: prisma,
      }),
    ])
    assert.deepEqual(
      concurrent.map(({ claimedMaterials }) => claimedMaterials).sort(),
      ["0", "22"],
    )
    assert.deepEqual(
      await prisma.planet.findUnique({
        where: { id: concurrentPlanetId },
        select: { materials: true },
      }),
      { materials: 22n },
    )
    assert.equal(
      await prisma.planetMaterialTransaction.count({
        where: { planetId: concurrentPlanetId },
      }),
      1,
    )

    await assert.rejects(
      claimPlanetMaterialsProductionForOwner({
        ownerId: otherOwnerId,
        planetId: partialPlanetId,
        prismaClient: prisma,
      }),
      { message: MATERIALS_PRODUCTION_CLAIM_ERROR },
    )
  } finally {
    await prisma.planetMaterialTransaction.deleteMany({
      where: { planetId: { in: planetIds } },
    }).catch(() => {})
    await prisma.planet.deleteMany({
      where: { id: { in: planetIds } },
    }).catch(() => {})
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, otherOwnerId] } },
    }).catch(() => {})
    await prisma.$disconnect()
  }
})
