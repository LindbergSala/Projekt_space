import "server-only"

import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"

import prisma from "./prisma.js"

const MINIMUM_SECRET_LENGTH = 32
const EXAMPLE_SECRET = "replace-with-random-secret-at-least-32-characters"
const SECRET_CONFIGURATION_ERROR =
  "BETTER_AUTH_SECRET must be a non-placeholder value of at least 32 characters."
const GOOGLE_CONFIGURATION_ERROR =
  "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must either both be set or both be absent."

function configuredValue(environment, name) {
  const value = environment[name]

  if (typeof value !== "string" || value.length === 0) {
    return undefined
  }

  return value
}

function getSecret(environment) {
  const secret = configuredValue(environment, "BETTER_AUTH_SECRET")

  if (
    secret === undefined ||
    secret === EXAMPLE_SECRET ||
    secret.length < MINIMUM_SECRET_LENGTH ||
    secret.trim() !== secret
  ) {
    throw new Error(SECRET_CONFIGURATION_ERROR)
  }

  return secret
}

function getGoogleProvider(environment) {
  const clientId = configuredValue(environment, "GOOGLE_CLIENT_ID")
  const clientSecret = configuredValue(environment, "GOOGLE_CLIENT_SECRET")

  if ((clientId === undefined) !== (clientSecret === undefined)) {
    throw new Error(GOOGLE_CONFIGURATION_ERROR)
  }

  return clientId === undefined ? undefined : { clientId, clientSecret }
}

export function createAuthOptions({
  environment = process.env,
  prismaClient = prisma,
  createAdapter = prismaAdapter,
} = {}) {
  const google = getGoogleProvider(environment)
  const baseURL = configuredValue(environment, "BETTER_AUTH_URL")

  return {
    database: createAdapter(prismaClient, { provider: "postgresql" }),
    secret: getSecret(environment),
    ...(baseURL === undefined ? {} : { baseURL }),
    emailAndPassword: {
      enabled: true,
    },
    account: {
      accountLinking: {
        disableImplicitLinking: true,
      },
    },
    ...(google === undefined
      ? {}
      : {
          socialProviders: {
            google,
          },
        }),
  }
}

export const auth = betterAuth(createAuthOptions())
