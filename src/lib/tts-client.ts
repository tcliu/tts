import { synthesisCacheKey } from './tts-cache-key'
import type { TtsBoundary } from './tts-reference'
import {
  clearPersistedSegments,
  deletePersistedSegments,
  deletePersistedSegmentsByDocId,
  getPersistedCacheStats,
  getPersistedSegment,
  loadPersistedRecords,
  putPersistedSegment,
  toSynthesizedSegment,
} from './tts-client-idb'

export interface SynthesizedSegment {
  blob: Blob
  boundaries: TtsBoundary[]
  wordBoundaries?: TtsBoundary[]
  spokenStart?: number
  spokenEnd?: number
  etag?: string
}

const SYNTHESIS_CACHE_MAX = 200
const synthesisCache = new Map<string, SynthesizedSegment>()

// Client-side persistence so a reload can resume playback without re-fetching
// audio from the server. The server `.tts` cache stays the source of truth; on
// load we verify the local copy with an ETag conditional request (304 = reuse).
// Storage lives in `tts-client-idb.ts`; this module owns the memory LRU and
// the network transport.
let hydrationComplete = false
let hydrationPromise: Promise<void> | null = null

export async function hydrateSynthesisCache(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = (async () => {
      try {
        const records = await loadPersistedRecords()
        for (const record of records) {
          // Loaded eagerly so synchronous peek probes see persisted segments;
          // audio Blobs beyond a small inline threshold stay disk-backed in
          // Chromium/Firefox, so resident cost tracks metadata, not bytes.
          if (!synthesisCache.has(record.key)) {
            synthesisCache.set(record.key, toSynthesizedSegment(record))
          }
        }
      } catch {
        // Hydration is best-effort; per-key IndexedDB reads still work.
      } finally {
        hydrationComplete = true
      }
    })()
  }
  return hydrationPromise
}

export function isSynthesisCacheHydrated(): boolean {
  return hydrationComplete
}

export function onSynthesisCacheHydrated(callback: () => void): void {
  if (hydrationComplete) {
    callback()
    return
  }
  void hydrateSynthesisCache().then(() => callback())
}

function cacheSynthesis(
  key: string,
  entry: SynthesizedSegment,
  options?: { persist?: boolean; docId?: string; text?: string; voiceId?: string; rate?: number },
) {
  if (synthesisCache.has(key)) {
    synthesisCache.delete(key)
  }
  synthesisCache.set(key, entry)
  while (synthesisCache.size > SYNTHESIS_CACHE_MAX) {
    const oldest = synthesisCache.keys().next().value
    if (oldest === undefined) break
    synthesisCache.delete(oldest)
  }
  if ((options?.persist ?? true) && entry.blob) {
    void putPersistedSegment(key, entry, {
      docId: options?.docId,
      text: options?.text,
      voiceId: options?.voiceId,
      rate: options?.rate,
    })
  }
}

interface SynthesisRequest {
  textToSpeak: string
  voiceId: string
  rate: number
  signal?: AbortSignal
  etag?: string
}

type SynthesisResponse =
  | { notModified: true }
  | { notModified: false; segment: SynthesizedSegment }

async function requestSynthesis({
  textToSpeak,
  voiceId,
  rate,
  signal,
  etag,
}: SynthesisRequest): Promise<SynthesisResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (etag) headers['If-None-Match'] = etag
  const response = await fetch('/api/tts/synthesize', {
    method: 'POST',
    headers,
    body: JSON.stringify({ text: textToSpeak, voice: voiceId, rate }),
    signal,
  })

  if (response.status === 304) {
    return { notModified: true }
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(typeof data.error === 'string' ? data.error : 'Synthesis failed.')
  }

  const data = (await response.json()) as {
    audio: string
    boundaries: TtsBoundary[]
    wordBoundaries?: TtsBoundary[]
    spokenStart?: number
    spokenEnd?: number
  }
  const binary = atob(data.audio)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  const segment: SynthesizedSegment = {
    blob: new Blob([bytes], { type: 'audio/mpeg' }),
    boundaries: data.boundaries,
    wordBoundaries: data.wordBoundaries ?? [],
    spokenStart: data.spokenStart,
    spokenEnd: data.spokenEnd,
    etag: response.headers.get('ETag') ?? undefined,
  }
  return { notModified: false, segment }
}

