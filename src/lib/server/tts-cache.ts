import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { synthesisCacheKey as buildSynthesisCacheKey } from '$lib/tts-cache-key'
import type { TtsBoundary } from '$lib/tts-reference'
import { getCacheMaxBytes, getCacheMaxEntries, getCacheTtlMs } from './admin-properties'
import { logEvent } from './logging'

export interface CachedSynthesis {
  audio: string
  boundaries: TtsBoundary[]
  wordBoundaries?: TtsBoundary[]
  spokenStart?: number
  spokenEnd?: number
  text?: string
  voice?: string
}

interface CacheEnvelope {
  savedAt: number
  value: CachedSynthesis
  etag: string
}

const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_CACHE_MAX_ENTRIES = 500
const DEFAULT_CACHE_MAX_BYTES = 200 * 1024 * 1024

export function cacheTtlMs(): number {
  try {
    return getCacheTtlMs()
  } catch {
    return DEFAULT_CACHE_TTL_MS
  }
}

export function cacheMaxEntries(): number {
  try {
    return getCacheMaxEntries()
  } catch {
    return DEFAULT_CACHE_MAX_ENTRIES
  }
}

export function cacheMaxBytes(): number {
  try {
    return getCacheMaxBytes()
  } catch {
    return DEFAULT_CACHE_MAX_BYTES
  }
}

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

export function hashedSynthesisCacheKey(text: string, voice: string, rate: number): string {
  // buildSynthesisCacheKey is canonical at 1×; legacy rate-keyed files
  // (hash of [text,voice,rate≠1]) are orphaned and age out via TTL/size
  // prune below without eager migration.
  return createHash('sha256').update(buildSynthesisCacheKey(text, voice, rate)).digest('hex')
}

