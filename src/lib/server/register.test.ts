import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { POST } from '../../routes/api/auth/register/+server'
import { getPasswordMinLength, resetPropertiesCache, setPropertyValues } from './admin-properties'
import { closeDb } from './db'
import { createUser } from './users'

let dir = ''
let savedEnv: Record<string, string | undefined>

const ENV_KEYS = ['SQLITE_PATH', 'TTS_PROPERTIES_FILE', 'AUTH_PASSWORD_MIN_LENGTH', 'ADMIN_USERNAME']

function postJson(payload: unknown) {
  return POST({
    request: new Request('https://example.test/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    getClientAddress: () => '127.0.0.1',
    cookies: { get: () => undefined, set: () => {} },
  } as unknown as Parameters<typeof POST>[0])
}

beforeEach(async () => {
  savedEnv = {}
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  dir = await mkdtemp(path.join(tmpdir(), 'register-'))
  process.env.SQLITE_PATH = path.join(dir, 'test.sqlite')
  process.env.TTS_PROPERTIES_FILE = path.join(dir, 'properties.json')
  resetPropertiesCache()
})

afterEach(async () => {
  await closeDb()
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  resetPropertiesCache()
  await rm(dir, { recursive: true, force: true })
})

describe('password minimum', () => {
  it('rejects below the default minimum and accepts at it', async () => {
    expect(getPasswordMinLength()).toBe(8)
    await expect(createUser({ username: 'shorty', email: 'shorty@example.com', password: '7-chars' })).rejects.toThrow(
      'password_too_short',
    )
    const user = await createUser({ username: 'eightok', email: 'eightok@example.com', password: '8-chars!' })
    expect(user.username).toBe('eightok')
  })

  it('honors the configured minimum', async () => {
    await setPropertyValues([{ key: 'auth_password_min_length', value: 12 }])
    expect(getPasswordMinLength()).toBe(12)
    await expect(
      createUser({ username: 'eleven', email: 'eleven@example.com', password: '11-charspw' }),
    ).rejects.toThrow('password_too_short')
  })

  it('surfaces password_too_short with the configured min_length', async () => {
    await setPropertyValues([{ key: 'auth_password_min_length', value: 12 }])
    const response = await postJson({ username: 'newbie', email: 'newbie@example.com', password: '11-charspw' })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'password_too_short', min_length: 12 })
  })

  it('masks duplicates as generic registration_failed without min_length', async () => {
    await createUser({ username: 'taken', email: 'taken@example.com', password: 'long-enough-password' })
    const response = await postJson({ username: 'taken', email: 'other@example.com', password: 'long-enough-password' })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'registration_failed' })
  })
})
