import { base } from '$app/paths'
import { browser } from '$app/environment'

// Document navigation mirrors the share-text project: each opened document is
// reflected in the URL as `{base}/{docId}` so the browser Back/Forward buttons
// move between documents. The single-page app keeps documents in localStorage,
// so the URL carries only the active document id (or the base path for a fresh
// buffer).

export function buildDocUrl(docId: string | null): string {
  const root = base || '/'
  if (!docId) {
    return root
  }
  const sep = root.endsWith('/') ? '' : '/'
  return `${root}${sep}${encodeURIComponent(docId)}`
}

export function parseDocId(): string | null {
  if (!browser || typeof window === 'undefined') {
    return null
  }
  const path = window.location.pathname
  const root = base || ''
  const rest = path.startsWith(root) ? path.slice(root.length) : path
  let trimmed = rest.startsWith('/') ? rest.slice(1) : rest
  if (trimmed.endsWith('/') && trimmed.length > 1) {
    trimmed = trimmed.slice(0, -1)
  }
  if (trimmed === '') {
    return null
  }
  try {
    return decodeURIComponent(trimmed)
  } catch {
    return trimmed
  }
}

function hasHistoryApi(): boolean {
  return (
    browser &&
    typeof window.history?.pushState === 'function' &&
    typeof window.history?.replaceState === 'function'
  )
}

// Duplicate-entry guard: compare the requested id against the id the current
// URL resolves to, so base-path handling stays consistent with parseDocId.
function urlShowsDocId(docId: string | null): boolean {
  return parseDocId() === docId
}

export function pushDocHistory(docId: string | null): void {
  if (!hasHistoryApi() || urlShowsDocId(docId)) {
    return
  }
  // Avoid stacking duplicate consecutive entries (e.g. re-opening the doc
  // already shown by the current URL).
  window.history.pushState({ docId: docId ?? null }, '', buildDocUrl(docId))
}

export function replaceDocHistory(docId: string | null): void {
  if (!hasHistoryApi() || urlShowsDocId(docId)) {
    return
  }
  window.history.replaceState({ docId: docId ?? null }, '', buildDocUrl(docId))
}
