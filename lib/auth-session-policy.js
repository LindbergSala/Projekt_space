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

  const userId = session.user?.id

  if (
    typeof userId !== "string" ||
    userId.length === 0 ||
    userId.trim() !== userId
  ) {
    throw new Error("Authenticated session is missing a valid user ID.")
  }

  return userId
}
