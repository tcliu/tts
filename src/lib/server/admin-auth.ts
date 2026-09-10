import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { RequestEvent } from '@sveltejs/kit'
import { getDb } from './db'
import { isProdRuntime } from './profile'

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
      if (error) reject(error)
      else resolve(derivedKey)
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
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const salt = Buffer.from(parts[1], 'base64')
  const expected = Buffer.from(parts[2], 'base64')
  if (salt.length !== 16 || expected.length !== 32) return false
  const actual = await scryptAsync(password, salt, expected.length)
  return timingSafeEqual(actual, expected)
}

function sessionSecret(): string {
  const explicit = (process.env.SESSION_SECRET || '').trim()
  if (explicit) return explicit
  if (isProdRuntime()) throw new Error('SESSION_SECRET must be set in production')
  return 'dev-session-secret'
}

export function getAdminUsername(): string {
  return (process.env.ADMIN_USERNAME || '').trim() || 'admin'
}

let plainPasswordHash: Promise<string> | null = null

async function readAdminPassword(): Promise<{ hash: string | null; configured: boolean }> {
  const hash = (process.env.ADMIN_PASSWORD_HASH || '').trim()
  if (hash) return { hash, configured: true }
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
  if (!hash) return false
  return username === getAdminUsername() && (await verifyPassword(password, hash))
}

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
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [body, signature] = parts
  if (!body || !signature) return false
  const expected = createHmac('sha256', sessionSecret()).update(body).digest('base64url')
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { exp?: unknown; cred?: unknown }
    return typeof payload.exp === 'number' && payload.exp > Date.now() && payload.cred === credentialFingerprint()
  } catch {
    return false
  }
}

export function isAdminSession(event: Pick<RequestEvent, 'cookies'>): boolean {
  return verifySessionToken(event.cookies.get(ADMIN_SESSION_COOKIE))
}

export async function isLoginRateLimited(ip: string): Promise<boolean> {
  const result = await (await getDb()).query<{ count: number; reset_at: number }>(
    'select count, reset_at from login_attempts where ip = $1',
    [ip],
  )
  const bucket = result.rows[0]
  return !!bucket && Date.now() < Number(bucket.reset_at) && Number(bucket.count) >= LOGIN_MAX_ATTEMPTS
}

export async function recordLoginAttempt(ip: string): Promise<void> {
  const now = Date.now()
  const db = await getDb()
  await db.transaction(async query => {
    const current = await query<{ count: number; reset_at: number }>(
      'select count, reset_at from login_attempts where ip = $1',
      [ip],
    )
    const row = current.rows[0]
    if (!row || now >= Number(row.reset_at)) {
      if (!row) {
        await query('insert into login_attempts (ip, count, reset_at) values ($1, 1, $2)', [ip, now + LOGIN_WINDOW_MS])
      } else {
        await query('update login_attempts set count = 1, reset_at = $2 where ip = $1', [ip, now + LOGIN_WINDOW_MS])
      }
      return
    }
    await query('update login_attempts set count = count + 1 where ip = $1', [ip])
  })
}

export async function resetLoginAttempts(ip: string): Promise<void> {
  await (await getDb()).query('delete from login_attempts where ip = $1', [ip])
}
