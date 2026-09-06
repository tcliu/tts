import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { logEvent } from '$lib/server/logging'
import { ADMIN_SESSION_COOKIE } from '$lib/server/admin-auth'
import { USER_SESSION_COOKIE } from '$lib/server/user-auth'

export const POST: RequestHandler = async ({ cookies, getClientAddress }) => {
  const ip = getClientAddress()
  const hadAdmin = cookies.get(ADMIN_SESSION_COOKIE) !== undefined
  cookies.delete(USER_SESSION_COOKIE, { path: '/' })
  cookies.delete(ADMIN_SESSION_COOKIE, { path: '/' })
  logEvent({ ip, action: hadAdmin ? 'admin_logout' : 'user_logout' })
  return json({ ok: true })
}