export function synthesisCacheKey(text: string, voice: string, rate: number): string {
  return hashedSynthesisCacheKey(text, voice, rate)
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
    const rawEnvelope = JSON.parse(raw) as Partial<CacheEnvelope> & { value?: Record<string, unknown> }
    if (
      typeof rawEnvelope.savedAt !== 'number' ||
      Date.now() - rawEnvelope.savedAt > cacheTtlMs() ||
      !rawEnvelope.value ||
      typeof (rawEnvelope.value as { audio?: unknown }).audio !== 'string'
    ) {
      return null
    }
    // Normalize snake_case wire payloads (and legacy camel) to the internal
    // camelCase CachedSynthesis shape so callers never branch on naming.
    const v = rawEnvelope.value as Record<string, unknown>
    const normalized: CachedSynthesis = {
      audio: v.audio as string,
      boundaries: (v.boundaries as TtsBoundary[]) ?? [],
      wordBoundaries: (v.wordBoundaries as TtsBoundary[] | undefined) ?? (v.word_boundaries as TtsBoundary[] | undefined),
      spokenStart: (v.spokenStart as number | undefined) ?? (v.spoken_start as number | undefined),
      spokenEnd: (v.spokenEnd as number | undefined) ?? (v.spoken_end as number | undefined),
      text: typeof v.text === 'string' ? v.text : undefined,
      voice: typeof v.voice === 'string' ? v.voice : undefined,
    }
    const envelope: CacheEnvelope = {
      savedAt: rawEnvelope.savedAt as number,
      etag: rawEnvelope.etag as string,
      value: normalized,
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
    await pruneCache()
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

export async function pruneCache(): Promise<void> {
  const dir = cacheDir()
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return
  }
  const entries: { file: string; savedAt: number; bytes: number }[] = []
  let totalBytes = 0
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const full = path.join(dir, file)
    let fileStat: { size: number; mtimeMs: number }
    try {
      fileStat = await stat(full)
    } catch {
      continue
    }
    let savedAt = 0
    try {
      const raw = await readFile(full, 'utf-8')
      const envelope = JSON.parse(raw) as Partial<CacheEnvelope>
      savedAt = typeof envelope.savedAt === 'number' ? envelope.savedAt : 0
      if (savedAt === 0) savedAt = fileStat.mtimeMs
    } catch {
      // Unreadable envelope: keep filesystem mtime as age proxy and let the
      // next getCachedSynthesis drop it on parse failure.
      savedAt = fileStat.mtimeMs
    }
    entries.push({ file: full, savedAt, bytes: fileStat.size })
    totalBytes += fileStat.size
  }
  const now = Date.now()
  const ttl = cacheTtlMs()
  const maxEntries = cacheMaxEntries()
  const maxBytes = cacheMaxBytes()
  const expired = entries.filter(e => e.savedAt > 0 && now - e.savedAt > ttl)
  for (const entry of expired) {
    await unlink(entry.file).catch(() => {})
    totalBytes -= entry.bytes
  }
  let remaining = entries.filter(e => !expired.includes(e))
  remaining.sort((a, b) => a.savedAt - b.savedAt)
  let pruned = expired.length
  let prunedBytes = expired.reduce((sum, e) => sum + e.bytes, 0)
  while (remaining.length > maxEntries || totalBytes > maxBytes) {
    const oldest = remaining.shift()
    if (!oldest) break
    await unlink(oldest.file).catch(() => {})
    totalBytes -= oldest.bytes
    pruned += 1
    prunedBytes += oldest.bytes
  }
  if (pruned > 0) {
    logEvent({
      ip: 'unknown',
      action: 'tts_cache_pruned',
      details: { level: 'INFO', pruned, pruned_bytes: prunedBytes, remaining: remaining.length },
    })
  }
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

export interface ServerCacheEntry {
  key: string
  text?: string
  voice?: string
  savedAt: number
  bytes: number
}

export interface ServerCacheStats {
  entries: number
  bytes: number
}

async function readEnvelopeMeta(file: string): Promise<{ savedAt: number; text?: string; voice?: string } | null> {
  try {
    const raw = await readFile(file, 'utf-8')
    const envelope = JSON.parse(raw) as Partial<CacheEnvelope> & { value?: Record<string, unknown> }
    if (typeof envelope.savedAt !== 'number') return null
    const value = envelope.value
    if (!value || typeof value !== 'object' || typeof (value as { audio?: unknown }).audio !== 'string') {
      return null
    }
    const record = value as Record<string, unknown>
    return {
      savedAt: envelope.savedAt,
      text: typeof record.text === 'string' ? record.text : undefined,
      voice: typeof record.voice === 'string' ? record.voice : undefined,
    }
  } catch {
    return null
  }
}

interface CacheFileMeta {
  key: string
  savedAt: number
  text?: string
  voice?: string
  bytes: number
}

async function readAllCacheMetas(): Promise<CacheFileMeta[]> {
  const dir = cacheDir()
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []
  }
  const metas: CacheFileMeta[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const full = path.join(dir, file)
    let size = 0
    try {
      size = (await stat(full)).size
    } catch {
      continue
    }
    const meta = await readEnvelopeMeta(full)
    if (!meta) continue
    metas.push({ key: file.slice(0, -'.json'.length), savedAt: meta.savedAt, text: meta.text, voice: meta.voice, bytes: size })
  }
  return metas
}

export async function listServerCacheEntries(): Promise<ServerCacheEntry[]> {
  const ttl = cacheTtlMs()
  const now = Date.now()
  const entries = (await readAllCacheMetas()).filter(meta => now - meta.savedAt <= ttl)
  entries.sort((a, b) => b.savedAt - a.savedAt)
  return entries
}

export interface ServerCacheOverview {
  stats: ServerCacheStats
  entries: ServerCacheEntry[]
}

// One directory scan serves both the visible (unexpired) entries and the
// disk-usage stats, which cover every cache file including expired ones.
export async function loadServerCacheOverview(): Promise<ServerCacheOverview> {
  const ttl = cacheTtlMs()
  const now = Date.now()
  const metas = await readAllCacheMetas()
  const entries = metas
    .filter(meta => now - meta.savedAt <= ttl)
    .sort((a, b) => b.savedAt - a.savedAt)
  return {
    stats: { entries: metas.length, bytes: metas.reduce((total, meta) => total + meta.bytes, 0) },
    entries,
  }
}

export function isSafeCacheKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(key)
}

export async function deleteServerCacheEntries(keys: string[]): Promise<{ deleted: number }> {
  let deleted = 0
  for (const key of keys) {
    if (!isSafeCacheKey(key)) continue
    try {
      await unlink(path.join(cacheDir(), `${key}.json`))
      deleted += 1
    } catch {
      continue
    }
  }
  return { deleted }
}

export async function clearServerCache(): Promise<{ deleted: number }> {
  const metas = await readAllCacheMetas()
  return deleteServerCacheEntries(metas.map(meta => meta.key))
}
