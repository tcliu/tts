import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getCachedSynthesis, setCachedSynthesis, synthesisCacheKey } from './tts-cache'

let cacheRoot: string

beforeEach(async () => {
  cacheRoot = await mkdtemp(path.join(tmpdir(), 'tts-cache-'))
  process.env.TTS_CACHE_DIR = cacheRoot
})

afterAll(async () => {
  delete process.env.TTS_CACHE_DIR
  await rm(cacheRoot, { recursive: true, force: true })
})

describe('tts-cache', () => {
  it('round-trips a synthesis payload by key', async () => {
    const key = synthesisCacheKey('Hello', 'en-US-AriaNeural', 1)
    const value = { audio: 'QUJD', boundaries: [{ offset: 0, at: 0.1 }] }
    expect(await getCachedSynthesis(key)).toBeNull()
    await setCachedSynthesis(key, value)
    expect(await getCachedSynthesis(key)).toEqual(value)
  })

  it('returns null for unknown keys and malformed files', async () => {
    expect(await getCachedSynthesis(synthesisCacheKey('Missing', 'v', 1))).toBeNull()
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(cacheRoot, { recursive: true })
    await writeFile(path.join(cacheRoot, 'broken.json'), 'not json', 'utf-8')
    expect(await getCachedSynthesis('broken')).toBeNull()
  })
})
