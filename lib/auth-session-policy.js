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
