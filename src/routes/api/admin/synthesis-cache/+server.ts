import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { isAdminSession } from '$lib/server/admin-auth'
import {
  clearServerCache,
  deleteServerCacheEntries,
  loadServerCacheOverview,
} from '$lib/server/tts-cache'
import { getRequestIp, logEvent } from '$lib/server/logging'
import type { ServerCacheEntry, ServerCacheStats } from '$lib/server/tts-cache'

function toWire(entries: ServerCacheEntry[], stats: ServerCacheStats) {
  return {
    stats: { entries: stats.entries, bytes: stats.bytes },
    entries: entries.map(entry => ({
      key: entry.key,
      text: entry.text ?? null,
      voice: entry.voice ?? null,
      saved_at: entry.savedAt,
      bytes: entry.bytes,
    })),
  }
}

export const GET: RequestHandler = async ({ cookies }) => {
  if (!isAdminSession({ cookies })) {
    return json({ error: 'session_required' }, { status: 401 })
  }
  const overview = await loadServerCacheOverview()
  return json(toWire(overview.entries, overview.stats))
}

export const DELETE: RequestHandler = async event => {
  const { cookies, request, url } = event
  if (!isAdminSession({ cookies })) {
    return json({ error: 'session_required' }, { status: 401 })
  }
  const startedAt = Date.now()
  const ip = getRequestIp(event)
  const body = await request.json().catch(() => null)
  const bodyKeys = body && typeof body === 'object' ? (body as { keys?: unknown }).keys : undefined
  const queryKeys = url.searchParams.get('keys')
  const keys = Array.isArray(bodyKeys)
    ? bodyKeys.filter((key): key is string => typeof key === 'string')
    : typeof queryKeys === 'string' && queryKeys
      ? queryKeys.split(',').map(key => key.trim()).filter(Boolean)
      : null

  if (keys === null) {
    logEvent({ ip, action: 'admin_cache_clear_start', details: {} })
    const { deleted } = await clearServerCache()
    const overview = await loadServerCacheOverview()
    logEvent({ ip, action: 'admin_cache_clear_end', details: { deleted, elapsed_ms: Date.now() - startedAt } })
    return json(toWire(overview.entries, overview.stats))
  }

  logEvent({ ip, action: 'admin_cache_clear_entries_start', details: { requested: keys.length } })
  const overview = await loadServerCacheOverview()
  const { deleted } = await deleteServerCacheEntries(keys)
  // All requested keys are validated before delete, so a full delete lets us
  // derive the fresh state in memory instead of rescanning the directory.
  const deletedSet = new Set(keys)
  const freshEntries =
    deleted === keys.length
      ? overview.entries.filter(entry => !deletedSet.has(entry.key))
      : (await loadServerCacheOverview()).entries
  const freshStats: ServerCacheStats =
    deleted === keys.length
      ? {
          entries: overview.stats.entries - deleted,
          bytes: freshEntries.reduce((total, entry) => total + entry.bytes, 0),
        }
      : (await loadServerCacheOverview()).stats
  logEvent({
    ip,
    action: 'admin_cache_clear_entries_end',
    details: { requested: keys.length, deleted, elapsed_ms: Date.now() - startedAt },
  })
  return json(toWire(freshEntries, freshStats))
}
