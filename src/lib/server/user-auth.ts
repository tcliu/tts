import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Cookies } from '@sveltejs/kit'

export const USER_SESSION_COOKIE = 'tts-user-session'
export const USER_SESSION_TTL_MS = 24 * 60 * 60 * 1000
export const USER_SESSION_MAX_AGE = 60 * 60 * 24
export const USER_SESSION_REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const USER_SESSION_REMEMBER_MAX_AGE = 60 * 60 * 24 * 30

export function isProdRuntime(): boolean {
  return process.env.PROFILE === 'prod' || process.env.VERCEL === '1'
}

function sessionSecret(): string {
  const explicit = (process.env.SESSION_SECRET || '').trim()
  if (explicit) {
    return explicit
  }
  if (isProdRuntime()) {
    throw new Error('SESSION_SECRET must be set in production')
  }
  return 'dev-session-secret'
}

export function createUserSessionToken(userId: number, ttlMs = USER_SESSION_TTL_MS): string {
  const payload = JSON.stringify({ sub: userId, exp: Date.now() + ttlMs })
  const body = Buffer.from(payload, 'utf8').toString('base64url')
  const signature = createHmac('sha256', sessionSecret()).update(body).digest('base64url')
  return `${body}.${signature}`
}

function verifyUserSessionToken(token: string | null | undefined): number | null {
  if (!token) {
    return null
  }
  const parts = token.split('.')
  if (parts.length !== 2) {
    return null
  }
  const [body, signature] = parts
  if (!body || !signature) {
    return null
  }
  const expected = createHmac('sha256', sessionSecret()).update(body).digest('base64url')
  if (signature.length !== expected.length) {
    return null
  }
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { sub?: unknown; exp?: unknown }
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) {
      return null
    }
    if (typeof payload.sub !== 'number' || !Number.isSafeInteger(payload.sub)) {
      return null
    }
    return payload.sub
  } catch {
    return null
  }
}

export function getCurrentUserId(cookies: Pick<Cookies, 'get'>): number | null {
  return verifyUserSessionToken(cookies.get(USER_SESSION_COOKIE))
}
