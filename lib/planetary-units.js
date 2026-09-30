function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value
  }

  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue)
  }

  return Object.freeze(value)
}

const GENERAL_UNITS = deepFreeze([
  {
    scope: "general",
    key: "line-infantry",
    name: "Line Infantry",
    category: "Infantry",
    primaryFunction:
      "Standard frontline troops used to capture territory, hold positions, and engage enemy infantry.",
    battlefieldRoles: [
      "Basic and most common planetary combat unit",
      "Effective against other standard infantry",
      "Balanced between offense and defense",
      "Cost-efficient for taking and holding territory",
      "Vulnerable to specialized assault units, heavy weapons, and armored units",
    ],
    designPrinciple:
      "Line Infantry is the benchmark unit around which the rest of the planetary roster is balanced.",
  },
  {
    scope: "general",
    key: "assault-infantry",
    name: "Assault Infantry",
    category: "Infantry",
    primaryFunction:
      "Close-range offensive troops specialized in breaking enemy infantry formations and fortified positions.",
    battlefieldRoles: [
      "Strong against Line Infantry",
      "Effective during offensive planetary assaults",
      "Effective against defended infantry positions",
      "Shorter effective combat range than Line Infantry",
      "Vulnerable to Heavy Weapons Infantry",
      "Poor against armored units",
    ],
    designPrinciple:
      "Assault Infantry is the standard offensive infantry option. It sacrifices flexibility for greater close-range offensive capability.",
  },
  {
    scope: "general",
    key: "heavy-weapons-infantry",
    name: "Heavy Weapons Infantry",
    category: "Infantry",
    primaryFunction:
      "Specialized infantry equipped to engage armored units, heavy targets, and fortified positions.",
    battlefieldRoles: [
      "Strong against Light Tanks",
      "Capable of threatening Heavy Tanks",
      "Effective against fortified targets",
      "Vulnerable to Assault Infantry",
      "Less efficient than Line Infantry in normal infantry combat",
      "More expensive and slower to produce than Line Infantry",
    ],
    designPrinciple:
      "Heavy Weapons Infantry provides the cheapest general anti-armour option and prevents players from being forced to counter tanks exclusively with other tanks.",
  },
  {
    scope: "general",
    key: "light-tank",
    name: "Light Tank",
    category: "Armoured",
    primaryFunction:
      "A fast armored combat unit designed to overwhelm infantry and provide mobile frontline firepower.",
    battlefieldRoles: [
      "Strong against Line Infantry",
      "Strong against Assault Infantry",
      "Effective against Combat Engineers",
      "Capable of fighting other Light Tanks",
      "Vulnerable to Heavy Weapons Infantry",
      "Clearly inferior to Heavy Tanks in direct armored combat",
      "Faster and cheaper than Heavy Tanks",
    ],
    designPrinciple:
      "Light Tanks provide mobility and anti-infantry firepower rather than dedicated anti-tank capability.",
  },
  {
    scope: "general",
    key: "heavy-tank",
    name: "Heavy Tank",
    category: "Armoured",
    primaryFunction:
      "A heavily armored frontline combat unit designed to destroy armored targets, break fortified positions, and survive sustained enemy fire.",
    battlefieldRoles: [
      "Strong against Light Tanks",
      "Strong against Line Infantry",
      "Strong against Assault Infantry",
      "Effective against fortified positions",
      "Highly resistant to ordinary infantry weapons",
      "Vulnerable to dedicated anti-armour units",
      "More expensive and slower than Light Tanks",
      "One of the most expensive general planetary combat units",
    ],
    designPrinciple:
      "Heavy Tanks win through armor, firepower, and endurance rather than mobility.",
  },
  {
    scope: "general",
    key: "field-artillery",
    name: "Field Artillery",
    category: "Fire Support",
    primaryFunction:
      "Long-range fire support designed to bombard concentrated enemy forces and fortified positions from behind the frontline.",
    battlefieldRoles: [
      "Strong against concentrated infantry",
      "Strong against Assault Infantry before they reach the frontline",
      "Effective against fortified positions",
      "Provides fire support from behind friendly forces",
      "Weak in direct combat",
      "Highly vulnerable when reached by enemy units",
      "Limited effectiveness against Heavy Tanks",
    ],
    designPrinciple:
      "Field Artillery provides range, bombardment, and siege support rather than direct frontline combat power.",
  },
  {
    scope: "general",
    key: "combat-engineer",
    name: "Combat Engineer",
    category: "Support",
    primaryFunction:
      "A specialized support unit used to repair armored forces, reinforce defensive positions, and assist assaults against fortified targets.",
    battlefieldRoles: [
      "Repairs Light Tanks",
      "Repairs Heavy Tanks",
      "Repairs and reinforces defensive structures",
      "Improves fortified positions",
      "Supports attacks against enemy fortifications",
      "Weak in direct combat",
      "Requires protection from combat units",
    ],
    designPrinciple:
      "Combat Engineers provide repair, fortification, and siege utility rather than direct damage.",
  },
])

