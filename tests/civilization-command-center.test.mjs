import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { access, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"

import {
  CIVILIZATION_OVERVIEW_ERROR,
  queryCivilizationCommandCenterForOwner,
} from "../lib/civilization-overview-query.js"
import { resolveAuthenticatedUserId } from "../lib/auth-session-policy.js"
import {
  getPlanetaryFactionSummaries,
  getPlanetaryRosterForFaction,
} from "../lib/planetary-units.js"
import { parseCompatibleDatabaseUrl } from "../scripts/setup-local-db-role.mjs"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIRECTORY = path.resolve(TEST_DIRECTORY, "..")
const BIGINT_MAXIMUM = 9_223_372_036_854_775_807n
const TABLE_DELEGATES = [
  ["User", "user"],
  ["Account", "account"],
  ["Session", "session"],
  ["Verification", "verification"],
  ["Planet", "planet"],
  ["PlanetMaterialTransaction", "planetMaterialTransaction"],
  ["PlanetUnitStack", "planetUnitStack"],
  ["PlanetUnitTransaction", "planetUnitTransaction"],
]

async function source(relativePath) {
  return readFile(path.join(ROOT_DIRECTORY, relativePath), "utf8")
}

function mockPrisma({
  user = { factionKey: "orthevan-directorate" },
  planets = [],
  materialTransactions = [],
  unitTransactions = [],
  capture = {},
} = {}) {
  return {
    async $transaction(run, options) {
      capture.transactionOptions = options
      return run({
        user: {
          async findUnique(query) {
            capture.userQuery = query
            return user
          },
        },
        planet: {
          async findMany(query) {
            capture.planetQuery = query
            return planets
          },
        },
        planetMaterialTransaction: {
          async findMany(query) {
            capture.materialQuery = query
            return materialTransactions
          },
        },
        planetUnitTransaction: {
          async findMany(query) {
            capture.unitQuery = query
            return unitTransactions
          },
        },
      })
    },
  }
}

function localPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL
  assert.equal(typeof databaseUrl, "string")
  parseCompatibleDatabaseUrl(databaseUrl)

  const url = new URL(databaseUrl)
  assert.equal(url.hostname, "127.0.0.1")
  assert.equal(url.port, "55432")
  assert.equal(url.search, "")
  assert.equal(url.hash, "")

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  })
}

async function rowCounts(prisma) {
  return Object.fromEntries(
    await Promise.all(
      TABLE_DELEGATES.map(async ([label, delegate]) => [
        label,
        await prisma[delegate].count(),
      ]),
    ),
  )
}

async function gameplaySnapshot(prisma, ownerIds, planetIds) {
  return {
    users: await prisma.user.findMany({
      where: { id: { in: ownerIds } },
      select: { id: true, factionKey: true },
      orderBy: { id: "asc" },
    }),
    planets: await prisma.planet.findMany({
      where: { id: { in: planetIds } },
      select: { id: true, ownerId: true, name: true, materials: true },
      orderBy: { id: "asc" },
    }),
    materialTransactions: await prisma.planetMaterialTransaction.findMany({
      where: { planetId: { in: planetIds } },
      orderBy: { id: "asc" },
    }),
    unitStacks: await prisma.planetUnitStack.findMany({
      where: { planetId: { in: planetIds } },
      orderBy: [{ planetId: "asc" }, { unitKey: "asc" }],
    }),
    unitTransactions: await prisma.planetUnitTransaction.findMany({
      where: { planetId: { in: planetIds } },
      orderBy: { id: "asc" },
    }),
  }
}

