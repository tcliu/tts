import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SynthesizedSegment } from './tts-client'

// Values mirror the module under test; the store is recreated/cleared through
// this file's own connection so tests never depend on its private constants.
const DB_NAME = 'tts-synthesis'
const DB_VERSION = 2
const STORE = 'segments'
const DOC_ID_INDEX = 'docId'

afterEach(() => {
  vi.unstubAllGlobals()
})

// fake-indexeddb cannot structurally clone Blob values in this environment
// (they read back as {}), so use a plain-string stand-in: these tests cover
// keying, whitelist shaping, and eviction, not Blob serialization.
function segment(overrides?: Partial<SynthesizedSegment>): SynthesizedSegment {
  return {
    blob: 'audio-bytes' as unknown as Blob,
    boundaries: [{ offset: 0, at: 0 }],
    wordBoundaries: [],
    ...overrides,
  }
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const store = req.result.objectStoreNames.contains(STORE)
        ? req.transaction?.objectStore(STORE)
        : req.result.createObjectStore(STORE, { keyPath: 'key' })
      if (store && !store.indexNames.contains(DOC_ID_INDEX)) {
        store.createIndex(DOC_ID_INDEX, DOC_ID_INDEX, { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = run(tx.objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

async function storedKeys(): Promise<string[]> {
  const all = await withStore('readonly', store => store.getAll() as IDBRequest<Array<{ key: string }>>)
  return all.map(record => record.key)
}

async function loadModule(): Promise<typeof import('./tts-client-idb')> {
  // Fresh import per test so the module-level connection cache resets.
  return await import('./tts-client-idb')
}

describe('tts-client-idb', () => {
  beforeEach(async () => {
    vi.resetModules()
    await withStore('readwrite', store => store.clear())
  })

  it('round-trips a segment and strips storage-only fields', async () => {
    const mod = await loadModule()
    const dirty = { junk: 'leak', ...segment() } as SynthesizedSegment & { junk?: string }
    await mod.putPersistedSegment('k1', dirty, { docId: 'doc-a', text: 'Hello', voiceId: 'en-US-AriaNeural', rate: 1.25 })

    const restored = await mod.getPersistedSegment('k1')
    expect(restored).not.toBeNull()
    expect(restored?.blob).toBe('audio-bytes')
    expect(restored).toEqual(segment())
    expect(restored).not.toHaveProperty('key')
    expect(restored).not.toHaveProperty('savedAt')
    expect(restored).not.toHaveProperty('junk')
  })

  it('keeps every record while under cap', async () => {
    const mod = await loadModule()
    for (let i = 0; i < 5; i += 1) {
      await mod.putPersistedSegment(`seg-${i}`, segment(), { docId: 'doc-a' })
    }

    const keys = await storedKeys()
    expect(keys).toHaveLength(5)
    for (let i = 0; i < 5; i += 1) {
      expect(keys).toContain(`seg-${i}`)
    }
  })

  it('evicts oldest-saved records first once over cap', async () => {
    let now = 10_000
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => (now += 1))
    try {
      const mod = await loadModule()
      for (let i = 0; i < 201; i += 1) {
        await mod.putPersistedSegment(`seg-${String(i).padStart(3, '0')}`, segment(), { docId: 'doc-a' })
      }

      const keys = await storedKeys()
      expect(keys).toHaveLength(200)
      expect(keys).not.toContain('seg-000')
      expect(keys).toContain('seg-001')
      expect(keys).toContain('seg-200')
    } finally {
      dateSpy.mockRestore()
    }
  })

  it('is a silent no-op when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const mod = await loadModule()

    await expect(mod.putPersistedSegment('k2', segment(), { docId: 'doc-a' })).resolves.toBeUndefined()
    await expect(mod.getPersistedSegment('k2')).resolves.toBeNull()
    await expect(mod.loadPersistedRecords()).resolves.toEqual([])
  })

  it('reports record count and total audio size', async () => {
    const mod = await loadModule()
    await mod.putPersistedSegment('k1', segment({ blob: { size: 100 } as unknown as Blob }), { docId: 'doc-a' })
    await mod.putPersistedSegment('k2', segment({ blob: { size: 250 } as unknown as Blob }), { docId: 'doc-a' })

    await expect(mod.getPersistedCacheStats()).resolves.toEqual({ segments: 2, documents: 1, bytes: 350 })
  })

  it('clears every persisted segment', async () => {
    const mod = await loadModule()
    await mod.putPersistedSegment('k1', segment({ blob: { size: 100 } as unknown as Blob }), { docId: 'doc-a' })
    await mod.putPersistedSegment('k2', segment(), { docId: 'doc-b' })

    await mod.clearPersistedSegments()
    await expect(mod.getPersistedCacheStats()).resolves.toEqual({ segments: 0, documents: 0, bytes: 0 })
    await expect(mod.getPersistedSegment('k1')).resolves.toBeNull()
    await expect(mod.getPersistedSegment('k2')).resolves.toBeNull()
  })

  it('deletes only the requested document scope', async () => {
    const mod = await loadModule()
    await mod.putPersistedSegment('k1', segment(), { docId: 'doc-a' })
    await mod.putPersistedSegment('k2', segment(), { docId: 'doc-b' })

    await mod.deletePersistedSegmentsByDocId('')
    await expect(mod.getPersistedSegment('k1')).resolves.not.toBeNull()

    await mod.deletePersistedSegmentsByDocId('doc-a')
    await expect(mod.getPersistedSegment('k1')).resolves.toBeNull()
    await expect(mod.getPersistedSegment('k2')).resolves.not.toBeNull()
  })

  it('lists stored metadata and deletes only requested keys', async () => {
    const mod = await loadModule()
    await mod.putPersistedSegment('k1', segment({ blob: { size: 100 } as unknown as Blob }), {
      docId: 'doc-a',
      text: 'First line',
      voiceId: 'en-US-AriaNeural',
      rate: 1,
    })
    await mod.putPersistedSegment('k2', segment({ blob: { size: 200 } as unknown as Blob }), {
      docId: 'doc-b',
      text: 'Second line',
      voiceId: 'zh-CN-XiaoxiaoNeural',
      rate: 1.5,
    })

    await expect(mod.loadPersistedRecords()).resolves.toEqual([
      expect.objectContaining({
        key: 'k1',
        docId: 'doc-a',
        text: 'First line',
        voiceId: 'en-US-AriaNeural',
        rate: 1,
      }),
      expect.objectContaining({
        key: 'k2',
        docId: 'doc-b',
        text: 'Second line',
        voiceId: 'zh-CN-XiaoxiaoNeural',
        rate: 1.5,
      }),
    ])

    await mod.deletePersistedSegments(['k2'])
    await expect(mod.getPersistedSegment('k1')).resolves.not.toBeNull()
    await expect(mod.getPersistedSegment('k2')).resolves.toBeNull()
  })
})
