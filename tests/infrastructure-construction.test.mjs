import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"

import {
  CONSTRUCTION_MESSAGES,
  InfrastructureConstructionError,
  readStrictInfrastructureConstruction,
  startPlanetConstructionForOwner,
} from "../lib/infrastructure-construction-policy.js"
import { getInfrastructureStep } from "../lib/planet-infrastructure.js"
import {
  INFRASTRUCTURE_STATE_ERROR,
  projectPlanetInfrastructure,
  readInfrastructureState,
} from "../lib/planet-infrastructure-state.js"
import {
  MATERIALS_PRODUCTION_CLAIM_ERROR,
  claimPlanetMaterialsProductionForOwner,
} from "../lib/materials-production-claim-policy.js"
import { parseCompatibleDatabaseUrl } from "../scripts/setup-local-db-role.mjs"

const FACTION = "orthevan-directorate"
const START = new Date("2026-01-01T00:00:00.000Z")
const MAXIMUM_BALANCE = 9_223_372_036_854_775_807n

function intent(overrides = {}) {
  return {
    planetId: "planet-owned",
    infrastructureEpoch: "11111111-1111-4111-8111-111111111111",
    buildingKey: "materials-extractor",
    expectedLevel: 0,
    operationKey: "22222222-2222-4222-8222-222222222222",
    ...overrides,
  }
}

function form(input = intent()) {
  const formData = new FormData()
  for (const [key, value] of Object.entries(input)) formData.append(key, String(value))
  return formData
}

function transition(buildingKey, targetLevel, startedAt = START) {
  const step = getInfrastructureStep(buildingKey, targetLevel)
  return {
    buildingKey,
    fromLevel: targetLevel - 1,
    targetLevel,
    startedAt,
    completesAt: new Date(startedAt.getTime() + step.durationSeconds * 1000),
    materialsCost: step.materialsCost,
  }
}

function projection(constructions = [], currentTime = START, materials = 1000n) {
  return projectPlanetInfrastructure({ constructions, currentTime, materials, factionKey: FACTION })
}

function hasCode(code) {
  return (error) => {
    assert.ok(error instanceof InfrastructureConstructionError)
    assert.equal(error.code, code)
    assert.equal(error.message, CONSTRUCTION_MESSAGES[code])
    return true
  }
}

test("construction form accepts only validated intent and string action metadata", () => {
  const valid = form()
  valid.append("$ACTION_ID_synthetic", "")
  valid.append("$ACTION_ownerId", "another-owner")
  valid.append("$ACTION_materialsCost", "0")
  valid.append("$ACTION_completesAt", "1900-01-01")
  assert.deepEqual(readStrictInfrastructureConstruction(valid), intent())

  for (const level of [0, 1, 2, 3, 4, 5]) {
    assert.equal(readStrictInfrastructureConstruction(form(intent({ expectedLevel: level }))).expectedLevel, level)
  }
})

test("construction form rejects duplicates, files, unknown fields and malformed intent", () => {
  const invalid = [new FormData(), null, {}]
  for (const key of Object.keys(intent())) {
    const duplicate = form()
    duplicate.append(key, String(intent()[key]))
    invalid.push(duplicate)
    const missing = form()
    missing.delete(key)
    invalid.push(missing)
    const file = form()
    file.set(key, new File(["synthetic"], "synthetic.txt"))
    invalid.push(file)
  }
  for (const key of ["ownerId", "factionKey", "materials", "cost", "targetLevel", "startedAt", "completesAt", "$ACTION", "$action_ID_x"]) {
    const extra = form()
    extra.append(key, "untrusted")
    invalid.push(extra)
  }
  const metadataFile = form()
  metadataFile.append("$ACTION_file", new File(["synthetic"], "synthetic.txt"))
  invalid.push(metadataFile)
  for (const [key, values] of Object.entries({
    planetId: ["", " planet-owned", "planet-owned ", "x".repeat(129)],
    infrastructureEpoch: ["", "not-a-uuid", "11111111-1111-4111-8111-111111111111 "],
    operationKey: ["", "not-a-uuid", "22222222-2222-4222-8222-22222222222A"],
    buildingKey: ["", "materials", "Materials Extractor", "__proto__"],
    expectedLevel: ["", "-1", "6", "01", "1.0", " 1", "1e0", "NaN"],
  })) {
    for (const value of values) invalid.push(form(intent({ [key]: value })))
  }
  for (const input of invalid) assert.throws(() => readStrictInfrastructureConstruction(input), hasCode("invalid"))
})

