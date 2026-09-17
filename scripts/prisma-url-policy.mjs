const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"])
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u
const NEON_ENDPOINT_PATTERN = /^ep-[a-z0-9]+(?:-[a-z0-9]+)+$/u

export class PrismaUrlPolicyError extends Error {}

function fail(message) {
  throw new PrismaUrlPolicyError(message)
}

function parsePostgresTarget(value, variableName) {
  let url

  try {
    url = new URL(value)
  } catch {
    fail(`${variableName} must be a valid PostgreSQL URL.`)
  }

  if (!POSTGRES_PROTOCOLS.has(url.protocol)) {
    fail(`${variableName} must be a PostgreSQL URL.`)
  }

  let database
  try {
    database = decodeURIComponent(url.pathname.slice(1))
  } catch {
    fail(`${variableName} contains invalid URL encoding.`)
  }

  if (
    url.hostname.length === 0 ||
    url.username.length === 0 ||
    database.length === 0 ||
    database.includes("/")
  ) {
    fail(`${variableName} must identify one PostgreSQL database.`)
  }

  return {
    database,
    host: url.hostname.toLowerCase(),
    port: url.port || "5432",
  }
}

function isNeonHostname(host) {
  return host === "neon.tech" || host.endsWith(".neon.tech")
}

function parseNeonEndpoint(host, variableName) {
  if (!isNeonHostname(host)) {
    return undefined
  }

  const labels = host.split(".")
  if (
    labels.length < 5 ||
    labels.at(-2) !== "neon" ||
    labels.at(-1) !== "tech" ||
    labels.slice(1, -2).some((label) => !DNS_LABEL_PATTERN.test(label))
  ) {
    fail(`${variableName} has an invalid Neon endpoint hostname.`)
  }

  const endpointLabel = labels[0]
  const pooled = endpointLabel.endsWith("-pooler")
  const endpointIdentity = pooled
    ? endpointLabel.slice(0, -"-pooler".length)
    : endpointLabel

  if (
    !NEON_ENDPOINT_PATTERN.test(endpointIdentity) ||
    endpointIdentity.endsWith("-pooler")
  ) {
    fail(`${variableName} has an invalid Neon endpoint hostname.`)
  }

  return {
    endpointIdentity,
    pooled,
    routingDomain: labels.slice(1).join("."),
  }
}

function targetsSameDatabase(left, right) {
  if (left.database !== right.database || left.port !== right.port) {
    return false
  }

  const leftNeon = parseNeonEndpoint(left.host, "DATABASE_URL")
  const rightNeon = parseNeonEndpoint(right.host, "SHADOW_DATABASE_URL")

  if (leftNeon !== undefined || rightNeon !== undefined) {
    return leftNeon !== undefined &&
      rightNeon !== undefined &&
      leftNeon.endpointIdentity === rightNeon.endpointIdentity &&
      leftNeon.routingDomain === rightNeon.routingDomain
  }

  return left.host === right.host
}

export function assertDistinctDatabaseUrls(databaseUrl, shadowDatabaseUrl) {
  const database = parsePostgresTarget(databaseUrl, "DATABASE_URL")
  const shadowDatabase = parsePostgresTarget(
    shadowDatabaseUrl,
    "SHADOW_DATABASE_URL",
  )

  if (targetsSameDatabase(database, shadowDatabase)) {
    fail(
      "DATABASE_URL and SHADOW_DATABASE_URL must identify different databases.",
    )
  }
}

export function assertCompatibleMigrationDatabaseUrl(
  databaseUrl,
  migrationDatabaseUrl,
) {
  const database = parsePostgresTarget(databaseUrl, "DATABASE_URL")
  const migrationDatabase = parsePostgresTarget(
    migrationDatabaseUrl,
    "MIGRATION_DATABASE_URL",
  )

  if (
    database.database !== migrationDatabase.database ||
    database.port !== migrationDatabase.port
  ) {
    fail(
      "DATABASE_URL and MIGRATION_DATABASE_URL must identify the same database.",
    )
  }

  const runtimeNeon = parseNeonEndpoint(database.host, "DATABASE_URL")
  const migrationNeon = parseNeonEndpoint(
    migrationDatabase.host,
    "MIGRATION_DATABASE_URL",
  )

  if (runtimeNeon !== undefined || migrationNeon !== undefined) {
    if (
      runtimeNeon === undefined ||
      migrationNeon === undefined ||
      !runtimeNeon.pooled ||
      migrationNeon.pooled ||
      runtimeNeon.endpointIdentity !== migrationNeon.endpointIdentity ||
      runtimeNeon.routingDomain !== migrationNeon.routingDomain
    ) {
      fail(
        "DATABASE_URL and MIGRATION_DATABASE_URL must identify one Neon endpoint using pooled runtime and direct migration hosts.",
      )
    }

    return
  }

  if (database.host !== migrationDatabase.host) {
    fail(
      "DATABASE_URL and MIGRATION_DATABASE_URL must identify the same database.",
    )
  }
}

export function assertDirectNeonMigrationDatabaseUrl(migrationDatabaseUrl) {
  const migrationDatabase = parsePostgresTarget(
    migrationDatabaseUrl,
    "MIGRATION_DATABASE_URL",
  )
  const migrationNeon = parseNeonEndpoint(
    migrationDatabase.host,
    "MIGRATION_DATABASE_URL",
  )

  if (migrationNeon === undefined || migrationNeon.pooled) {
    fail("MIGRATION_DATABASE_URL must use a direct Neon endpoint.")
  }
}
