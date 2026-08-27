import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { synthesisCacheKey as buildSynthesisCacheKey } from '$lib/tts-cache-key'
import type { TtsBoundary } from '$lib/tts-reference'
import { logEvent } from './logging'

export interface CachedSynthesis {
  audio: string
  boundaries: TtsBoundary[]
  wordBoundaries?: TtsBoundary[]
  spokenStart?: number
  spokenEnd?: number
}

interface CacheEnvelope {
  savedAt: number
  value: CachedSynthesis
  etag: string
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Content hash for ETag/If-None-Match so a client can verify its IndexedDB
// copy is still current without re-downloading the audio. Deterministic by
// content (audio + boundaries), independent of encoding/storage quirks.
export function synthesisEtag(value: CachedSynthesis): string {
  const canonical = JSON.stringify({
    audio: value.audio,
    boundaries: value.boundaries,
    wordBoundaries: value.wordBoundaries ?? [],
    spokenStart: value.spokenStart ?? null,
    spokenEnd: value.spokenEnd ?? null,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

function cacheDir(): string {
  const override = process.env.TTS_CACHE_DIR
  if (override) return override
  // Vercel serverless functions have a read-only filesystem except /tmp.
  // Fall back to a writable temp dir so caching still works per-instance.
  if (process.env.VERCEL === '1') return path.resolve('/tmp', '.tts')
  return path.resolve(process.cwd(), '.tts')
}

export function synthesisCacheKey(text: string, voice: string, rate: number): string {
  return createHash('sha256').update(buildSynthesisCacheKey(text, voice, rate)).digest('hex')
}

export interface CachedSynthesisResult {
  value: CachedSynthesis
  etag: string
}

export async function getCachedSynthesis(key: string): Promise<CachedSynthesisResult | null> {
  const file = path.join(cacheDir(), `${key}.json`)
  let raw: string
  try {
    raw = await readFile(file, 'utf-8')
  } catch (error) {
    // A missing file is a normal cache miss; anything else is unexpected.
    // Never unlink on I/O errors — a transient EBUSY/EPERM must not destroy a
    // valid entry.
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    logEvent({
      ip: 'unknown',
      action: 'tts_cache_read_error',
      details: { level: 'WARN', key, error: error instanceof Error ? error.message : 'Unknown error' },
    })
    return null
  }

  try {
    const envelope = JSON.parse(raw) as Partial<CacheEnvelope>
    if (
      typeof envelope.savedAt !== 'number' ||
      Date.now() - envelope.savedAt > CACHE_TTL_MS ||
      !envelope.value ||
      typeof envelope.value.audio !== 'string'
    ) {
      return null
    }
    // Envelopes written before etags existed lack one; derive it on read so
    // the cached audio keeps serving instead of forcing re-synthesis.
    const etag =
      typeof envelope.etag === 'string' && envelope.etag ? envelope.etag : synthesisEtag(envelope.value)
    return { value: envelope.value, etag }
  } catch (error) {
    // Corrupt envelope content: drop it so it is not re-read and re-parsed on
    // every subsequent lookup of this key.
    await unlink(file).catch(() => {})
    logEvent({
      ip: 'unknown',
      action: 'tts_cache_read_error',
      details: { level: 'WARN', key, error: error instanceof Error ? error.message : 'Unknown error' },
    })
    return null
  }
}

export async function setCachedSynthesis(key: string, value: CachedSynthesis): Promise<string> {
  const etag = synthesisEtag(value)
  try {
    await mkdir(cacheDir(), { recursive: true })
    const envelope: CacheEnvelope = { savedAt: Date.now(), value, etag }
    await writeFile(path.join(cacheDir(), `${key}.json`), JSON.stringify(envelope), 'utf-8')
  } catch (error) {
    // Caching is best-effort; ignore filesystem errors and serve fresh results.
    logEvent({
      ip: 'unknown',
      action: 'tts_cache_write_error',
      details: { level: 'WARN', key, error: error instanceof Error ? error.message : 'Unknown error' },
    })
  }
  return etag
}

// If-None-Match tolerates quoted and weak validators plus comma lists per RFC
// 7232; strict equality would silently defeat reuse when a proxy rewrites the
// form. The wildcard matches any current representation.
export function matchesIfNoneMatch(header: string, etag: string): boolean {
  if (header.trim() === '*') return true
  return header
    .split(',')
    .some(candidate => candidate.trim().replace(/^W\//, '').replaceAll('"', '') === etag)
}
