import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { synthesisCacheKey as buildSynthesisCacheKey } from '$lib/tts-cache-key'
import type { TtsBoundary } from '$lib/tts-reference'

export interface CachedSynthesis {
  audio: string
  boundaries: TtsBoundary[]
}

const CACHE_DIR = path.resolve(process.cwd(), '.tts')

export function synthesisCacheKey(text: string, voice: string, rate: number): string {
  return createHash('sha256').update(buildSynthesisCacheKey(text, voice, rate)).digest('hex')
}

export async function getCachedSynthesis(key: string): Promise<CachedSynthesis | null> {
  try {
    const raw = await readFile(path.join(CACHE_DIR, `${key}.json`), 'utf-8')
    return JSON.parse(raw) as CachedSynthesis
  } catch {
    return null
  }
}

export async function setCachedSynthesis(key: string, value: CachedSynthesis): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true })
    await writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(value), 'utf-8')
  } catch {
    // Caching is best-effort; ignore filesystem errors and serve fresh results.
  }
}
