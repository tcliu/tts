import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { synthesisCacheKey } from './tts-cache-key'
import type { SynthesizedSegment } from './tts-client'

const idb = vi.hoisted(() => ({
  getPersistedSegment: vi.fn<() => Promise<unknown>>(async () => null),
  loadPersistedRecords: vi.fn(async () => [] as Array<Record<string, unknown>>),
  putPersistedSegment: vi.fn(async (_key: string, _segment: unknown) => {}),
  getPersistedCacheStats: vi.fn(async () => ({ segments: 0, bytes: 0 })),
  clearPersistedSegments: vi.fn(async () => {}),
  deletePersistedSegmentsByDocId: vi.fn(async (_docId: string) => {}),
  // Mirror the real storage-shape whitelist so leaked storage fields cannot
  // silently satisfy assertions here.
  toSynthesizedSegment: vi.fn((record: Record<string, unknown>) => ({
    blob: record.blob,
    boundaries: record.boundaries,
    wordBoundaries: record.wordBoundaries,
    spokenStart: record.spokenStart,
    spokenEnd: record.spokenEnd,
    etag: record.etag,
  })),
}))

vi.mock('./tts-client-idb', () => idb)

const TEXT = 'Hello'
const VOICE = 'en-US-AriaNeural'
const RATE = 1

function serverPayload(overrides?: Partial<{ audio: string }>) {
  return {
    audio: overrides?.audio ?? 'QUJD',
    boundaries: [{ offset: 0, at: 0 }],
    wordBoundaries: [],
  }
}

function okResponse(payload: unknown, etag?: string) {
  return {
    status: 200,
    ok: true,
    headers: { get: (name: string) => (name.toLowerCase() === 'etag' && etag ? etag : null) },
    json: async () => payload,
  } as unknown as Response
}

function notModifiedResponse() {
  return { status: 304, ok: false } as unknown as Response
}

function persistedLocal(etag?: string): SynthesizedSegment {
  return {
    blob: new Blob(['local']),
    boundaries: [],
    wordBoundaries: [],
    ...(etag === undefined ? {} : { etag }),
  }
}

async function loadFresh(): Promise<typeof import('./tts-client')> {
  // Fresh import per test so the memory LRU and hydration flags reset.
  return await import('./tts-client')
}

