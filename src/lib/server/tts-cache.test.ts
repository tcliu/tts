import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getCachedSynthesis,
  setCachedSynthesis,
  synthesisCacheKey,
  synthesisEtag,
  matchesIfNoneMatch,
} from './tts-cache'

let cacheRoot: string
let logged: string[]

beforeEach(async () => {
  cacheRoot = await mkdtemp(path.join(tmpdir(), 'tts-cache-'))
  process.env.TTS_CACHE_DIR = cacheRoot
  logged = []
  vi.spyOn(console, 'log').mockImplementation(line => {
    logged.push(String(line))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
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
    const result = await getCachedSynthesis(key)
    expect(result?.value).toEqual(value)
    expect(result?.etag).toBe(synthesisEtag(value))
  })

  it('uses the same server cache key across playback rates', () => {
    expect(synthesisCacheKey('Hello', 'en-US-AriaNeural', 1)).toBe(
      synthesisCacheKey('Hello', 'en-US-AriaNeural', 3),
    )
  })

  it('returns the computed etag from setCachedSynthesis so callers avoid rehashing', async () => {
    const key = synthesisCacheKey('Hello', 'en-US-AriaNeural', 1)
    const value = { audio: 'QUJD', boundaries: [{ offset: 0, at: 0.1 }] }
    await expect(setCachedSynthesis(key, value)).resolves.toBe(synthesisEtag(value))
  })

  it('derives stable etags for identical content and distinct ones for changed content', () => {
    const value = { audio: 'QUJD', boundaries: [{ offset: 0, at: 0.1 }] }
    expect(synthesisEtag(value)).toBe(synthesisEtag({ ...value }))
    // Optional fields normalize to their defaults on both sides.
    expect(synthesisEtag(value)).toBe(
      synthesisEtag({ ...value, wordBoundaries: [], spokenStart: undefined, spokenEnd: undefined }),
    )
    expect(synthesisEtag(value)).not.toBe(synthesisEtag({ ...value, audio: 'RFlY' }))
    expect(synthesisEtag(value)).not.toBe(synthesisEtag({ ...value, boundaries: [{ offset: 0, at: 0.2 }] }))
  })

  it('serves legacy envelopes written before etags existed with a derived etag', async () => {
    const value = { audio: 'QUJD', boundaries: [{ offset: 0, at: 0.1 }] }
    await writeFile(path.join(cacheRoot, 'legacy.json'), JSON.stringify({ savedAt: Date.now(), value }), 'utf-8')
    const result = await getCachedSynthesis('legacy')
    expect(result?.value).toEqual(value)
    expect(result?.etag).toBe(synthesisEtag(value))
    expect(logged).toEqual([])
  })

  it('matches If-None-Match values tolerantly per RFC 7232', () => {
    const etag = 'abc123'
    expect(matchesIfNoneMatch(etag, etag)).toBe(true)
    expect(matchesIfNoneMatch(`"${etag}"`, etag)).toBe(true)
    expect(matchesIfNoneMatch(`W/"${etag}"`, etag)).toBe(true)
    expect(matchesIfNoneMatch(`"other", ${etag}`, etag)).toBe(true)
    expect(matchesIfNoneMatch('*', etag)).toBe(true)
    expect(matchesIfNoneMatch('*', 'anything')).toBe(true)
    expect(matchesIfNoneMatch('"other"', etag)).toBe(false)
    expect(matchesIfNoneMatch('', etag)).toBe(false)
  })

  it('returns null for unknown keys and malformed files, logging only the malformed read', async () => {
    expect(await getCachedSynthesis(synthesisCacheKey('Missing', 'v', 1))).toBeNull()
    expect(logged).toEqual([])
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(cacheRoot, { recursive: true })
    await writeFile(path.join(cacheRoot, 'broken.json'), 'not json', 'utf-8')
    expect(await getCachedSynthesis('broken')).toBeNull()
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatch(/WARN ip=unknown action=tts_cache_read_error key="broken" error=/)
  })
})