test("infrastructure baseline is implicit with no history, exact costs and stored-balance gating", () => {
  const empty = projection([], START, 0n)
  assert.deepEqual(empty.buildings.map(({ key, level }) => [key, level]), [
    ["planetary-command", 1], ["materials-extractor", 0], ["barracks", 0],
    ["war-factory", 0], ["space-station", 0],
  ])
  assert.equal(empty.activeConstruction, null)
  const extractor = empty.buildings.find(({ key }) => key === "materials-extractor")
  assert.equal(extractor.cost, "10")
  assert.equal(extractor.durationSeconds, 60)
  assert.equal(extractor.extractorRatePerHour, "11")
  assert.equal(extractor.canBuild, false)
  assert.match(extractor.blockedReason, /stored Materials/u)
  assert.equal(empty.buildings.find(({ key }) => key === "war-factory").requiredCommandLevel, 2)
  assert.equal(empty.buildings.find(({ key }) => key === "space-station").requiredCommandLevel, 3)
  assert.doesNotThrow(() => JSON.stringify(empty))
})

test("infrastructure becomes effective at the saved millisecond without mutating history", () => {
  const row = transition("materials-extractor", 1)
  const original = structuredClone(row)
  const before = projection([row], new Date(row.completesAt.getTime() - 1))
  const at = projection([row], row.completesAt)
  const late = projection([row], new Date(row.completesAt.getTime() + 100 * 86_400_000))
  assert.equal(before.buildings[1].level, 0)
  assert.equal(before.buildings[1].extractorRatePerHour, "11")
  assert.equal(before.activeConstruction.targetLevel, 1)
  assert.equal(before.activeConstruction.completesAt, row.completesAt.toISOString())
  assert.equal(before.buildings.every(({ canBuild }) => !canBuild), true)
  assert.equal(at.buildings[1].level, 1)
  assert.equal(at.buildings[1].extractorRatePerHour, "22")
  assert.equal(at.activeConstruction, null)
  assert.equal(at.buildings[1].canBuild, false)
  assert.match(at.buildings[1].blockedReason, /Command level 2/u)
  assert.deepEqual(late.buildings, at.buildings)
  assert.deepEqual(row, original)
})

test("Command upgrades unlock only after completion and existing levels remain effective", () => {
  const extractor = transition("materials-extractor", 1)
  const command = transition("planetary-command", 2, extractor.completesAt)
  const extractorUpgrade = transition("materials-extractor", 2, command.completesAt)
  const upgradingCommand = projection([extractor, command], new Date(command.completesAt.getTime() - 1))
  assert.equal(upgradingCommand.buildings[0].level, 1)
  assert.equal(upgradingCommand.buildings[1].level, 1)
  const upgradingExtractor = projection([extractor, command, extractorUpgrade], new Date(extractorUpgrade.completesAt.getTime() - 1))
  assert.equal(upgradingExtractor.buildings[0].level, 2)
  assert.equal(upgradingExtractor.buildings[1].level, 1)
  assert.equal(upgradingExtractor.buildings[1].extractorRatePerHour, "22")
  const completed = projection([extractorUpgrade, command, extractor], extractorUpgrade.completesAt)
  assert.equal(completed.buildings[1].level, 2)
  assert.equal(completed.buildings[1].extractorRatePerHour, "33")
  assert.equal(completed.buildings[3].canBuild, true)
  assert.equal(completed.buildings[4].canBuild, false)
})

