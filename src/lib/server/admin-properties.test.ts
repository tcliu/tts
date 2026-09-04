import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertKnownPropertyKey,
  deletePropertyValue,
  getCacheMaxBytes,
  getCacheMaxEntries,
  getCacheTtlMs,
  getEdgeTtsTimeoutMs,
  getMaxTextLength,
  getRateLimitMax,
  listProperties,
  resetPropertiesCache,
  setPropertyValues,
  validatePropertyValue,
} from './admin-properties'

let propertiesFile = ''
let savedEnv: Record<string, string | undefined>

const ENV_KEYS = [
  'TTS_PROPERTIES_FILE',
  'TTS_RATE_LIMIT_MAX',
  'TTS_MAX_TEXT_LENGTH',
  'TTS_CACHE_TTL_MS',
  'TTS_CACHE_MAX_ENTRIES',
  'TTS_CACHE_MAX_BYTES',
  'EDGE_TTS_TIMEOUT_MS',
]

beforeEach(async () => {
  savedEnv = {}
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  propertiesFile = path.join(await mkdtemp(path.join(tmpdir(), 'admin-props-')), 'properties.json')
  process.env.TTS_PROPERTIES_FILE = propertiesFile
  resetPropertiesCache()
})

afterEach(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  resetPropertiesCache()
  await rm(path.dirname(propertiesFile), { recursive: true, force: true })
})

describe('admin-properties', () => {
  it('lists compiled defaults when nothing is set', () => {
    const properties = listProperties()
    expect(properties).toHaveLength(6)
    expect(properties.find(p => p.key === 'tts_rate_limit_max')).toMatchObject({ value: 60, source: 'default' })
    expect(getRateLimitMax()).toBe(60)
    expect(getMaxTextLength()).toBe(2000)
    expect(getCacheTtlMs()).toBe(7 * 24 * 60 * 60 * 1000)
    expect(getCacheMaxEntries()).toBe(500)
    expect(getCacheMaxBytes()).toBe(200 * 1024 * 1024)
    expect(getEdgeTtsTimeoutMs()).toBe(30_000)
  })

  it('prefers environment over defaults and file over environment', async () => {
    process.env.TTS_RATE_LIMIT_MAX = '120'
    expect(getRateLimitMax()).toBe(120)
    expect(listProperties().find(p => p.key === 'tts_rate_limit_max')).toMatchObject({ value: 120, source: 'environment' })

    await setPropertyValues([{ key: 'tts_rate_limit_max', value: 30 }])
    expect(getRateLimitMax()).toBe(30)
    expect(listProperties().find(p => p.key === 'tts_rate_limit_max')).toMatchObject({ value: 30, source: 'file' })
  })

  it('validates ranges and rejects unknown keys', () => {
    expect(validatePropertyValue('tts_rate_limit_max', 10)).toBe(10)
    expect(validatePropertyValue('tts_rate_limit_max', '42')).toBe(42)
    expect(() => validatePropertyValue('tts_rate_limit_max', 0)).toThrow()
    expect(() => validatePropertyValue('tts_rate_limit_max', 1.5)).toThrow()
    expect(() => validatePropertyValue('nope', 1)).toThrow()
    expect(() => assertKnownPropertyKey('nope')).toThrow()
  })

  it('ignores out-of-range file and environment values on read', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(propertiesFile, JSON.stringify({ tts_rate_limit_max: 0 }), 'utf-8')
    resetPropertiesCache()
    process.env.TTS_RATE_LIMIT_MAX = '-5'
    expect(getRateLimitMax()).toBe(60)
    expect(listProperties().find(p => p.key === 'tts_rate_limit_max')).toMatchObject({ value: 60, source: 'default' })
  })

  it('deletes a file value to reveal the environment value', async () => {
    process.env.TTS_RATE_LIMIT_MAX = '120'
    await setPropertyValues([{ key: 'tts_rate_limit_max', value: 30 }])
    expect(getRateLimitMax()).toBe(30)
    await deletePropertyValue('tts_rate_limit_max')
    expect(getRateLimitMax()).toBe(120)
    expect(listProperties().find(p => p.key === 'tts_rate_limit_max')).toMatchObject({ value: 120, source: 'environment' })
  })

  it('falls back to defaults when the file holds corrupt JSON', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(propertiesFile, 'not json {{{', 'utf-8')
    resetPropertiesCache()
    expect(getRateLimitMax()).toBe(60)
    expect(listProperties().find(p => p.key === 'tts_rate_limit_max')).toMatchObject({ value: 60, source: 'default' })
  })
})
