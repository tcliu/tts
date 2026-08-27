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
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

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

export async function getCachedSynthesis(key: string): Promise<CachedSynthesis | null> {
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
    if (typeof envelope.savedAt !== 'number' || Date.now() - envelope.savedAt > CACHE_TTL_MS || !envelope.value) {
      return null
    }
    return envelope.value
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

export async function setCachedSynthesis(key: string, value: CachedSynthesis): Promise<void> {
  try {
    await mkdir(cacheDir(), { recursive: true })
    const envelope: CacheEnvelope = { savedAt: Date.now(), value }
    await writeFile(path.join(cacheDir(), `${key}.json`), JSON.stringify(envelope), 'utf-8')
  } catch (error) {
    // Caching is best-effort; ignore filesystem errors and serve fresh results.
    logEvent({
      ip: 'unknown',
      action: 'tts_cache_write_error',
      details: { level: 'WARN', key, error: error instanceof Error ? error.message : 'Unknown error' },
    })
  }
}
