import { toNextJsHandler } from "better-auth/next-js"

import { auth } from "../../../../lib/auth.js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const { GET, POST } = toNextJsHandler(auth)