test("malformed infrastructure history fails closed", () => {
  const row = transition("materials-extractor", 1)
  for (const constructions of [
    [{ ...row, materialsCost: 9n }],
    [{ ...row, materialsCost: "10" }],
    [{ ...row, completesAt: new Date(row.completesAt.getTime() - 1) }],
    [{ ...row, fromLevel: 1 }],
    [{ ...row, targetLevel: 2 }],
    [{ ...row, buildingKey: "unknown" }],
    [{ ...row, startedAt: new Date("invalid") }],
    [row, transition("barracks", 1, START)],
    [transition("war-factory", 1)],
    [row, transition("materials-extractor", 2, row.completesAt)],
    Array(25).fill(row),
  ]) {
    assert.throws(() => projection(constructions, new Date("2026-02-01T00:00:00.000Z")), { message: INFRASTRUCTURE_STATE_ERROR })
  }
  assert.throws(() => projection([row], new Date(START.getTime() - 1)), { message: INFRASTRUCTURE_STATE_ERROR })
  for (const materials of [-1n, MAXIMUM_BALANCE + 1n, 10, "10"]) {
    assert.throws(() => projection([], START, materials), { message: INFRASTRUCTURE_STATE_ERROR })
  }
  assert.throws(() => readInfrastructureState({ constructions: [], currentTime: START, factionKey: "unknown" }), { message: INFRASTRUCTURE_STATE_ERROR })
})

test("construction command locks User then owned Planet and uses only database time and canonical price", async () => {
  const events = []
  let savedConstruction
  let savedLedger
  let updatedPlanet
  const request = intent()
  const result = await startPlanetConstructionForOwner({
    ...request, ownerId: "owner", materialsCost: 0n, startedAt: new Date(0), factionKey: "untrusted",
    prismaClient: {
      async $transaction(run) {
        return run({
          async $queryRaw(strings, ...values) {
            const sql = strings.join("?")
            events.push({ sql, values })
            if (sql.includes('FROM "user"')) return [{ factionKey: FACTION }]
            if (sql.includes('FROM "planet"')) return [{ id: request.planetId, infrastructureEpoch: request.infrastructureEpoch, materials: MAXIMUM_BALANCE }]
            return [{ currentTime: START }]
          },
          planetConstruction: {
            async findUnique() { return null },
            async findMany() { return [] },
            async create({ data }) { savedConstruction = data; return { id: data.id } },
          },
          planet: { async updateMany(input) { updatedPlanet = input; return { count: 1 } } },
          planetMaterialTransaction: { async create({ data }) { savedLedger = data; return { id: data.id } } },
        })
      },
    },
  })
  assert.match(events[0].sql, /FROM "user".*FOR UPDATE/su)
  assert.deepEqual(events[0].values, ["owner"])
  assert.match(events[1].sql, /"ownerId" = .*FOR UPDATE/su)
  assert.deepEqual(events[1].values, [request.planetId, "owner"])
  assert.match(events[2].sql, /clock_timestamp\(\)/u)
  assert.equal(updatedPlanet.where.infrastructureEpoch, request.infrastructureEpoch)
  assert.equal(updatedPlanet.data.materials, MAXIMUM_BALANCE - 10n)
  assert.equal(savedConstruction.materialsCost, 10n)
  assert.deepEqual(savedConstruction.startedAt, START)
  assert.equal(savedConstruction.completesAt.getTime() - START.getTime(), 60_000)
  assert.equal(savedLedger.delta, -10n)
  assert.equal(savedLedger.balanceAfter, MAXIMUM_BALANCE - 10n)
  assert.deepEqual(savedLedger.createdAt, START)
  assert.equal(result.balanceAfter, (MAXIMUM_BALANCE - 10n).toString())
  assert.equal(result.replayed, false)
  assert.doesNotThrow(() => JSON.stringify(result))
})

