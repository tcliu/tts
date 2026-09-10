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
  isAdminConfigured,
  isLoginRateLimited,
  recordLoginAttempt,
  verifyAdminCredentials,
} from '$lib/server/admin-auth'
import { logEvent } from '$lib/server/logging'
import {
  USER_SESSION_COOKIE,
  USER_SESSION_MAX_AGE,
  USER_SESSION_REMEMBER_MAX_AGE,
  USER_SESSION_REMEMBER_TTL_MS,
  USER_SESSION_TTL_MS,
  createUserSessionToken,
} from '$lib/server/user-auth'
import { isProdRuntime } from '$lib/server/profile'
import { findUserByCredentials } from '$lib/server/users'

function isBodyRecord(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null
}

export const POST: RequestHandler = async ({ request, getClientAddress, cookies }) => {
  const ip = getClientAddress()
  if (await isLoginRateLimited(ip)) {
    logEvent({ ip, action: 'user_login_rate_limited', details: { level: 'WARN' } })
    return json({ error: 'rate_limited' }, { status: 429 })
  }
  const body = await request.json().catch(() => ({}))
  if (!isBodyRecord(body)) return json({ error: 'invalid_request' }, { status: 400 })

  const identifier = typeof body.identifier === 'string' ? body.identifier : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const rememberMe = body.remember_me === true
  const adminUsername = getAdminUsername()
  if ((await isAdminConfigured()) && identifier.trim().toLowerCase() === adminUsername.toLowerCase()) {
    if (!(await verifyAdminCredentials(adminUsername, password))) {
      await recordLoginAttempt(ip)
      logEvent({ ip, action: 'admin_login_failed', details: { username: adminUsername, via: 'user-auth' } })
      return json({ error: 'invalid_credentials' }, { status: 401 })
    }
    const ttlMs = rememberMe ? ADMIN_SESSION_REMEMBER_TTL_MS : ADMIN_SESSION_TTL_MS
    cookies.set(ADMIN_SESSION_COOKIE, createSessionToken(ttlMs), {
      httpOnly: true, sameSite: 'strict', secure: isProdRuntime(), path: '/',
      maxAge: rememberMe ? ADMIN_SESSION_REMEMBER_MAX_AGE : ADMIN_SESSION_MAX_AGE,
    })
    logEvent({ ip, action: 'admin_login', details: { username: adminUsername, remember_me: rememberMe, via: 'user-auth' } })
    return json({ admin: true })
  }

  const user = await findUserByCredentials(identifier, password)
  if (!user) {
    await recordLoginAttempt(ip)
    logEvent({ ip, action: 'user_login_failed' })
    return json({ error: 'invalid_credentials' }, { status: 401 })
  }
  const ttlMs = rememberMe ? USER_SESSION_REMEMBER_TTL_MS : USER_SESSION_TTL_MS
  cookies.set(USER_SESSION_COOKIE, createUserSessionToken(user.id, ttlMs), {
    httpOnly: true, sameSite: 'strict', secure: isProdRuntime(), path: '/',
    maxAge: rememberMe ? USER_SESSION_REMEMBER_MAX_AGE : USER_SESSION_MAX_AGE,
  })
  logEvent({ ip, action: 'user_login', details: { username: user.username, remember_me: rememberMe } })
  return json({ user })
}
