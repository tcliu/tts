import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { synthesisCacheKey as buildSynthesisCacheKey } from '$lib/tts-cache-key'
import type { TtsBoundary } from '$lib/tts-reference'

export interface CachedSynthesis {
  audio: string
  boundaries: TtsBoundary[]
}

interface CacheEnvelope {
  savedAt: number
  value: CachedSynthesis
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function cacheDir(): string {
  return process.env.TTS_CACHE_DIR ?? path.resolve(process.cwd(), '.tts')
}

export function synthesisCacheKey(text: string, voice: string, rate: number): string {
  return createHash('sha256').update(buildSynthesisCacheKey(text, voice, rate)).digest('hex')
}

export async function getCachedSynthesis(key: string): Promise<CachedSynthesis | null> {
  try {
    const raw = await readFile(path.join(cacheDir(), `${key}.json`), 'utf-8')
    const envelope = JSON.parse(raw) as Partial<CacheEnvelope>
    if (typeof envelope.savedAt !== 'number' || Date.now() - envelope.savedAt > CACHE_TTL_MS || !envelope.value) {
      return null
    }
    return envelope.value
  } catch {
    return null
  }
}

export async function setCachedSynthesis(key: string, value: CachedSynthesis): Promise<void> {
  try {
    await mkdir(cacheDir(), { recursive: true })
    const envelope: CacheEnvelope = { savedAt: Date.now(), value }
    await writeFile(path.join(cacheDir(), `${key}.json`), JSON.stringify(envelope), 'utf-8')
  } catch {
    // Caching is best-effort; ignore filesystem errors and serve fresh results.
  }
}
