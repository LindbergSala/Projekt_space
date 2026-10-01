const AUTHENTICATED_SESSION_ERROR =
  "Authenticated session is missing a valid user ID."

function authenticatedUserIdFromSession(session) {
  const userId = session.user?.id

  if (
    typeof userId !== "string" ||
    userId.length === 0 ||
    userId.trim() !== userId
  ) {
    throw new Error(AUTHENTICATED_SESSION_ERROR)
  }

  return userId
}

export async function resolveAuthenticatedUser({
  getSession,
  getRequestHeaders,
  redirectUnauthenticated,
}) {
  const session = await getSession({
    headers: await getRequestHeaders(),
  })

  if (!session) {
    return redirectUnauthenticated("/login")
  }

  return {
    name: session.user.name,
    email: session.user.email,
  }
}

export async function resolveAuthenticatedUserId({
  getSession,
  getRequestHeaders,
  redirectUnauthenticated,
}) {
  const session = await getSession({
    headers: await getRequestHeaders(),
  })

  if (!session) {
    return redirectUnauthenticated("/login")
  }

  return authenticatedUserIdFromSession(session)
}

export async function resolveOptionalAuthenticatedUserId({
  getSession,
  getRequestHeaders,
}) {
  const session = await getSession({
    headers: await getRequestHeaders(),
  })

  if (!session) {
    return null
  }

  return authenticatedUserIdFromSession(session)
}
