import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSessionToken,
  hashPassword,
  isAdminConfigured,
  isLoginRateLimited,
  recordLoginAttempt,
  resetLoginAttempts,
  verifyAdminCredentials,
  verifyPassword,
  verifySessionToken,
} from './admin-auth'

let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = {
    ADMIN_USERNAME: process.env.ADMIN_USERNAME,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
    SESSION_SECRET: process.env.SESSION_SECRET,
  }
  delete process.env.ADMIN_PASSWORD
  delete process.env.ADMIN_PASSWORD_HASH
  process.env.SESSION_SECRET = 'test-secret'
  resetLoginAttempts('127.0.0.1')
  resetLoginAttempts('10.0.0.1')
})

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  vi.restoreAllMocks()
})

describe('admin-auth passwords', () => {
  it('round-trips a scrypt hash', async () => {
    const hash = await hashPassword('correct horse')
    expect(await verifyPassword('correct horse', hash)).toBe(true)
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })

  it('rejects malformed hashes', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false)
    expect(await verifyPassword('x', 'scrypt$bad$bad')).toBe(false)
  })

  it('verifies credentials from a plain password or hash', async () => {
    process.env.ADMIN_USERNAME = 'boss'
    process.env.ADMIN_PASSWORD = 's3cret'
    expect(await isAdminConfigured()).toBe(true)
    expect(await verifyAdminCredentials('boss', 's3cret')).toBe(true)
    expect(await verifyAdminCredentials('boss', 'nope')).toBe(false)
    expect(await verifyAdminCredentials('other', 's3cret')).toBe(false)

    process.env.ADMIN_PASSWORD_HASH = await hashPassword('hashed-secret')
    delete process.env.ADMIN_PASSWORD
    expect(await verifyAdminCredentials('boss', 'hashed-secret')).toBe(true)
    expect(await verifyAdminCredentials('boss', 's3cret')).toBe(false)
  })

  it('reports unconfigured when no password is set', async () => {
    expect(await isAdminConfigured()).toBe(false)
    expect(await verifyAdminCredentials('admin', 'anything')).toBe(false)
  })
})

describe('admin-auth sessions', () => {
  it('accepts fresh tokens and rejects expired or tampered ones', async () => {
    const token = createSessionToken()
    expect(verifySessionToken(token)).toBe(true)
    expect(verifySessionToken(`${token}tampered`)).toBe(false)
    expect(verifySessionToken('no-dot')).toBe(false)
    expect(verifySessionToken(null)).toBe(false)
    expect(verifySessionToken(createSessionToken(-1000))).toBe(false)
  })

  it('invalidates tokens when credentials rotate', async () => {
    process.env.ADMIN_USERNAME = 'boss'
    process.env.ADMIN_PASSWORD = 's3cret'
    const token = createSessionToken()
    expect(verifySessionToken(token)).toBe(true)
    process.env.ADMIN_PASSWORD = 'n3w-secret'
    expect(verifySessionToken(token)).toBe(false)
  })
})

describe('admin-auth login rate limit', () => {
  it('limits after 5 attempts within the window', () => {
    const ip = '10.0.0.1'
    expect(isLoginRateLimited(ip)).toBe(false)
    for (let i = 0; i < 5; i += 1) {
      recordLoginAttempt(ip)
    }
    expect(isLoginRateLimited(ip)).toBe(true)
    resetLoginAttempts(ip)
    expect(isLoginRateLimited(ip)).toBe(false)
  })
})
