import type { SynthesizedSegment } from './tts-client'

// Type-only cycle is intentional: tts-client owns the domain type while this
// module owns its storage shape; erased types keep the runtime dependency
// one-directional (tts-client -> tts-client-idb).

export interface PersistedSynthesisRecord extends SynthesizedSegment {
  key: string
  savedAt: number
  docId?: string
}

const DB_NAME = 'tts-synthesis'
const STORE = 'segments'
const DOC_ID_INDEX = 'docId'
const DB_VERSION = 2
const PERSISTED_MAX = 200

let dbPromise: Promise<IDBDatabase | null> | null = null

async function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return null
  if (!dbPromise) {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    dbPromise = new Promise((resolve, reject) => {
      req.onupgradeneeded = () => {
        const store = req.result.objectStoreNames.contains(STORE)
          ? req.transaction?.objectStore(STORE)
          : req.result.createObjectStore(STORE, { keyPath: 'key' })
        if (store && !store.indexNames.contains(DOC_ID_INDEX)) {
          store.createIndex(DOC_ID_INDEX, DOC_ID_INDEX, { unique: false })
        }
      }
      // An upgrade blocked by another tab would otherwise leave every caller
      // awaiting forever; fail instead of hanging.
      req.onblocked = () => reject(new Error('IndexedDB open blocked'))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  try {
    return await dbPromise
  } catch {
    // Do not cache the rejection: a transient failure should not disable
    // persistence for the whole session.
    dbPromise = null
    return null
  }
}

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function countRecords(conn: IDBDatabase): Promise<number> {
  const request = conn.transaction(STORE, 'readonly').objectStore(STORE).count()
  return requestDone(request)
}

async function getAllRecords(conn: IDBDatabase): Promise<PersistedSynthesisRecord[]> {
  const request = conn.transaction(STORE, 'readonly').objectStore(STORE).getAll()
  return (await requestDone(request)) as PersistedSynthesisRecord[]
}

function toPersistedRecord(key: string, segment: SynthesizedSegment, docId?: string): PersistedSynthesisRecord {
  return { key, savedAt: Date.now(), docId, ...segment }
}

export function toSynthesizedSegment(record: PersistedSynthesisRecord): SynthesizedSegment {
  // Explicit field list so storage fields cannot leak into in-memory segments.
  return {
    blob: record.blob,
    boundaries: record.boundaries,
    wordBoundaries: record.wordBoundaries,
    spokenStart: record.spokenStart,
    spokenEnd: record.spokenEnd,
    etag: record.etag,
  }
}

export async function getPersistedSegment(key: string): Promise<SynthesizedSegment | null> {
  const conn = await openDb()
  if (!conn) return null
  try {
    const record = await requestDone(
      conn.transaction(STORE, 'readonly').objectStore(STORE).get(key),
    )
    if (!record) return null
    return toSynthesizedSegment(record as PersistedSynthesisRecord)
  } catch {
    // Reads are best-effort; a miss falls through to fresh synthesis.
    return null
  }
}

export async function loadPersistedRecords(): Promise<PersistedSynthesisRecord[]> {
  const conn = await openDb()
  if (!conn) return []
  try {
    return await getAllRecords(conn)
  } catch {
    return []
  }
}

export interface PersistedCacheStats {
  segments: number
  bytes: number
  /** @deprecated — use segments; kept for backward compatibility */
  documents: number
}

export async function getPersistedCacheStats(): Promise<PersistedCacheStats> {
  const conn = await openDb()
  if (!conn) return { segments: 0, bytes: 0, documents: 0 }
  try {
    const records = await getAllRecords(conn)
    const segments = records.length
    const documents = new Set(
      records.map(record => record.docId).filter((docId): docId is string => typeof docId === 'string' && docId.length > 0),
    ).size
    return {
      segments,
      documents,
      bytes: records.reduce((total, record) => total + (record.blob?.size ?? 0), 0),
    }
  } catch {
    return { segments: 0, bytes: 0, documents: 0 }
  }
}

export async function clearPersistedSegments(): Promise<void> {
  const conn = await openDb()
  if (!conn) return
  try {
    const tx = conn.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    await transactionDone(tx)
  } catch {
    // Clearing is best-effort.
  }
}

export async function deletePersistedSegmentsByDocId(docId: string): Promise<void> {
  const conn = await openDb()
  if (!conn || !docId) return
  try {
    const records = await getAllRecords(conn)
    const keys = records.filter(record => record.docId === docId).map(record => record.key)
    if (keys.length === 0) return
    const tx = conn.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const key of keys) {
      store.delete(key)
    }
    await transactionDone(tx)
  } catch {
    // Deletion is best-effort.
  }
}

export async function putPersistedSegment(key: string, segment: SynthesizedSegment, docId?: string): Promise<void> {
  const conn = await openDb()
  if (!conn) return
  try {
    const tx = conn.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(toPersistedRecord(key, segment, docId))
    await transactionDone(tx)
    await evictOverCap(conn)
  } catch {
    // Persistence is best-effort; serve fresh results if it fails.
  }
}

async function evictOverCap(conn: IDBDatabase): Promise<void> {
  try {
    // This runs after every persist; check the cheap count first instead of
    // materializing every stored record (Blob-backed) each time.
    if ((await countRecords(conn)) <= PERSISTED_MAX) return
    const all = await getAllRecords(conn)
    all.sort((a, b) => a.savedAt - b.savedAt)
    const stale = all.slice(0, all.length - PERSISTED_MAX)
    const tx = conn.transaction(STORE, 'readwrite')
    for (const record of stale) {
      tx.objectStore(STORE).delete(record.key)
    }
    await transactionDone(tx)
  } catch {
    // Eviction is best-effort.
  }
}