const FACTIONS = deepFreeze([
  {
    key: "orthevan-directorate",
    name: "Orthevan Directorate",
    uniqueUnits: [
      {
        scope: "faction",
        factionKey: "orthevan-directorate",
        key: "vanguard-exosuit",
        name: "Vanguard Exosuit",
        category: "Heavy mechanized infantry",
        primaryFunction:
          "Frontline assault, fortified-position breach, and hazardous-environment operations.",
        battlefieldRoles: [
          "Breaching fortified positions",
          "Securing critical infrastructure",
          "Holding narrow defensive corridors",
          "Heavy frontline assault",
          "Fighting in hazardous environments",
        ],
        uniqueRole: "Elite Breaching Infantry",
      },
      {
        scope: "faction",
        factionKey: "orthevan-directorate",
        key: "siege-strider",
        name: "Siege Strider",
        category: "Heavy walking weapons platform",
        primaryFunction:
          "Mobile heavy support and fortified-position destruction.",
        battlefieldRoles: [
          "Advance with infantry",
          "Destroy strongpoints",
          "Absorb enemy fire",
          "Fire over friendly formations and battlefield obstacles",
          "Provide mobile heavy support",
          "Help engineers and infantry secure territory behind the advance",
        ],
        uniqueRole: "Heavy Siege Platform",
      },
    ],
  },
  {
    key: "zhyreth-brood",
    name: "Zhyreth Brood",
    uniqueUnits: [
      {
        scope: "faction",
        factionKey: "zhyreth-brood",
        key: "razor-beast",
        name: "Razor Beast",
        category: "Biological assault organism",
        primaryFunction: "Rapid close-range line breaking.",
        battlefieldRoles: [
          "Close the distance before enemy firepower can stop them",
          "Tear open enemy lines at close range",
          "Break defensive positions quickly",
        ],
        uniqueRole: "Rapid Shock Assault",
      },
      {
        scope: "faction",
        factionKey: "zhyreth-brood",
        key: "spore-caster",
        name: "Spore Caster",
        category: "Living artillery organism",
        primaryFunction:
          "Biological ranged support and battlefield-area disruption.",
        battlefieldRoles: [
          "Rupture biological projectiles on impact",
          "Release corrosive organisms",
          "Produce obscuring spore clouds",
          "Interfere with exposed equipment",
          "Contaminate terrain",
          "Force enemies away from important positions",
        ],
        uniqueRole: "Battlefield Control and Disruption",
      },
    ],
  },
  {
    key: "nhalorin-continuum",
    name: "Nhalorin Continuum",
    uniqueUnits: [
      {
        scope: "faction",
        factionKey: "nhalorin-continuum",
        key: "aegis-construct",
        name: "Aegis Construct",
        category: "Heavy defensive combat construct",
        primaryFunction: "Hold critical ground and absorb sustained attack.",
        battlefieldRoles: [
          "Defend archive complexes",
          "Defend strategic energy nodes",
          "Defend command structures",
          "Defend critical infrastructure",
          "Absorb sustained attack",
        ],
        uniqueRole: "Defensive Anchor",
      },
      {
        scope: "faction",
        factionKey: "nhalorin-continuum",
        key: "phase-reaper",
        name: "Phase Reaper",
        category: "Advanced ranged combat construct",
        primaryFunction:
          "Precision anti-armour and high-value-target elimination.",
        battlefieldRoles: [
          "Eliminate armored targets with precision phase technology",
          "Eliminate exposed high-value targets",
          "Make conventional protection temporarily irrelevant through spatial instability",
        ],
        uniqueRole: "Premium Anti-Armour Specialist",
      },
    ],
  },
  {
    key: "draskyr-clans",
    name: "Draskyr Clans",
    uniqueUnits: [
      {
        scope: "faction",
        factionKey: "draskyr-clans",
        key: "scrap-brute",
        name: "Scrap Brute",
        category: "Heavy assault warrior",
        primaryFunction:
          "Close-range breakthrough and line-breaking assault.",
        battlefieldRoles: [
          "Get close",
          "Break the line",
          "Survive long enough for everyone else to follow",
        ],
        uniqueRole: "Heavy Close-Range Shock Assault",
      },
      {
        scope: "faction",
        factionKey: "draskyr-clans",
        key: "rift-raider",
        name: "Rift Raider",
        category: "Fast assault specialist",
        primaryFunction:
          "Flanking, boarding, rapid penetration, and vulnerable-target elimination.",
        battlefieldRoles: [
          "Flank enemy positions",
          "Board enemy targets",
          "Penetrate defensive perimeters rapidly",
          "Eliminate communication centers",
          "Eliminate artillery positions",
          "Disrupt supply lines",
          "Eliminate command units",
          "Finish damaged vehicles and exposed high-value targets",
        ],
        uniqueRole: "Fast Deep-Strike / Support Hunter",
      },
    ],
  },
])

const ALL_UNITS = deepFreeze([
  ...GENERAL_UNITS,
  ...FACTIONS.flatMap((faction) => faction.uniqueUnits),
])

const FACTION_SUMMARIES = deepFreeze(
  FACTIONS.map((faction) => ({
    key: faction.key,
    name: faction.name,
    uniqueUnitNames: faction.uniqueUnits.map((unit) => unit.name),
  })),
)

const ROSTERS_BY_FACTION_KEY = deepFreeze(
  Object.fromEntries(
    FACTIONS.map((faction) => [
      faction.key,
      deepFreeze([...GENERAL_UNITS, ...faction.uniqueUnits]),
    ]),
  ),
)

export function getPlanetaryFactionSummaries() {
  return FACTION_SUMMARIES
}

export function getPlanetaryFactionSummary(key) {
  return FACTION_SUMMARIES.find((faction) => faction.key === key) ?? null
}

export function getGeneralPlanetaryUnits() {
  return GENERAL_UNITS
}

export function getPlanetaryUnits() {
  return ALL_UNITS
}

export function getPlanetaryFaction(key) {
  return FACTIONS.find((faction) => faction.key === key) ?? null
}

export function getPlanetaryRosterForFaction(key) {
  if (typeof key !== "string" || !Object.hasOwn(ROSTERS_BY_FACTION_KEY, key)) {
    return null
  }

  return ROSTERS_BY_FACTION_KEY[key]
}