async function verifiedLocalPrisma() {
  const databaseUrl = process.env.DATABASE_URL
  assert.equal(typeof databaseUrl, "string")
  parseCompatibleDatabaseUrl(databaseUrl)
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) })
  const [identity] = await prisma.$queryRaw`
    SELECT current_database() AS database, current_user AS role,
      rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname = current_user
  `
  assert.deepEqual(identity, {
    database: "projekt_space_dev", role: "projekt_space_app", rolsuper: false,
    rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false,
  })
  return prisma
}

// Long durations are represented by isolated persisted history, never shortened
// product rules. Real elapsed-time browser coverage is maintained separately.
function completedHistory(steps, completesBefore, planetId) {
  const duration = steps.reduce((total, [key, level]) => total + getInfrastructureStep(key, level).durationSeconds * 1000 + 1, 0)
  let nextStart = new Date(completesBefore.getTime() - duration - 1000)
  return steps.map(([key, level]) => {
    const row = { id: `fixture-${randomUUID()}`, planetId, ...transition(key, level, nextStart) }
    nextStart = new Date(row.completesAt.getTime() + 1)
    return row
  })
}

test("local PostgreSQL construction transactions preserve ownership, atomic payment and retry intent", async (t) => {
  const prisma = await verifiedLocalPrisma()
  const suffix = randomUUID()
  const ownerId = `construction-owner-${suffix}`
  const otherId = `construction-other-${suffix}`
  const factionlessId = `construction-no-faction-${suffix}`
  const planetIds = []
  async function createPlanet({ owner = ownerId, materials = 1000n, ...data } = {}) {
    const id = `construction-planet-${randomUUID()}`
    planetIds.push(id)
    return prisma.planet.create({ data: { id, ownerId: owner, materials, ...data } })
  }
  function requestFor(planet, overrides = {}) {
    return {
      ownerId, planetId: planet.id, infrastructureEpoch: planet.infrastructureEpoch,
      buildingKey: "materials-extractor", expectedLevel: 0,
      operationKey: randomUUID(), prismaClient: prisma, ...overrides,
    }
  }
  async function rows(planetId) {
    return {
      planet: await prisma.planet.findUnique({ where: { id: planetId } }),
      constructions: await prisma.planetConstruction.findMany({ where: { planetId }, orderBy: { startedAt: "asc" } }),
      ledger: await prisma.planetMaterialTransaction.findMany({ where: { planetId }, orderBy: { createdAt: "asc" } }),
    }
  }

  try {
    await prisma.user.createMany({ data: [
      { id: ownerId, name: "Synthetic construction owner", email: `${ownerId}@example.invalid`, factionKey: FACTION },
      { id: otherId, name: "Synthetic other owner", email: `${otherId}@example.invalid`, factionKey: "draskyr-clans" },
      { id: factionlessId, name: "Synthetic factionless owner", email: `${factionlessId}@example.invalid` },
    ] })

    await t.test("new planets have independent epochs, zero remainder and implicit baseline", async () => {
      const first = await createPlanet({ materials: 0n })
      const second = await createPlanet({ materials: 0n })
      assert.notEqual(first.infrastructureEpoch, second.infrastructureEpoch)
      assert.equal(first.materialsProductionRemainder, 0n)
      assert.equal(first.materials, 0n)
      const [{ currentTime }] = await prisma.$queryRaw`SELECT clock_timestamp() AS "currentTime"`
      const before = await rows(first.id)
      const projected = projectPlanetInfrastructure({ ...before, constructions: before.constructions, factionKey: FACTION, currentTime, materials: first.materials })
      assert.deepEqual(projected.buildings.map(({ level }) => level), [1, 0, 0, 0, 0])
      assert.deepEqual(await rows(first.id), before)
    })

    await t.test("server ownership, faction and civilization incarnation gate all commands", async () => {
      const planet = await createPlanet()
      const factionless = await createPlanet({ owner: factionlessId })
      const before = await rows(planet.id)
      await assert.rejects(startPlanetConstructionForOwner(requestFor(planet, { ownerId: otherId })), hasCode("not-owned"))
      await assert.rejects(startPlanetConstructionForOwner(requestFor(factionless, { ownerId: factionlessId })), hasCode("faction-required"))
      await assert.rejects(startPlanetConstructionForOwner(requestFor(planet, { infrastructureEpoch: randomUUID() })), hasCode("stale-civilization"))
      assert.deepEqual(await rows(planet.id), before)
    })

    await t.test("unclaimed production cannot pay and missing completed Command levels are rejected", async () => {
      const [{ currentTime }] = await prisma.$queryRaw`SELECT clock_timestamp() AS "currentTime"`
      const poor = await createPlanet({ materials: 0n, materialsProductionCursor: new Date(currentTime.getTime() - 3_600_000) })
      const rich = await createPlanet()
      const before = await rows(poor.id)
      await assert.rejects(startPlanetConstructionForOwner(requestFor(poor)), hasCode("insufficient-materials"))
      assert.deepEqual(await rows(poor.id), before)
      for (const buildingKey of ["war-factory", "space-station"]) {
        await assert.rejects(startPlanetConstructionForOwner(requestFor(rich, { buildingKey })), hasCode("command-required"))
      }
      await assert.rejects(startPlanetConstructionForOwner(requestFor(rich, { expectedLevel: 1 })), hasCode("stale-level"))
      assert.equal((await rows(rich.id)).constructions.length, 0)
    })

    await t.test("same-planet competing orders accept exactly one debit and active job", async () => {
      const planet = await createPlanet({ materials: 100n })
      const attempts = await Promise.allSettled([
        startPlanetConstructionForOwner(requestFor(planet)),
        startPlanetConstructionForOwner(requestFor(planet, { buildingKey: "barracks" })),
      ])
      assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1)
      hasCode("busy")(attempts.find(({ status }) => status === "rejected").reason)
      const saved = await rows(planet.id)
      assert.equal(saved.constructions.length, 1)
      assert.equal(saved.ledger.length, 1)
      assert.equal(saved.planet.materials, 100n - saved.constructions[0].materialsCost)
      assert.equal(saved.ledger[0].delta, -saved.constructions[0].materialsCost)
      assert.equal(saved.ledger[0].balanceAfter, saved.planet.materials)
      assert.deepEqual(saved.planet.materialsProductionCursor, planet.materialsProductionCursor)
      assert.equal(saved.planet.materialsProductionRemainder, 0n)
    })

    await t.test("independent planets can hold simultaneous active work", async () => {
      const first = await createPlanet()
      const second = await createPlanet()
      const results = await Promise.all([
        startPlanetConstructionForOwner(requestFor(first)),
        startPlanetConstructionForOwner(requestFor(second)),
      ])
      assert.equal(results.every(({ replayed }) => !replayed), true)
      assert.equal((await rows(first.id)).constructions.length, 1)
      assert.equal((await rows(second.id)).constructions.length, 1)
      assert.ok(Math.max(...results.map(({ construction }) => Date.parse(construction.startedAt))) <
        Math.min(...results.map(({ construction }) => Date.parse(construction.completesAt))))
    })

    await t.test("concurrent claim and construction preserve both balance changes and the production cursor", async () => {
      const [{ currentTime }] = await prisma.$queryRaw`SELECT clock_timestamp() AS "currentTime"`
      const cursor = new Date(currentTime.getTime() - 1.5 * 3_600_000)
      const planet = await createPlanet({ materials: 20n, materialsProductionCursor: cursor })
      const [construction, claim] = await Promise.all([
        startPlanetConstructionForOwner(requestFor(planet)),
        claimPlanetMaterialsProductionForOwner({ ownerId, planetId: planet.id, prismaClient: prisma }),
      ])
      const saved = await rows(planet.id)
      assert.equal(construction.replayed, false)
      assert.equal(claim.claimedMaterials, "11")
      assert.equal(saved.planet.materials, 21n)
      assert.equal(saved.planet.materialsProductionRemainder, 0n)
      assert.equal(saved.planet.materialsProductionCursor.getTime(), cursor.getTime() + 3_600_000)
      assert.equal(saved.constructions.length, 1)
      assert.equal(saved.ledger.length, 2)
      assert.deepEqual(saved.ledger.map(({ delta }) => delta).sort((left, right) => left < right ? -1 : 1), [-10n, 11n])
      const retry = await claimPlanetMaterialsProductionForOwner({ ownerId, planetId: planet.id, prismaClient: prisma })
      assert.equal(retry.claimedMaterials, "0")
      assert.deepEqual(await rows(planet.id), saved)
    })

    await t.test("historical Extractor claim persists fractional numerator atomically and a failed ledger rolls everything back", async () => {
      const [{ currentTime }] = await prisma.$queryRaw`SELECT clock_timestamp() AS "currentTime"`
      const cursor = new Date(currentTime.getTime() - 1.5 * 3_600_000)
      const planet = await createPlanet({ materials: 100n, materialsProductionCursor: cursor })
      await startPlanetConstructionForOwner(requestFor(planet))
      const construction = (await rows(planet.id)).constructions[0]
      const complete = new Date(cursor.getTime() + 1_800_001)
      await prisma.planetConstruction.update({ where: { id: construction.id }, data: {
        startedAt: new Date(complete.getTime() - 60_000), completesAt: complete,
      } })
      const before = await rows(planet.id)
      let updatedBeforeFailure = false
      const failingPrisma = {
        $transaction(run) {
          return prisma.$transaction((transaction) => run(new Proxy(transaction, {
            get(target, property) {
              if (property === "planetMaterialTransaction") return {
                async create() {
                  const updated = await transaction.planet.findUnique({ where: { id: planet.id } })
                  assert.equal(updated.materials, 106n)
                  assert.equal(updated.materialsProductionRemainder, 1_799_989n)
                  assert.equal(updated.materialsProductionCursor.getTime(), cursor.getTime() + 3_600_000)
                  updatedBeforeFailure = true
                  throw new Error("Synthetic internal claim ledger failure")
                },
              }
              return Reflect.get(target, property)
            },
          })))
        },
      }
      await assert.rejects(claimPlanetMaterialsProductionForOwner({ ownerId, planetId: planet.id, prismaClient: failingPrisma }), {
        message: MATERIALS_PRODUCTION_CLAIM_ERROR,
      })
      assert.equal(updatedBeforeFailure, true)
      assert.deepEqual(await rows(planet.id), before)
      const claim = await claimPlanetMaterialsProductionForOwner({ ownerId, planetId: planet.id, prismaClient: prisma })
      assert.equal(claim.claimedMaterials, "16")
      assert.equal(claim.balanceAfter, "106")
      const saved = await rows(planet.id)
      assert.equal(saved.planet.materialsProductionRemainder, 1_799_989n)
      assert.equal(saved.ledger.length, 2)
      const retry = await claimPlanetMaterialsProductionForOwner({ ownerId, planetId: planet.id, prismaClient: prisma })
      assert.equal(retry.claimedMaterials, "0")
      assert.deepEqual(await rows(planet.id), saved)
    })

    await t.test("concurrent duplicate intent replays once and conflicting reuse fails", async () => {
      const planet = await createPlanet({ materials: MAXIMUM_BALANCE })
      const otherPlanet = await createPlanet()
      const request = requestFor(planet)
      const results = await Promise.all([
        startPlanetConstructionForOwner(request), startPlanetConstructionForOwner(request),
      ])
      assert.deepEqual(results.map(({ replayed }) => replayed).sort(), [false, true])
      assert.deepEqual(results[0].construction, results[1].construction)
      const before = await rows(planet.id)
      assert.equal(before.planet.materials, MAXIMUM_BALANCE - 10n)
      assert.equal(before.ledger.length, 1)
      assert.equal(before.constructions.length, 1)
      await assert.rejects(startPlanetConstructionForOwner({ ...request, buildingKey: "barracks" }), hasCode("conflict"))
      await assert.rejects(startPlanetConstructionForOwner({ ...request, expectedLevel: 1 }), hasCode("conflict"))
      await assert.rejects(startPlanetConstructionForOwner({ ...request, planetId: otherPlanet.id, infrastructureEpoch: otherPlanet.infrastructureEpoch }), hasCode("conflict"))
      assert.deepEqual(await rows(planet.id), before)
    })

    await t.test("post-completion retry preserves paid order and stale intent cannot start next level", async () => {
      const planet = await createPlanet()
      const request = requestFor(planet)
      await startPlanetConstructionForOwner(request)
      const saved = (await rows(planet.id)).constructions[0]
      const [{ currentTime }] = await prisma.$queryRaw`SELECT clock_timestamp() AS "currentTime"`
      const complete = new Date(currentTime.getTime() - 1)
      await prisma.planetConstruction.update({ where: { id: saved.id }, data: {
        startedAt: new Date(complete.getTime() - 60_000), completesAt: complete,
      } })
      const before = await rows(planet.id)
      const replay = await startPlanetConstructionForOwner(request)
      assert.equal(replay.replayed, true)
      assert.equal(replay.construction.completesAt, complete.toISOString())
      await assert.rejects(startPlanetConstructionForOwner({ ...request, operationKey: randomUUID() }), hasCode("stale-level"))
      await assert.rejects(startPlanetConstructionForOwner({ ...request, operationKey: randomUUID(), expectedLevel: 1 }), hasCode("command-required"))
      assert.deepEqual(await rows(planet.id), before)
    })

    await t.test("maximum level rejects another step with no charge", async () => {
      const planet = await createPlanet()
      const [{ currentTime }] = await prisma.$queryRaw`SELECT clock_timestamp() AS "currentTime"`
      await prisma.planetConstruction.createMany({ data: completedHistory([
        ["planetary-command", 2], ["planetary-command", 3], ["planetary-command", 4], ["planetary-command", 5],
        ["materials-extractor", 1], ["materials-extractor", 2], ["materials-extractor", 3], ["materials-extractor", 4], ["materials-extractor", 5],
      ], currentTime, planet.id) })
      const before = await rows(planet.id)
      const projected = projectPlanetInfrastructure({ constructions: before.constructions, factionKey: FACTION, currentTime, materials: planet.materials })
      assert.equal(projected.buildings[1].nextLevel, null)
      assert.equal(projected.buildings[1].cost, null)
      await assert.rejects(startPlanetConstructionForOwner(requestFor(planet, { expectedLevel: 5 })), hasCode("max-level"))
      assert.deepEqual(await rows(planet.id), before)
    })

    await t.test("ledger failure rolls back both debit and saved construction and hides internal error", async () => {
      const planet = await createPlanet()
      const before = await rows(planet.id)
      let constructionWritten = false
      const failingPrisma = {
        $transaction(run) {
          return prisma.$transaction((transaction) => run(new Proxy(transaction, {
            get(target, property) {
              if (property === "planetMaterialTransaction") return {
                async create() {
                  constructionWritten = (await transaction.planetConstruction.count({ where: { planetId: planet.id } })) === 1
                  assert.equal((await transaction.planet.findUnique({ where: { id: planet.id } })).materials, 990n)
                  throw new Error("Synthetic internal ledger failure must not reach the player")
                },
              }
              return Reflect.get(target, property)
            },
          })))
        },
      }
      await assert.rejects(startPlanetConstructionForOwner(requestFor(planet, { prismaClient: failingPrisma })), hasCode("unavailable"))
      assert.equal(constructionWritten, true)
      assert.deepEqual(await rows(planet.id), before)
    })
  } finally {
    try {
      await prisma.planetConstruction.deleteMany({ where: { planetId: { in: planetIds } } })
      await prisma.planetMaterialTransaction.deleteMany({ where: { planetId: { in: planetIds } } })
      await prisma.planet.deleteMany({ where: { id: { in: planetIds } } })
      await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId, factionlessId] } } })
    } finally {
      await prisma.$disconnect()
    }
  }
})
