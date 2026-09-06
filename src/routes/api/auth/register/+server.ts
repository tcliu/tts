import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getAdminUsername, isLoginRateLimited, recordLoginAttempt } from '$lib/server/admin-auth'
import { logEvent } from '$lib/server/logging'
import { USER_SESSION_COOKIE, USER_SESSION_MAX_AGE, createUserSessionToken, isProdRuntime } from '$lib/server/user-auth'
import { createUser } from '$lib/server/users'
import { getPasswordMinLength } from '$lib/server/admin-properties'

function isBodyRecord(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null
}

export const POST: RequestHandler = async ({ request, getClientAddress, cookies }) => {
  const ip = getClientAddress()
  if (await isLoginRateLimited(ip)) {
    logEvent({ ip, action: 'user_register_rate_limited', details: { level: 'WARN' } })
    return json({ error: 'rate_limited' }, { status: 429 })
  }
  const body = await request.json().catch(() => ({}))
  if (!isBodyRecord(body)) return json({ error: 'invalid_request' }, { status: 400 })

  const username = typeof body.username === 'string' ? body.username : ''
  const email = typeof body.email === 'string' ? body.email : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (username.trim().toLowerCase() === getAdminUsername().toLowerCase()) {
    await recordLoginAttempt(ip)
    logEvent({ ip, action: 'user_register_failed', details: { username: username.trim().toLowerCase(), error: 'registration_failed' } })
    return json({ error: 'registration_failed' }, { status: 400 })
  }

  let user
  try {
    user = await createUser({ username, email, password })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed_to_create_user'
    await recordLoginAttempt(ip)
    logEvent({ ip, action: 'user_register_failed', details: { username: username.trim().toLowerCase(), error: message } })
    // Short passwords are input validation, safe to surface; duplicates stay
    // generic so account existence cannot be enumerated.
    if (message === 'password_too_short') {
      return json({ error: 'password_too_short', min_length: getPasswordMinLength() }, { status: 400 })
    }
    return json({ error: 'registration_failed' }, { status: 400 })
  }

  cookies.set(USER_SESSION_COOKIE, createUserSessionToken(user.id), {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProdRuntime(),
    path: '/',
    maxAge: USER_SESSION_MAX_AGE,
  })
  logEvent({ ip, action: 'user_register', details: { username: user.username } })
  return json({ user }, { status: 201 })
}
