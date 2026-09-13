import "server-only"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL

  if (typeof databaseUrl !== "string" || databaseUrl.length === 0) {
    throw new Error("DATABASE_URL is missing.")
  }

  const adapter = new PrismaPg({ connectionString: databaseUrl })
  return new PrismaClient({ adapter })
}

const prisma = process.env.NODE_ENV === "production"
  ? createPrismaClient()
  : globalThis.projektSpacePrisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") {
  globalThis.projektSpacePrisma = prisma
}

export default prisma