export function peekCachedSynthesis(
  textToSpeak: string,
  voiceId: string,
  rate: number,
): SynthesizedSegment | null {
  const trimmed = textToSpeak.trim()
  const cacheKey = synthesisCacheKey(trimmed, voiceId, rate)
  const cached = synthesisCache.get(cacheKey)
  // Same blob guard as getCachedSynthesis so warm-up never trusts an entry
  // that cannot play.
  return cached?.blob ? cached : null
}

export async function getCachedSynthesis(
  textToSpeak: string,
  voiceId: string,
  rate: number,
  signal?: AbortSignal,
  docId?: string,
): Promise<SynthesizedSegment> {
  const trimmed = textToSpeak.trim()
  const cacheKey = synthesisCacheKey(trimmed, voiceId, rate)
  const cached = synthesisCache.get(cacheKey)
  if (cached?.blob) return cached

  // The re-verification here covers paths hydration misses: play before
  // hydration lands, failed hydration, or mid-session LRU eviction.
  const local = await getPersistedSegment(cacheKey)
  if (local) {
    const result = await requestSynthesis({ textToSpeak: trimmed, voiceId, rate, signal, etag: local.etag })
    if (!result.notModified) {
      cacheSynthesis(cacheKey, result.segment, { docId, text: trimmed, voiceId, rate })
      return result.segment
    }
    // Already persisted; rewriting it would duplicate an identical record
    // write and re-run the eviction scan.
    cacheSynthesis(cacheKey, local, { persist: false })
    return local
  }

  const result = await requestSynthesis({ textToSpeak: trimmed, voiceId, rate, signal })
  if (result.notModified) {
    // A 304 requires an If-None-Match, which we only send when we already have
    // a local copy; reaching here without one is an inconsistent server reply.
    throw new Error('Synthesis cache returned 304 without a client ETag')
  }
  cacheSynthesis(cacheKey, result.segment, { docId, text: trimmed, voiceId, rate })
  return result.segment
}

export interface SynthesisCacheStats {
  segments: number
  bytes: number
  /** @deprecated — use segments; kept for backward compatibility */
  documents?: number
}

export interface SynthesisCacheEntry {
  key: string
  savedAt: number
  docId?: string
  text: string
  voiceId: string
  rate: number | null
  bytes: number
  segment: SynthesizedSegment
}

export function getSynthesisCacheStats(): Promise<SynthesisCacheStats> {
  return getPersistedCacheStats()
}

export async function getSynthesisCacheEntries(): Promise<SynthesisCacheEntry[]> {
  const records = await loadPersistedRecords()
  return records
    .map(record => ({
      key: record.key,
      savedAt: record.savedAt,
      docId: record.docId,
      text: record.text ?? '',
      voiceId: record.voiceId ?? '',
      rate: typeof record.rate === 'number' ? record.rate : null,
      bytes: record.blob?.size ?? 0,
      segment: toSynthesizedSegment(record),
    }))
    .sort((a, b) => b.savedAt - a.savedAt)
}

// Clears every persisted segment plus the in-memory LRU so a settings-level
// reset cannot be undone by resident entries.
export function clearSynthesisCache(): Promise<void> {
  synthesisCache.clear()
  return clearPersistedSegments()
}

export async function clearSynthesisCacheEntries(keys: string[]): Promise<void> {
  for (const key of keys) {
    synthesisCache.delete(key)
  }
  await deletePersistedSegments(keys)
}

// Clears only the entries belonging to one document while evicting its current
// segment keys from the in-memory cache immediately.
export async function clearDocumentSynthesisCache(docId: string, keys: string[]): Promise<void> {
  for (const key of keys) {
    synthesisCache.delete(key)
  }
  if (!docId) return
  await deletePersistedSegmentsByDocId(docId)
}
