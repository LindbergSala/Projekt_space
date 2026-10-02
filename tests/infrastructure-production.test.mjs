import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"

import {
  MATERIALS_PRODUCTION_CLAIM_ERROR,
  claimPlanetMaterialsProductionForOwner,
} from "../lib/materials-production-claim-policy.js"
import { queryCivilizationCommandCenterForOwner } from "../lib/civilization-overview-query.js"
import { queryOwnedPlanetDetailForOwner } from "../lib/owned-planets-query.js"
import { getInfrastructureStep } from "../lib/planet-infrastructure.js"
import { parseCompatibleDatabaseUrl } from "../scripts/setup-local-db-role.mjs"

const HOUR = 3_600_000
const FACTION = "orthevan-directorate"
const LARGE_BALANCE = 9_007_199_254_740_993n

function localPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL
  assert.equal(typeof databaseUrl, "string")
  parseCompatibleDatabaseUrl(databaseUrl)
  const url = new URL(databaseUrl)
  assert.equal(url.hostname, "127.0.0.1")
  assert.equal(url.port, "55432")
  assert.equal(url.pathname, "/projekt_space_dev")
  assert.equal(decodeURIComponent(url.username), "projekt_space_app")
  assert.equal(url.search, "")
  assert.equal(url.hash, "")
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  })
}

async function withFixture(run) {
  const prisma = localPrismaClient()
  const ownerId = `infrastructure-production-${randomUUID()}`
  const planetIds = []
  let verified = false
  try {
    const [identity] = await prisma.$queryRaw`
      SELECT current_database() AS "databaseName", current_user AS "roleName",
             inet_server_port() AS "serverPort", clock_timestamp() AS "currentTime"
    `
    assert.equal(identity.databaseName, "projekt_space_dev")
    assert.equal(identity.roleName, "projekt_space_app")
    assert.equal(identity.serverPort, 5432)
    verified = true
    await prisma.user.create({
      data: {
        id: ownerId,
        name: "Synthetic Infrastructure Production",
        email: `${ownerId}@example.invalid`,
        factionKey: FACTION,
      },
    })
    await run({ prisma, ownerId, planetIds, now: identity.currentTime })
  } finally {
    try {
      if (verified) {
        await prisma.planetConstruction.deleteMany({ where: { planetId: { in: planetIds } } })
        await prisma.planetMaterialTransaction.deleteMany({ where: { planetId: { in: planetIds } } })
        await prisma.planet.deleteMany({ where: { id: { in: planetIds } } })
        await prisma.user.deleteMany({ where: { id: ownerId } })
        assert.equal(await prisma.planetConstruction.count({ where: { planetId: { in: planetIds } } }), 0)
        assert.equal(await prisma.planetMaterialTransaction.count({ where: { planetId: { in: planetIds } } }), 0)
        assert.equal(await prisma.planet.count({ where: { id: { in: planetIds } } }), 0)
        assert.equal(await prisma.user.count({ where: { id: ownerId } }), 0)
      }
    } finally {
      await prisma.$disconnect()
    }
  }
}

async function createPlanet(fixture, { cursor, remainder = 0n, materials = 0n }) {
  const id = `infrastructure-production-planet-${randomUUID()}`
  fixture.planetIds.push(id)
  return fixture.prisma.planet.create({
    data: {
      id,
      ownerId: fixture.ownerId,
      name: "Synthetic Infrastructure Planet",
      materials,
      materialsProductionCursor: cursor,
      materialsProductionRemainder: remainder,
    },
  })
}

function after(date, milliseconds) {
  return new Date(date.getTime() + milliseconds)
}

// These isolated historical fixtures retain every real construction duration,
// cost, sequential level, Command requirement, and single-planet order boundary.
function job(planetId, buildingKey, targetLevel, completesAt) {
  const step = getInfrastructureStep(buildingKey, targetLevel)
  return {
    id: `infrastructure-production-order-${randomUUID()}`,
    planetId,
    buildingKey,
    fromLevel: targetLevel - 1,
    targetLevel,
    materialsCost: step.materialsCost,
    startedAt: after(completesAt, -step.durationSeconds * 1_000),
    completesAt,
  }
}

function history(planetId, cursor, secondCompletionHours = 1.5) {
  return [
    job(planetId, "materials-extractor", 1, after(cursor, 0.5 * HOUR)),
    job(planetId, "planetary-command", 2, after(cursor, HOUR)),
    job(planetId, "materials-extractor", 2, after(cursor, secondCompletionHours * HOUR)),
  ]
}

