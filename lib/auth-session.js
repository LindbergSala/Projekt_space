import "server-only"

import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "./auth.js"
import {
  resolveAuthenticatedUser,
  resolveAuthenticatedUserId,
  resolveOptionalAuthenticatedUserId,
} from "./auth-session-policy.js"

export function requireAuthenticatedUser() {
  return resolveAuthenticatedUser({
    getSession: auth.api.getSession,
    getRequestHeaders: headers,
    redirectUnauthenticated: redirect,
  })
}

export function requireAuthenticatedUserId() {
  return resolveAuthenticatedUserId({
    getSession: auth.api.getSession,
    getRequestHeaders: headers,
    redirectUnauthenticated: redirect,
  })
}

export function getOptionalAuthenticatedUserId() {
  return resolveOptionalAuthenticatedUserId({
    getSession: auth.api.getSession,
    getRequestHeaders: headers,
  })
}
