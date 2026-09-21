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
const AUTH_ORIGIN_CONFIGURATION_ERROR =
  "Better Auth requires a valid explicit application origin."
const PREVIEW_ORIGIN_CONFIGURATION_ERROR =
  "Better Auth preview origin configuration is invalid."
const PRODUCTION_ORIGIN_CONFIGURATION_ERROR =
  "Better Auth production deployment origin configuration is invalid."
const VERCEL_DEPLOYMENT_HOST_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/u

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

function normalizeExplicitOrigin(value, { httpsOnly }) {
  if (value === undefined || value.trim() !== value) {
    throw new Error(AUTH_ORIGIN_CONFIGURATION_ERROR)
  }

  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(AUTH_ORIGIN_CONFIGURATION_ERROR)
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    (httpsOnly && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== "/" ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(AUTH_ORIGIN_CONFIGURATION_ERROR)
  }

  return url.origin
}

function getVercelPreviewOrigin(environment) {
  if (environment.VERCEL !== "1") {
    throw new Error(PREVIEW_ORIGIN_CONFIGURATION_ERROR)
  }

  const configuredHost = configuredValue(environment, "VERCEL_URL")
  if (
    configuredHost === undefined ||
    configuredHost.length > 253 ||
    !VERCEL_DEPLOYMENT_HOST_PATTERN.test(configuredHost)
  ) {
    throw new Error(PREVIEW_ORIGIN_CONFIGURATION_ERROR)
  }

  const previewOrigin = `https://${configuredHost}`
  const configuredOrigin = configuredValue(environment, "BETTER_AUTH_URL")

  if (
    configuredOrigin !== undefined &&
    normalizeExplicitOrigin(configuredOrigin, { httpsOnly: true }) !==
      previewOrigin
  ) {
    throw new Error(PREVIEW_ORIGIN_CONFIGURATION_ERROR)
  }

  return previewOrigin
}

function getTrustedOrigins(environment, baseURL) {
  if (environment.VERCEL_ENV !== "production") {
    return [baseURL]
  }

  const configuredHost = configuredValue(environment, "VERCEL_URL")
  if (
    environment.VERCEL !== "1" ||
    configuredHost === undefined ||
    configuredHost.length > 253 ||
    !VERCEL_DEPLOYMENT_HOST_PATTERN.test(configuredHost)
  ) {
    throw new Error(PRODUCTION_ORIGIN_CONFIGURATION_ERROR)
  }

  return [...new Set([baseURL, `https://${configuredHost}`])]
}

export function resolveAuthBaseURL(environment) {
  if (environment.VERCEL_ENV === "preview") {
    return getVercelPreviewOrigin(environment)
  }

  const configuredOrigin = configuredValue(environment, "BETTER_AUTH_URL")
  return normalizeExplicitOrigin(configuredOrigin, {
    httpsOnly: environment.NODE_ENV === "production",
  })
}

export function createAuthOptions({
  environment = process.env,
  prismaClient = prisma,
  createAdapter = prismaAdapter,
} = {}) {
  const google = getGoogleProvider(environment)
  const baseURL = resolveAuthBaseURL(environment)
  const trustedOrigins = getTrustedOrigins(environment, baseURL)

  return {
    database: createAdapter(prismaClient, { provider: "postgresql" }),
    secret: getSecret(environment),
    baseURL,
    trustedOrigins,
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