async function snapshot(prisma, planetId) {
  return {
    planet: await prisma.planet.findUnique({ where: { id: planetId } }),
    constructions: await prisma.planetConstruction.findMany({
      where: { planetId }, orderBy: { id: "asc" },
    }),
    ledger: await prisma.planetMaterialTransaction.findMany({
      where: { planetId }, orderBy: { id: "asc" },
    }),
  }
}

// Only the test transaction's time reads are replaced for long synthetic time
// fixtures. Locks, queries, balance updates, and ledger writes use real local
// PostgreSQL transactions. This does not claim to verify an elapsed real timer.
function transactionFixture(prisma, { currentTime, failLedger = false } = {}) {
  return {
    $transaction(run, options) {
      return prisma.$transaction((transaction) => run(new Proxy(transaction, {
        get(target, property) {
          if (property === "$queryRaw" && currentTime) {
            return (strings, ...values) => {
              if (/SELECT (?:clock_timestamp\(\)|CURRENT_TIMESTAMP) AS "currentTime"/u.test(strings.join("?"))) {
                return Promise.resolve([{ currentTime: new Date(currentTime) }])
              }
              return target.$queryRaw(strings, ...values)
            }
          }
          if (property === "planetMaterialTransaction" && failLedger) {
            return new Proxy(target.planetMaterialTransaction, {
              get(delegate, method) {
                if (method === "create") {
                  return async () => { throw new Error("Synthetic ledger failure") }
                }
                return delegate[method]
              },
            })
          }
          const value = target[property]
          return typeof value === "function" ? value.bind(target) : value
        },
      })), options)
    },
  }
}

function claim(fixture, planetId, prismaClient = fixture.prisma) {
  return claimPlanetMaterialsProductionForOwner({
    ownerId: fixture.ownerId, planetId, prismaClient,
  })
}

test("local real-clock claims respect completed and pending Extractor histories", async () => {
  await withFixture(async (fixture) => {
    const cursor = after(fixture.now, -1.5 * HOUR)
    const pending = await createPlanet(fixture, { cursor })
    const completed = await createPlanet(fixture, { cursor })
    const pendingJob = job(pending.id, "materials-extractor", 1, after(fixture.now, 60_000))
    const completedJob = job(completed.id, "materials-extractor", 1, after(cursor, 0.5 * HOUR))
    await fixture.prisma.planetConstruction.createMany({ data: [pendingJob, completedJob] })

    const before = await claim(fixture, pending.id)
    assert.equal(before.claimedMaterials, "11")
    assert.equal(before.production.ratePerHour, "11")
    const afterCompletion = await claim(fixture, completed.id)
    assert.equal(afterCompletion.claimedMaterials, "16")
    assert.equal(afterCompletion.production.ratePerHour, "22")
    const pendingState = await snapshot(fixture.prisma, pending.id)
    const completeState = await snapshot(fixture.prisma, completed.id)
    assert.equal(pendingState.planet.materialsProductionRemainder, 0n)
    assert.equal(completeState.planet.materialsProductionRemainder, 1_800_000n)
    assert.deepEqual(completeState.constructions[0].completesAt, completedJob.completesAt)
    assert.deepEqual(pendingState.constructions[0].completesAt, pendingJob.completesAt)
    assert.equal(pendingState.ledger.length, 1)
    assert.equal(completeState.ledger.length, 1)
  })
})

test("local segmented claims persist exact fractional production across a synthetic completion fixture", async () => {
  await withFixture(async (fixture) => {
    const cursor = after(fixture.now, -2.25 * HOUR)
    const segmented = await createPlanet(fixture, { cursor, remainder: 17n, materials: LARGE_BALANCE })
    const combined = await createPlanet(fixture, { cursor, remainder: 17n, materials: LARGE_BALANCE })
    await fixture.prisma.planetConstruction.createMany({
      data: [...history(segmented.id, cursor), ...history(combined.id, cursor)].reverse(),
    })
    const first = await claim(fixture, segmented.id, transactionFixture(fixture.prisma, {
      currentTime: after(cursor, 1.25 * HOUR),
    }))
    assert.equal(first.claimedMaterials, "16")
    let saved = await snapshot(fixture.prisma, segmented.id)
    assert.equal(saved.planet.materialsProductionRemainder, 1_800_017n)
    assert.deepEqual(saved.planet.materialsProductionCursor, after(cursor, HOUR))

    const second = await claim(fixture, segmented.id)
    const once = await claim(fixture, combined.id)
    assert.equal(second.claimedMaterials, "28")
    assert.equal(once.claimedMaterials, "44")
    saved = await snapshot(fixture.prisma, segmented.id)
    const combinedState = await snapshot(fixture.prisma, combined.id)
    assert.equal(saved.planet.materials, LARGE_BALANCE + 44n)
    assert.equal(saved.planet.materials, combinedState.planet.materials)
    assert.equal(saved.planet.materialsProductionRemainder, 17n)
    assert.equal(saved.planet.materialsProductionRemainder, combinedState.planet.materialsProductionRemainder)
    assert.deepEqual(saved.planet.materialsProductionCursor, after(cursor, 2 * HOUR))
    assert.equal(saved.ledger.length, 2)
    assert.equal(combinedState.ledger.length, 1)
    const repeated = await claim(fixture, segmented.id)
    assert.equal(repeated.claimedMaterials, "0")
    assert.deepEqual(await snapshot(fixture.prisma, segmented.id), saved)
  })
})

