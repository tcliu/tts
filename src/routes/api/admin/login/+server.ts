import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE,
  ADMIN_SESSION_REMEMBER_MAX_AGE,
  ADMIN_SESSION_REMEMBER_TTL_MS,
  ADMIN_SESSION_TTL_MS,
  createSessionToken,
  getAdminUsername,
  isLoginRateLimited,
  recordLoginAttempt,
  verifyAdminCredentials,
} from '$lib/server/admin-auth'
import { logEvent } from '$lib/server/logging'
import { isProdRuntime } from '$lib/server/profile'

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
  const ip = getRequestIpSafe(getClientAddress)
  if (await isLoginRateLimited(ip)) {
    logEvent({ ip, action: 'admin_login_rate_limited', details: { level: 'WARN' } })
    return json({ error: 'rate_limited' }, { status: 429 })
  }
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return json({ error: 'invalid_request' }, { status: 400 })
  const record = body as Record<string, unknown>
  const username = typeof record.username === 'string' ? record.username : ''
  const password = typeof record.password === 'string' ? record.password : ''
  const rememberMe = record.remember_me === true
  const adminUsername = getAdminUsername()
  if (!(await verifyAdminCredentials(username, password))) {
    await recordLoginAttempt(ip)
    logEvent({ ip, action: 'admin_login_failed', details: { username: adminUsername } })
    return json({ error: 'invalid_credentials' }, { status: 401 })
  }
  const ttlMs = rememberMe ? ADMIN_SESSION_REMEMBER_TTL_MS : ADMIN_SESSION_TTL_MS
  cookies.set(ADMIN_SESSION_COOKIE, createSessionToken(ttlMs), {
    httpOnly: true, sameSite: 'strict', secure: isProdRuntime(), path: '/',
    maxAge: rememberMe ? ADMIN_SESSION_REMEMBER_MAX_AGE : ADMIN_SESSION_MAX_AGE,
  })
  logEvent({ ip, action: 'admin_login', details: { username: adminUsername, remember_me: rememberMe } })
  return json({ ok: true })
}

function getRequestIpSafe(getClientAddress: () => string): string {
  try {
    return getClientAddress()
  } catch {
    return 'unknown'
  }
}