describe('tts-client', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    // Hoisted fns outlive module resets; give every test clean defaults.
    idb.getPersistedSegment.mockReset().mockImplementation(async () => null)
    idb.loadPersistedRecords.mockReset().mockResolvedValue([])
    idb.putPersistedSegment.mockReset().mockResolvedValue(undefined)
    idb.getPersistedCacheStats.mockReset().mockResolvedValue({ segments: 0, bytes: 0 })
    idb.clearPersistedSegments.mockReset().mockResolvedValue(undefined)
    idb.deletePersistedSegmentsByDocId.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('synthesizes a fresh segment, persisting it and exposing the server ETag', async () => {
    fetchMock.mockResolvedValue(okResponse(serverPayload(), 'etag-1'))
    const client = await loadFresh()

    const result = await client.getCachedSynthesis(TEXT, VOICE, RATE, undefined, 'doc-a')
    expect(result.etag).toBe('etag-1')
    expect(result.blob).toBeInstanceOf(Blob)
    expect(idb.putPersistedSegment).toHaveBeenCalledOnce()
    expect(idb.putPersistedSegment).toHaveBeenCalledWith(synthesisCacheKey(TEXT, VOICE, RATE), result, 'doc-a')
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('reuses the local blob on a matching 304 without re-persisting it', async () => {
    const local = persistedLocal('"local-etag"')
    idb.getPersistedSegment.mockResolvedValue(local)
    fetchMock.mockResolvedValue(notModifiedResponse())
    const client = await loadFresh()

    const result = await client.getCachedSynthesis(TEXT, VOICE, RATE, undefined, 'doc-a')
    expect(result).toBe(local)
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      'If-None-Match': '"local-etag"',
      'Content-Type': 'application/json',
    })
    expect(idb.putPersistedSegment).not.toHaveBeenCalled()
    expect(client.peekCachedSynthesis(TEXT, VOICE, RATE)).toBe(local)
  })

  it('replaces a stale local copy with fresh audio and re-persists it', async () => {
    idb.getPersistedSegment.mockResolvedValue(persistedLocal('"stale"'))
    const payload = serverPayload({ audio: 'RFlY' })
    fetchMock.mockResolvedValue(okResponse(payload, 'fresh'))
    const client = await loadFresh()

    const result = await client.getCachedSynthesis(TEXT, VOICE, RATE, undefined, 'doc-a')
    expect(result.blob.text()).resolves.toBe('DYX')
    expect(result.etag).toBe('fresh')
    expect(idb.putPersistedSegment).toHaveBeenCalledOnce()
  })

  it('throws on an unsolicited 304 instead of returning empty audio', async () => {
    idb.getPersistedSegment.mockResolvedValue(null)
    fetchMock.mockResolvedValue(notModifiedResponse())
    const client = await loadFresh()

    await expect(client.getCachedSynthesis(TEXT, VOICE, RATE)).rejects.toThrow(
      'Synthesis cache returned 304 without a client ETag',
    )
  })

  it('ignores blob-less hydrated entries for peeking but recovers them over the network', async () => {
    const key = synthesisCacheKey(TEXT, VOICE, RATE)
    idb.loadPersistedRecords.mockResolvedValue([
      { key, savedAt: 1, blob: undefined, boundaries: [], wordBoundaries: [] },
    ])
    idb.getPersistedSegment.mockResolvedValue(null)
    fetchMock.mockResolvedValue(okResponse(serverPayload(), 'recovers'))
    const client = await loadFresh()

    await client.hydrateSynthesisCache()
    expect(client.isSynthesisCacheHydrated()).toBe(true)
    expect(client.peekCachedSynthesis(TEXT, VOICE, RATE)).toBeNull()

    const result = await client.getCachedSynthesis(TEXT, VOICE, RATE)
    expect(result.etag).toBe('recovers')
  })

  it('reports persisted cache stats through to callers', async () => {
    idb.getPersistedCacheStats.mockResolvedValue({ segments: 3, bytes: 120 })
    const client = await loadFresh()

    await expect(client.getSynthesisCacheStats()).resolves.toEqual({ segments: 3, bytes: 120 })
  })

  it('clearing the whole cache drops resident entries and persisted records', async () => {
    fetchMock.mockResolvedValue(okResponse(serverPayload()))
    const client = await loadFresh()
    await client.getCachedSynthesis(TEXT, VOICE, RATE, undefined, 'doc-a')
    expect(client.peekCachedSynthesis(TEXT, VOICE, RATE)).not.toBeNull()

    await client.clearSynthesisCache()

    expect(client.peekCachedSynthesis(TEXT, VOICE, RATE)).toBeNull()
    expect(idb.clearPersistedSegments).toHaveBeenCalledOnce()
  })

  it('clearing one document scope evicts only its current keys', async () => {
    const textB = 'Second passage'
    fetchMock.mockResolvedValue(okResponse(serverPayload()))
    const client = await loadFresh()
    await client.getCachedSynthesis(TEXT, VOICE, RATE, undefined, 'doc-a')
    await client.getCachedSynthesis(textB, VOICE, RATE, undefined, 'doc-b')
    expect(client.peekCachedSynthesis(TEXT, VOICE, RATE)).not.toBeNull()
    expect(client.peekCachedSynthesis(textB, VOICE, RATE)).not.toBeNull()

    await client.clearDocumentSynthesisCache('doc-a', [synthesisCacheKey(TEXT, VOICE, RATE)])

    expect(client.peekCachedSynthesis(TEXT, VOICE, RATE)).toBeNull()
    expect(client.peekCachedSynthesis(textB, VOICE, RATE)).not.toBeNull()
    expect(idb.deletePersistedSegmentsByDocId).toHaveBeenCalledWith('doc-a')
  })
})