test("authenticated command-center boundary preserves redirects and server-only routing", async () => {
  const operation = await source("lib/authenticated-civilization.js")
  const page = await source("app/civilization/page.js")
  const authSession = await source("lib/auth-session.js")
  const commandCenterOperation = operation.slice(
    operation.indexOf(
      "export async function getAuthenticatedCivilizationCommandCenter",
    ),
    operation.indexOf("export async function resetAuthenticatedCivilization"),
  )

  const redirectCalls = []
  const unauthenticated = await resolveAuthenticatedUserId({
    getRequestHeaders: async () => new Headers(),
    getSession: async () => null,
    redirectUnauthenticated(destination) {
      redirectCalls.push(destination)
      return "redirected"
    },
  })
  assert.equal(unauthenticated, "redirected")
  assert.deepEqual(redirectCalls, ["/login"])

  assert.match(operation, /^import "server-only"$/mu)
  assert.match(
    commandCenterOperation,
    /export async function getAuthenticatedCivilizationCommandCenter\(\)/u,
  )
  assert.match(
    commandCenterOperation,
    /const ownerId = await requireAuthenticatedUserId\(\)/u,
  )
  assert.match(
    commandCenterOperation,
    /if \(commandCenter === null\) \{\s*redirect\("\/faction"\)/u,
  )
  assert.doesNotMatch(
    commandCenterOperation,
    /searchParams|params|formData|request|cookies/u,
  )
  assert.match(authSession, /redirectUnauthenticated: redirect/u)

  assert.doesNotMatch(page, /^['"]use client['"]/mu)
  assert.doesNotMatch(page, /^['"]use server['"]/mu)
  assert.match(page, /export const dynamic = "force-dynamic"/u)
  assert.match(
    page,
    /const civilization = await getAuthenticatedCivilizationCommandCenter\(\)/u,
  )
  assert.equal(
    (page.match(/getAuthenticatedCivilizationCommandCenter\(/gu) ?? []).length,
    1,
  )
  assert.doesNotMatch(page, /fetch\(|prisma|api\/|<form|<button|action=/u)
  await assert.rejects(
    access(path.join(ROOT_DIRECTORY, "app/civilization/route.js")),
  )
  await assert.rejects(
    access(path.join(ROOT_DIRECTORY, "app/civilization/actions.js")),
  )
})

test("empty civilization uses one repeatable-read snapshot and performs no writes", async () => {
  const capture = {}
  const result = await queryCivilizationCommandCenterForOwner({
    ownerId: "authenticated-owner",
    prismaClient: mockPrisma({ capture }),
  })

  assert.deepEqual(capture.transactionOptions, {
    isolationLevel: "RepeatableRead",
  })
  assert.deepEqual(capture.userQuery, {
    where: { id: "authenticated-owner" },
    select: { factionKey: true },
  })
  assert.deepEqual(capture.planetQuery.where, {
    ownerId: "authenticated-owner",
  })
  assert.deepEqual(capture.planetQuery.orderBy, { id: "asc" })
  assert.deepEqual(capture.materialQuery.where, {
    planet: { ownerId: "authenticated-owner" },
  })
  assert.deepEqual(capture.unitQuery.where, {
    planet: { ownerId: "authenticated-owner" },
  })
  assert.equal(capture.materialQuery.take, 20)
  assert.equal(capture.unitQuery.take, 20)
  assert.deepEqual(result, {
    faction: {
      key: "orthevan-directorate",
      name: "Orthevan Directorate",
      uniqueUnitNames: ["Vanguard Exosuit", "Siege Strider"],
    },
    summary: {
      planetCount: 0,
      materials: "0",
      groundForces: "0",
    },
    planets: [],
    forces: getPlanetaryRosterForFaction("orthevan-directorate").map(
      ({ key, name, category }) => ({ key, name, category, quantity: "0" }),
    ),
    activity: [],
  })

  const policy = await source("lib/civilization-overview-query.js")
  assert.doesNotMatch(
    policy,
    /\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/u,
  )
  assert.doesNotMatch(policy, /\$executeRaw|Number\(/u)
  assert.equal(
    await queryCivilizationCommandCenterForOwner({
      ownerId: "authenticated-owner",
      prismaClient: mockPrisma({ user: { factionKey: null } }),
    }),
    null,
  )
})

test("multiple planets aggregate exact Materials and faction forces", async () => {
  const capture = {}
  const large = 9_007_199_254_740_993n
  const result = await queryCivilizationCommandCenterForOwner({
    ownerId: "authenticated-owner",
    prismaClient: mockPrisma({
      capture,
      planets: [
        {
          id: "planet-a",
          name: "Alpha",
          materials: large,
          unitStacks: [
            { unitKey: "line-infantry", quantity: large },
            { unitKey: "siege-strider", quantity: 3n },
          ],
        },
        {
          id: "planet-b",
          name: "Beta",
          materials: 11n,
          unitStacks: [
            { unitKey: "line-infantry", quantity: 7n },
            { unitKey: "assault-infantry", quantity: 0n },
          ],
        },
      ],
    }),
  })

  assert.deepEqual(result.summary, {
    planetCount: 2,
    materials: "9007199254741004",
    groundForces: "9007199254741003",
  })
  assert.deepEqual(result.planets, [
    {
      id: "planet-a",
      name: "Alpha",
      materials: "9007199254740993",
      groundForces: "9007199254740996",
      occupiedUnitTypes: 2,
    },
    {
      id: "planet-b",
      name: "Beta",
      materials: "11",
      groundForces: "7",
      occupiedUnitTypes: 1,
    },
  ])
  assert.equal(result.forces.length, 9)
  assert.equal(result.forces[0].quantity, "9007199254741000")
  assert.equal(
    result.forces.find(({ key }) => key === "siege-strider").quantity,
    "3",
  )
  assert.equal(result.forces[1].quantity, "0")
  assert.deepEqual(Object.keys(result), [
    "faction",
    "summary",
    "planets",
    "forces",
    "activity",
  ])
  assert.doesNotMatch(
    JSON.stringify(result),
    /ownerId|userId|transactionId|operationKey|account|session|verification/iu,
  )
})

test("all faction rosters are canonical and invalid stored units fail closed", async () => {
  const factions = getPlanetaryFactionSummaries()
  for (let index = 0; index < factions.length; index += 1) {
    const faction = factions[index]
    const result = await queryCivilizationCommandCenterForOwner({
      ownerId: "authenticated-owner",
      prismaClient: mockPrisma({ user: { factionKey: faction.key } }),
    })
    const roster = getPlanetaryRosterForFaction(faction.key)
    assert.deepEqual(
      result.forces.map(({ key }) => key),
      roster.map(({ key }) => key),
    )
    assert.equal(result.forces.length, 9)
    assert.equal(roster.filter(({ scope }) => scope === "general").length, 7)
    assert.deepEqual(
      result.forces.slice(7).map(({ name }) => name),
      faction.uniqueUnitNames,
    )

    const otherFaction = factions[(index + 1) % factions.length]
    const otherUniqueUnit = getPlanetaryRosterForFaction(otherFaction.key)[7]
    await assert.rejects(
      queryCivilizationCommandCenterForOwner({
        ownerId: "authenticated-owner",
        prismaClient: mockPrisma({
          user: { factionKey: faction.key },
          planets: [{
            id: "planet-owned",
            name: "Owned",
            materials: 0n,
            unitStacks: [{ unitKey: otherUniqueUnit.key, quantity: 1n }],
          }],
        }),
      }),
      { message: CIVILIZATION_OVERVIEW_ERROR },
    )
  }

  await assert.rejects(
    queryCivilizationCommandCenterForOwner({
      ownerId: "authenticated-owner",
      prismaClient: mockPrisma({
        planets: [{
          id: "planet-owned",
          name: "Owned",
          materials: 0n,
          unitStacks: [{ unitKey: "unknown-unit", quantity: 1n }],
        }],
      }),
    }),
    { message: CIVILIZATION_OVERVIEW_ERROR },
  )
})

test("recent activity merges deterministically, stays exact, and is globally limited", async () => {
  const sameTime = new Date("2026-10-01T12:00:00.000Z")
  const olderTime = new Date("2026-10-01T11:00:00.000Z")
  const materialTransactions = Array.from({ length: 12 }, (_, index) => ({
    id: `material-${String(index).padStart(2, "0")}`,
    planetId: "planet-owned",
    delta: index === 0 ? -9_007_199_254_740_993n : BigInt(index + 1),
    balanceAfter: 9_007_199_254_741_100n,
    createdAt: index < 2 ? sameTime : olderTime,
  }))
  const unitTransactions = Array.from({ length: 12 }, (_, index) => ({
    id: `unit-${String(index).padStart(2, "0")}`,
    planetId: "planet-owned",
    unitKey: "line-infantry",
    delta: index === 0 ? 9_007_199_254_740_993n : BigInt(index + 1),
    quantityAfter: 9_007_199_254_741_100n,
    createdAt: index === 0 ? sameTime : olderTime,
  }))
  const result = await queryCivilizationCommandCenterForOwner({
    ownerId: "authenticated-owner",
    prismaClient: mockPrisma({
      planets: [{
        id: "planet-owned",
        name: "Terra",
        materials: 0n,
        unitStacks: [],
      }],
      materialTransactions,
      unitTransactions,
    }),
  })

  assert.equal(result.activity.length, 20)
  assert.deepEqual(
    result.activity.slice(0, 3).map((entry) => [entry.kind, entry.delta]),
    [
      ["materials", "2"],
      ["materials", "-9007199254740993"],
      ["unit", "9007199254740993"],
    ],
  )
  assert.deepEqual(result.activity[0], {
    kind: "materials",
    planetId: "planet-owned",
    planetName: "Terra",
    delta: "2",
    balanceAfter: "9007199254741100",
    createdAt: "2026-10-01T12:00:00.000Z",
  })
  assert.equal(result.activity[2].unitName, "Line Infantry")
  for (const entry of result.activity) {
    assert.equal(typeof entry.delta, "string")
    assert.equal(typeof entry.createdAt, "string")
    assert.equal(Object.hasOwn(entry, "id"), false)
  }
})

test("corrupt command-center state always uses one generic read error", async () => {
  const basePlanet = {
    id: "planet-owned",
    name: "Owned",
    materials: 0n,
    unitStacks: [],
  }
  const date = new Date("2026-10-01T12:00:00.000Z")
  const corruptCases = [
    { planets: [{ ...basePlanet, materials: -1n }] },
    { planets: [{ ...basePlanet, materials: BIGINT_MAXIMUM + 1n }] },
    {
      planets: [{
        ...basePlanet,
        unitStacks: [{ unitKey: "line-infantry", quantity: -1n }],
      }],
    },
    {
      planets: [{
        ...basePlanet,
        unitStacks: [
          { unitKey: "line-infantry", quantity: 1n },
          { unitKey: "line-infantry", quantity: 2n },
        ],
      }],
    },
    {
      planets: [basePlanet],
      materialTransactions: [{
        id: "material-zero",
        planetId: basePlanet.id,
        delta: 0n,
        balanceAfter: 0n,
        createdAt: date,
      }],
    },
    {
      planets: [basePlanet],
      materialTransactions: [{
        id: "material-negative",
        planetId: basePlanet.id,
        delta: 1n,
        balanceAfter: -1n,
        createdAt: date,
      }],
    },
    {
      planets: [basePlanet],
      unitTransactions: [{
        id: "unit-zero",
        planetId: basePlanet.id,
        unitKey: "line-infantry",
        delta: 0n,
        quantityAfter: 1n,
        createdAt: date,
      }],
    },
    {
      planets: [basePlanet],
      unitTransactions: [{
        id: "unit-negative",
        planetId: basePlanet.id,
        unitKey: "line-infantry",
        delta: 1n,
        quantityAfter: -1n,
        createdAt: date,
      }],
    },
    {
      planets: [basePlanet],
      unitTransactions: [{
        id: "unit-unknown",
        planetId: basePlanet.id,
        unitKey: "unknown-unit",
        delta: 1n,
        quantityAfter: 1n,
        createdAt: date,
      }],
    },
    {
      planets: [basePlanet],
      unitTransactions: [{
        id: "unit-cross-faction",
        planetId: basePlanet.id,
        unitKey: "razor-beast",
        delta: 1n,
        quantityAfter: 1n,
        createdAt: date,
      }],
    },
    {
      planets: [basePlanet],
      unitTransactions: [{
        id: "unit-date",
        planetId: basePlanet.id,
        unitKey: "line-infantry",
        delta: 1n,
        quantityAfter: 1n,
        createdAt: "not-a-date",
      }],
    },
    {
      planets: [basePlanet],
      materialTransactions: [{
        id: "material-foreign",
        planetId: "foreign-planet",
        delta: 1n,
        balanceAfter: 1n,
        createdAt: date,
      }],
    },
  ]

  for (const corrupt of corruptCases) {
    await assert.rejects(
      queryCivilizationCommandCenterForOwner({
        ownerId: "authenticated-owner",
        prismaClient: mockPrisma(corrupt),
      }),
      { message: CIVILIZATION_OVERVIEW_ERROR },
    )
  }

  await assert.rejects(
    queryCivilizationCommandCenterForOwner({
      ownerId: "authenticated-owner",
      prismaClient: mockPrisma({ user: { factionKey: "invalid-faction" } }),
    }),
    { message: CIVILIZATION_OVERVIEW_ERROR },
  )
  await assert.rejects(
    queryCivilizationCommandCenterForOwner({
      ownerId: "authenticated-owner",
      prismaClient: {
        async $transaction() {
          throw new Error("sensitive database details")
        },
      },
    }),
    { message: CIVILIZATION_OVERVIEW_ERROR },
  )
})

test("local command-center read is owner-isolated, precise, and leaves every row unchanged", async () => {
  const prisma = localPrismaClient()
  const testId = randomUUID()
  const ownerId = `command-owner-${testId}`
  const otherOwnerId = `command-other-${testId}`
  const planetIds = [
    `command-planet-b-${testId}`,
    `command-planet-a-${testId}`,
    `command-planet-other-${testId}`,
  ]
  const ownerIds = [ownerId, otherOwnerId]
  let baseline

  try {
    const identity = await prisma.$queryRaw`
      SELECT
        current_database() AS database_name,
        current_user AS user_name,
        inet_server_addr()::text AS server_address,
        inet_server_port() AS server_port
    `
    assert.equal(identity[0].database_name, "projekt_space_dev")
    assert.equal(identity[0].user_name, "projekt_space_app")
    assert.equal(identity[0].server_port, 5432)
    baseline = await rowCounts(prisma)

    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          name: "Command Owner",
          email: `${ownerId}@example.invalid`,
          factionKey: "orthevan-directorate",
        },
        {
          id: otherOwnerId,
          name: "Command Other",
          email: `${otherOwnerId}@example.invalid`,
          factionKey: "zhyreth-brood",
        },
      ],
    })
    await prisma.planet.createMany({
      data: [
        {
          id: planetIds[0],
          ownerId,
          name: "Beta",
          materials: 11n,
        },
        {
          id: planetIds[1],
          ownerId,
          name: "Alpha",
          materials: 9_007_199_254_740_993n,
        },
        {
          id: planetIds[2],
          ownerId: otherOwnerId,
          name: "Foreign",
          materials: 777n,
        },
      ],
    })
    await prisma.planetUnitStack.createMany({
      data: [
        { planetId: planetIds[0], unitKey: "line-infantry", quantity: 7n },
        {
          planetId: planetIds[1],
          unitKey: "line-infantry",
          quantity: 9_007_199_254_740_993n,
        },
        { planetId: planetIds[1], unitKey: "siege-strider", quantity: 3n },
        { planetId: planetIds[2], unitKey: "razor-beast", quantity: 999n },
      ],
    })
    await prisma.planetMaterialTransaction.createMany({
      data: [
        {
          id: `command-material-owner-${testId}`,
          planetId: planetIds[1],
          delta: -9_007_199_254_740_993n,
          balanceAfter: 9_007_199_254_740_993n,
          createdAt: new Date("2026-10-01T12:00:00.000Z"),
        },
        {
          id: `command-material-other-${testId}`,
          planetId: planetIds[2],
          delta: 777n,
          balanceAfter: 777n,
          createdAt: new Date("2026-10-01T13:00:00.000Z"),
        },
      ],
    })
    await prisma.planetUnitTransaction.createMany({
      data: [
        {
          id: `command-unit-owner-${testId}`,
          planetId: planetIds[0],
          unitKey: "line-infantry",
          delta: 9_007_199_254_740_993n,
          quantityAfter: 9_007_199_254_741_000n,
          createdAt: new Date("2026-10-01T12:00:00.000Z"),
        },
        {
          id: `command-unit-other-${testId}`,
          planetId: planetIds[2],
          unitKey: "razor-beast",
          delta: 999n,
          quantityAfter: 999n,
          createdAt: new Date("2026-10-01T14:00:00.000Z"),
        },
      ],
    })

    const before = await gameplaySnapshot(prisma, ownerIds, planetIds)
    const result = await queryCivilizationCommandCenterForOwner({
      ownerId,
      prismaClient: prisma,
    })
    const after = await gameplaySnapshot(prisma, ownerIds, planetIds)

    assert.deepEqual(after, before)
    assert.deepEqual(
      result.planets.map(({ id }) => id),
      [planetIds[1], planetIds[0]].sort(),
    )
    assert.deepEqual(result.summary, {
      planetCount: 2,
      materials: "9007199254741004",
      groundForces: "9007199254741003",
    })
    assert.equal(result.activity.length, 2)
    assert.deepEqual(
      result.activity.map(({ kind, planetName }) => [kind, planetName]),
      [["materials", "Alpha"], ["unit", "Beta"]],
    )
    assert.equal(result.planets.some(({ id }) => id === planetIds[2]), false)
    assert.equal(
      result.activity.some(({ planetId }) => planetId === planetIds[2]),
      false,
    )
    assert.equal(result.forces.some(({ key }) => key === "razor-beast"), false)
  } finally {
    await prisma.planetUnitTransaction.deleteMany({
      where: { planetId: { in: planetIds } },
    }).catch(() => {})
    await prisma.planetUnitStack.deleteMany({
      where: { planetId: { in: planetIds } },
    }).catch(() => {})
    await prisma.planetMaterialTransaction.deleteMany({
      where: { planetId: { in: planetIds } },
    }).catch(() => {})
    await prisma.planet.deleteMany({
      where: { id: { in: planetIds } },
    }).catch(() => {})
    await prisma.user.deleteMany({
      where: { id: { in: ownerIds } },
    }).catch(() => {})

    if (baseline !== undefined) {
      assert.deepEqual(await rowCounts(prisma), baseline)
    }
    await prisma.$disconnect()
  }
})

test("command-center UI is read-only, complete, navigable, and mobile-safe", async () => {
  const page = await source("app/civilization/page.js")
  const styles = await source("app/globals.css")
  const accountPage = await source("app/account/page.js")
  const planetsPage = await source("app/planets/page.js")
  const planetPage = await source("app/planets/[planetId]/page.js")

  for (const text of [
    "Civilization Command",
    "Command Center",
    "Worlds",
    "Materials",
    "Ground forces",
    "Planets",
    "Civilization ground forces",
    "Recent activity",
    "No civilization activity yet.",
    "Open planet",
  ]) {
    assert.match(page, new RegExp(text, "u"))
  }
  assert.match(page, /signedDelta\(entry\.delta\)/u)
  assert.match(page, /href="\/faction"/u)
  assert.match(page, /href="\/planets"/u)
  assert.match(page, /href="\/account"/u)
  assert.doesNotMatch(
    page,
    /transactionId|operationKey|ownerId|userId|session|token|password/iu,
  )
  for (const navigationPage of [accountPage, planetsPage, planetPage]) {
    assert.equal((navigationPage.match(/href="\/civilization"/gu) ?? []).length, 1)
  }
  assert.match(styles, /\.command-center-page \{[\s\S]*overflow-x: hidden/u)
  assert.match(styles, /\.command-center-planet-id \{[\s\S]*overflow-wrap: anywhere/u)
  assert.match(styles, /\.command-center-summary dd \{[\s\S]*overflow-wrap: anywhere/u)
  assert.match(styles, /@media \(min-width: 48rem\)/u)
  assert.match(styles, /min-height: 2\.75rem/u)
})
