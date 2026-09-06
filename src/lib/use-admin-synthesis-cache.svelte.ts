import {
  AdminAuthError,
  adminErrorCode,
  clearAdminServerCache,
  fetchAdminServerCache,
  fetchAdminServerCacheAudio,
  type AdminServerCacheEntry,
  type AdminServerCacheStats,
} from '$lib/admin-client'

export function useAdminSynthesisCache(onSignedOut: () => void) {
  let stats = $state<AdminServerCacheStats | null>(null)
  let entries = $state<AdminServerCacheEntry[]>([])
  let loading = $state(false)
  let pending = $state(false)
  let loadError = $state('')
  let loaded = $state(false)
  let refreshRequested = false

  function handleAuthError(error: unknown): boolean {
    if (error instanceof AdminAuthError) {
      onSignedOut()
      return true
    }
    return false
  }

  async function load(): Promise<boolean> {
    if (loading) {
      refreshRequested = true
      return false
    }
    loading = true
    try {
      do {
        refreshRequested = false
        try {
          const result = await fetchAdminServerCache()
          stats = result.stats
          entries = result.entries
          loaded = true
          loadError = ''
        } catch (error) {
          if (!handleAuthError(error)) {
            loadError = adminErrorCode(error)
          }
          return false
        }
      } while (refreshRequested)
      return true
    } finally {
      loading = false
    }
  }

  async function clearSelected(keys: string[]): Promise<boolean> {
    if (keys.length === 0) return true
    pending = true
    try {
      const result = await clearAdminServerCache(keys)
      stats = result.stats
      entries = result.entries
      loadError = ''
      return true
    } catch (error) {
      if (!handleAuthError(error)) {
        loadError = adminErrorCode(error)
      }
      return false
    } finally {
      pending = false
    }
  }
  async function clearAll(): Promise<boolean> {
    pending = true
    try {
      const result = await clearAdminServerCache()
      stats = result.stats
      entries = result.entries
      loadError = ''
      return true
    } catch (error) {
      if (!handleAuthError(error)) {
        loadError = adminErrorCode(error)
      }
      return false
    } finally {
      pending = false
    }
  }

  async function fetchAudio(key: string): Promise<{ audio: string; etag: string } | null> {
    try {
      return await fetchAdminServerCacheAudio(key)
    } catch (error) {
      if (!handleAuthError(error)) {
        throw error
      }
      return null
    }
  }

  function reset() {
    stats = null
    entries = []
    loading = false
    pending = false
    loadError = ''
    loaded = false
  }

  return {
    get stats() {
      return stats
    },
    get entries() {
      return entries
    },
    get loading() {
      return loading
    },
    get pending() {
      return pending
    },
    get loadError() {
      return loadError
    },
    get loaded() {
      return loaded
    },
    load,
    clearSelected,
    clearAll,
    fetchAudio,
    reset,
  }
}
