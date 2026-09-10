import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { ADMIN_SESSION_COOKIE } from '$lib/server/admin-auth'
import { logEvent } from '$lib/server/logging'
import { isProdRuntime } from '$lib/server/profile'

export const POST: RequestHandler = async ({ cookies, getClientAddress }) => {
  let ip = 'unknown'
  try {
    ip = getClientAddress()
  } catch {
    ip = 'unknown'
  }
  cookies.delete(ADMIN_SESSION_COOKIE, { path: '/', sameSite: 'strict', secure: isProdRuntime() })
  logEvent({ ip, action: 'admin_logout' })
  return json({ ok: true })
}
