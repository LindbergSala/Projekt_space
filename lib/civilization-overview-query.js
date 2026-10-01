import {
  getPlanetaryFactionSummary,
  getPlanetaryRosterForFaction,
} from "./planetary-units.js"

export const CIVILIZATION_OVERVIEW_ERROR =
  "Unable to read the civilization command center."

const POSTGRES_BIGINT_MINIMUM = -9_223_372_036_854_775_808n
const POSTGRES_BIGINT_MAXIMUM = 9_223_372_036_854_775_807n
const ACTIVITY_LIMIT = 20

function fail() {
  throw new Error(CIVILIZATION_OVERVIEW_ERROR)
}

function isValidOwnerId(ownerId) {
  return (
    typeof ownerId === "string" &&
    ownerId.length > 0 &&
    ownerId.trim() === ownerId
  )
}

function isPostgresBigInt(value) {
  return (
    typeof value === "bigint" &&
    value >= POSTGRES_BIGINT_MINIMUM &&
    value <= POSTGRES_BIGINT_MAXIMUM
  )
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

function compareActivity(left, right) {
  const timestampOrder = right.createdAt.getTime() - left.createdAt.getTime()
  if (timestampOrder !== 0) {
    return timestampOrder
  }

  if (left.kind !== right.kind) {
    return left.kind === "materials" ? -1 : 1
  }

  if (left.id === right.id) {
    return 0
  }

  return left.id > right.id ? -1 : 1
}

function serializeActivity(activity) {
  if (activity.kind === "materials") {
    return {
      kind: activity.kind,
      planetId: activity.planetId,
      planetName: activity.planetName,
      delta: activity.delta.toString(),
      balanceAfter: activity.balanceAfter.toString(),
      createdAt: activity.createdAt.toISOString(),
    }
  }

  return {
    kind: activity.kind,
    planetId: activity.planetId,
    planetName: activity.planetName,
    unitKey: activity.unitKey,
    unitName: activity.unitName,
    delta: activity.delta.toString(),
    quantityAfter: activity.quantityAfter.toString(),
    createdAt: activity.createdAt.toISOString(),
  }
}

export async function queryCivilizationCommandCenterForOwner({
  ownerId,
  prismaClient,
}) {
  if (
    !isValidOwnerId(ownerId) ||
    typeof prismaClient?.$transaction !== "function"
  ) {
    fail()
  }

  try {
    return await prismaClient.$transaction(async (transaction) => {
      const user = await transaction.user.findUnique({
        where: { id: ownerId },
        select: { factionKey: true },
      })

      if (user === null) {
        fail()
      }

      if (user.factionKey === null) {
        return null
      }

      const faction = getPlanetaryFactionSummary(user.factionKey)
      const roster = getPlanetaryRosterForFaction(user.factionKey)
      if (faction === null || roster === null) {
        fail()
      }

      const planets = await transaction.planet.findMany({
        where: { ownerId },
        select: {
          id: true,
          name: true,
          materials: true,
          unitStacks: {
            select: {
              unitKey: true,
              quantity: true,
            },
          },
        },
        orderBy: { id: "asc" },
      })
      const materialTransactions =
        await transaction.planetMaterialTransaction.findMany({
          where: { planet: { ownerId } },
          select: {
            id: true,
            planetId: true,
            delta: true,
            balanceAfter: true,
            createdAt: true,
          },
          orderBy: [
            { createdAt: "desc" },
            { id: "desc" },
          ],
          take: ACTIVITY_LIMIT,
        })
      const unitTransactions =
        await transaction.planetUnitTransaction.findMany({
          where: { planet: { ownerId } },
          select: {
            id: true,
            planetId: true,
            unitKey: true,
            delta: true,
            quantityAfter: true,
            createdAt: true,
          },
          orderBy: [
            { createdAt: "desc" },
            { id: "desc" },
          ],
          take: ACTIVITY_LIMIT,
        })

      const rosterByKey = new Map(roster.map((unit) => [unit.key, unit]))
      const forceTotals = new Map(roster.map((unit) => [unit.key, 0n]))
      const planetsById = new Map()
      let materialsTotal = 0n
      let groundForcesTotal = 0n

      const serializedPlanets = planets.map((planet) => {
        if (
          typeof planet.id !== "string" ||
          planet.id.length === 0 ||
          typeof planet.name !== "string" ||
          !isPostgresBigInt(planet.materials) ||
          planet.materials < 0n ||
          !Array.isArray(planet.unitStacks) ||
          planetsById.has(planet.id)
        ) {
          fail()
        }

        planetsById.set(planet.id, planet.name)
        materialsTotal += planet.materials

        const planetUnitKeys = new Set()
        let planetGroundForces = 0n
        let occupiedUnitTypes = 0

        for (const stack of planet.unitStacks) {
          if (
            !rosterByKey.has(stack.unitKey) ||
            !isPostgresBigInt(stack.quantity) ||
            stack.quantity < 0n ||
            planetUnitKeys.has(stack.unitKey)
          ) {
            fail()
          }

          planetUnitKeys.add(stack.unitKey)
          planetGroundForces += stack.quantity
          forceTotals.set(
            stack.unitKey,
            forceTotals.get(stack.unitKey) + stack.quantity,
          )
          if (stack.quantity > 0n) {
            occupiedUnitTypes += 1
          }
        }

        groundForcesTotal += planetGroundForces

        return {
          id: planet.id,
          name: planet.name,
          materials: planet.materials.toString(),
          groundForces: planetGroundForces.toString(),
          occupiedUnitTypes,
        }
      })

      const materialActivity = materialTransactions.map((entry) => {
        const planetName = planetsById.get(entry.planetId)
        if (
          typeof entry.id !== "string" ||
          entry.id.length === 0 ||
          planetName === undefined ||
          !isPostgresBigInt(entry.delta) ||
          entry.delta === 0n ||
          !isPostgresBigInt(entry.balanceAfter) ||
          entry.balanceAfter < 0n ||
          !isValidDate(entry.createdAt)
        ) {
          fail()
        }

        return {
          kind: "materials",
          id: entry.id,
          planetId: entry.planetId,
          planetName,
          delta: entry.delta,
          balanceAfter: entry.balanceAfter,
          createdAt: entry.createdAt,
        }
      })

      const unitActivity = unitTransactions.map((entry) => {
        const planetName = planetsById.get(entry.planetId)
        const unit = rosterByKey.get(entry.unitKey)
        if (
          typeof entry.id !== "string" ||
          entry.id.length === 0 ||
          planetName === undefined ||
          unit === undefined ||
          !isPostgresBigInt(entry.delta) ||
          entry.delta === 0n ||
          !isPostgresBigInt(entry.quantityAfter) ||
          entry.quantityAfter < 0n ||
          !isValidDate(entry.createdAt)
        ) {
          fail()
        }

        return {
          kind: "unit",
          id: entry.id,
          planetId: entry.planetId,
          planetName,
          unitKey: entry.unitKey,
          unitName: unit.name,
          delta: entry.delta,
          quantityAfter: entry.quantityAfter,
          createdAt: entry.createdAt,
        }
      })

      const activity = [...materialActivity, ...unitActivity]
        .sort(compareActivity)
        .slice(0, ACTIVITY_LIMIT)
        .map(serializeActivity)

      return {
        faction: {
          key: faction.key,
          name: faction.name,
          uniqueUnitNames: [...faction.uniqueUnitNames],
        },
        summary: {
          planetCount: serializedPlanets.length,
          materials: materialsTotal.toString(),
          groundForces: groundForcesTotal.toString(),
        },
        planets: serializedPlanets,
        forces: roster.map(({ key, name, category }) => ({
          key,
          name,
          category,
          quantity: forceTotals.get(key).toString(),
        })),
        activity,
      }
    }, {
      isolationLevel: "RepeatableRead",
    })
  } catch {
    fail()
  }
}
