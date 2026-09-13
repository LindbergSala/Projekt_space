export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const responseOptions = {
  headers: { "Cache-Control": "no-store" },
}

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ ok: false }, { ...responseOptions, status: 404 })
  }

  try {
    const { default: prisma } = await import("../../../../lib/prisma.js")
    const rows = await prisma.$queryRaw`
      SELECT ${1}::integer AS probe,
             current_user AS user_name,
             current_database() AS database_name
    `
    const identity = rows[0]

    if (
      identity?.probe === 1 &&
      identity.user_name === "projekt_space_app" &&
      identity.database_name === "projekt_space_dev"
    ) {
      return Response.json({ ok: true }, responseOptions)
    }
  } catch {
    // Do not expose connection details or raw database errors.
  }

  return Response.json({ ok: false }, { ...responseOptions, status: 503 })
}