test("local capped claims preserve earned remainder and exclude production after the first 72 hours", async () => {
  await withFixture(async (fixture) => {
    const cursor = after(fixture.now, -80.5 * HOUR)
    const planet = await createPlanet(fixture, { cursor, remainder: 7n })
    await fixture.prisma.planetConstruction.createMany({ data: history(planet.id, cursor, 73).reverse() })
    const result = await claim(fixture, planet.id)
    assert.equal(result.claimedMaterials, "1578")
    assert.equal(result.production.ratePerHour, "33")
    const saved = await snapshot(fixture.prisma, planet.id)
    assert.equal(saved.planet.materials, 1_578n)
    assert.equal(saved.planet.materialsProductionRemainder, 1_800_007n)
    assert.equal(saved.ledger.length, 1)
    assert.equal(saved.ledger[0].delta, 1_578n)
    assert.deepEqual(saved.planet.materialsProductionCursor, saved.ledger[0].createdAt)
    assert.equal((await claim(fixture, planet.id)).claimedMaterials, "0")
    assert.deepEqual(await snapshot(fixture.prisma, planet.id), saved)
  })
})

test("local claim rolls back balance, cursor, and fractional remainder on ledger failure", async () => {
  await withFixture(async (fixture) => {
    const cursor = after(fixture.now, -1.25 * HOUR)
    const planet = await createPlanet(fixture, { cursor, remainder: 17n, materials: LARGE_BALANCE })
    await fixture.prisma.planetConstruction.create({
      data: job(planet.id, "materials-extractor", 1, after(cursor, 0.5 * HOUR)),
    })
    const before = await snapshot(fixture.prisma, planet.id)
    await assert.rejects(
      claim(fixture, planet.id, transactionFixture(fixture.prisma, { failLedger: true })),
      { message: MATERIALS_PRODUCTION_CLAIM_ERROR },
    )
    assert.deepEqual(await snapshot(fixture.prisma, planet.id), before)
    assert.equal((await claim(fixture, planet.id)).claimedMaterials, "16")
    assert.equal((await snapshot(fixture.prisma, planet.id)).planet.materialsProductionRemainder, 1_800_017n)
  })
})

test("local detail and command center share a synthetic snapshot time without mutating completed or future history", async () => {
  await withFixture(async (fixture) => {
    const cursor = after(fixture.now, -2.25 * HOUR)
    const planet = await createPlanet(fixture, { cursor, remainder: 17n, materials: 100n })
    await fixture.prisma.planetConstruction.createMany({ data: history(planet.id, cursor).reverse() })
    const before = await snapshot(fixture.prisma, planet.id)
    for (const elapsed of [1.25 * HOUR, 1.5 * HOUR - 1, 1.5 * HOUR, 2.25 * HOUR]) {
      const currentTime = after(cursor, elapsed)
      const prismaClient = transactionFixture(fixture.prisma, { currentTime })
      const detail = await queryOwnedPlanetDetailForOwner({
        ownerId: fixture.ownerId, planetId: planet.id, prismaClient,
      })
      const center = await queryCivilizationCommandCenterForOwner({ ownerId: fixture.ownerId, prismaClient })
      assert.equal(center.planets.length, 1)
      assert.equal(detail.infrastructure.asOf, currentTime.toISOString())
      assert.deepEqual(detail.infrastructure, center.planets[0].infrastructure)
      assert.deepEqual(detail.production, center.planets[0].production)
      const complete = elapsed >= 1.5 * HOUR
      assert.equal(detail.production.ratePerHour, complete ? "33" : "22")
      assert.equal(detail.infrastructure.buildings.find(({ key }) => key === "materials-extractor").level,
        complete ? 2 : 1)
      assert.equal(detail.infrastructure.activeConstruction?.targetLevel ?? null, complete ? null : 2)
      assert.deepEqual(await snapshot(fixture.prisma, planet.id), before)
    }
  })
})
