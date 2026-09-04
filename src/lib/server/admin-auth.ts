import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { RequestEvent } from '@sveltejs/kit'

export const ADMIN_SESSION_COOKIE = 'tts-admin-session'
export const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000
export const ADMIN_SESSION_MAX_AGE = 60 * 60 * 24
export const ADMIN_SESSION_REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const ADMIN_SESSION_REMEMBER_MAX_AGE = 60 * 60 * 24 * 30

const LOGIN_MAX_ATTEMPTS = 5
const LOGIN_WINDOW_MS = 15 * 60 * 1000

function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, (error, derivedKey) => {
      if (error) {
        reject(error)
      } else {
        resolve(derivedKey)
      }
    })
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scryptAsync(password, salt, 32)
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parts = hash.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false
  }
  const salt = Buffer.from(parts[1], 'base64')
  const expected = Buffer.from(parts[2], 'base64')
  if (salt.length !== 16 || expected.length !== 32) {
    return false
  }
  const actual = await scryptAsync(password, salt, expected.length)
  return timingSafeEqual(actual, expected)
}

function sessionSecret(): string {
  const explicit = (process.env.SESSION_SECRET || '').trim()
  if (explicit) {
    return explicit
  }
  if (process.env.VERCEL === '1') {
    throw new Error('SESSION_SECRET must be set in production')
  }
  return 'dev-session-secret'
}

export function getAdminUsername(): string {
  return (process.env.ADMIN_USERNAME || '').trim() || 'admin'
}

let plainPasswordHash: Promise<string> | null = null

async function readAdminPassword(): Promise<{ hash: string | null; configured: boolean }> {
  const hash = (process.env.ADMIN_PASSWORD_HASH || '').trim()
  if (hash) {
    return { hash, configured: true }
  }
  const plain = (process.env.ADMIN_PASSWORD || '').trim()
  if (plain) {
    plainPasswordHash ??= hashPassword(plain)
    return { hash: await plainPasswordHash, configured: true }
  }
  return { hash: null, configured: false }
}

export async function isAdminConfigured(): Promise<boolean> {
  return (await readAdminPassword()).configured
}

export async function verifyAdminCredentials(username: string, password: string): Promise<boolean> {
  const { hash } = await readAdminPassword()
  if (!hash) {
    return false
  }
  return username === getAdminUsername() && (await verifyPassword(password, hash))
}

// Fingerprint of the configured credential material. Sessions bind to it so
// rotating ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_PASSWORD_HASH invalidates
// previously issued cookies. Hashed in memory; never logged.
export function credentialFingerprint(): string {
  const material = [
    (process.env.ADMIN_USERNAME || '').trim(),
    (process.env.ADMIN_PASSWORD_HASH || '').trim(),
    (process.env.ADMIN_PASSWORD || '').trim(),
  ].join('|')
  return createHash('sha256').update(material, 'utf8').digest('base64url').slice(0, 22)
}

export function createSessionToken(ttlMs = ADMIN_SESSION_TTL_MS): string {
  const payload = JSON.stringify({ exp: Date.now() + ttlMs, cred: credentialFingerprint() })
  const body = Buffer.from(payload, 'utf8').toString('base64url')
  const signature = createHmac('sha256', sessionSecret()).update(body).digest('base64url')
  return `${body}.${signature}`
}

export function verifySessionToken(token: string | null | undefined): boolean {
  if (!token) {
    return false
  }
  const parts = token.split('.')
  if (parts.length !== 2) {
    return false
  }
  const [body, signature] = parts
  if (!body || !signature) {
    return false
  }
  const expected = createHmac('sha256', sessionSecret()).update(body).digest('base64url')
  if (signature.length !== expected.length) {
    return false
  }
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return false
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { exp?: unknown; cred?: unknown }
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) {
      return false
    }
    return payload.cred === credentialFingerprint()
  } catch {
    return false
  }
}

export function isAdminSession(event: Pick<RequestEvent, 'cookies'>): boolean {
  return verifySessionToken(event.cookies.get(ADMIN_SESSION_COOKIE))
}

interface LoginBucket {
  count: number
  resetAt: number
}

const loginBuckets = new Map<string, LoginBucket>()

export function isLoginRateLimited(ip: string): boolean {
  const now = Date.now()
  for (const [key, bucket] of loginBuckets) {
    if (now >= bucket.resetAt) loginBuckets.delete(key)
  }
  const bucket = loginBuckets.get(ip)
  return !!bucket && now < bucket.resetAt && bucket.count >= LOGIN_MAX_ATTEMPTS
}

export function recordLoginAttempt(ip: string): void {
  const now = Date.now()
  const bucket = loginBuckets.get(ip)
  if (!bucket || now >= bucket.resetAt) {
    loginBuckets.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS })
    return
  }
  bucket.count += 1
}

export function resetLoginAttempts(ip: string): void {
  loginBuckets.delete(ip)
}
