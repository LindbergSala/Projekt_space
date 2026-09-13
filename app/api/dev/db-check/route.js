export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const responseOptions = {
  headers: { "Cache-Control": "no-store" },
}
const diagnosticErrorCodes = new Set([
  "P1000",
  "P1001",
  "P1002",
  "P1017",
  "P2010",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "28P01",
])

function logStageFailure(stage, error) {
  const code = error && typeof error === "object" &&
    diagnosticErrorCodes.has(error.code)
    ? error.code
    : "unclassified"

  console.error(`db-check ${stage} failed; code=${code}`)
}

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ ok: false }, { ...responseOptions, status: 404 })
  }

  let stage = "client-import"

  try {
    const { default: prisma } = await import("../../../../lib/prisma.js")
    stage = "query"
    const rows = await prisma.$queryRaw`
      SELECT ${1}::integer AS probe,
             current_user AS user_name,
             current_database() AS database_name
    `
    stage = "validation"
    const identity = rows[0]
    const probeMatch = identity?.probe === 1
    const userMatch = identity?.user_name === "projekt_space_app"
    const databaseMatch = identity?.database_name === "projekt_space_dev"

    if (probeMatch && userMatch && databaseMatch) {
      return Response.json({ ok: true }, responseOptions)
    }

    console.error("db-check validation mismatch", {
      probeMatch,
      userMatch,
      databaseMatch,
    })
  } catch (error) {
    logStageFailure(stage, error)
  }

  return Response.json({ ok: false }, { ...responseOptions, status: 503 })
}
