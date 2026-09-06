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

// Last-opened document id so auth/admin round-trips can return to the same
// doc: push/replace persist every slug update (cleared for a fresh buffer),
// and login/admin read it back from localStorage.
const LAST_DOC_KEY = 'tts:last-doc-id'

export function readLastDocId(): string | null {
  if (typeof localStorage === 'undefined') {
    return null
  }
  const raw = localStorage.getItem(LAST_DOC_KEY)
  return raw && raw.length > 0 ? raw : null
}

export function rememberDocId(docId: string | null): void {
  if (typeof localStorage === 'undefined') {
    return
  }
  if (docId) {
    localStorage.setItem(LAST_DOC_KEY, docId)
  } else {
    localStorage.removeItem(LAST_DOC_KEY)
  }
}

export function lastDocUrl(): string {
  return buildDocUrl(readLastDocId())
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
  rememberDocId(docId)
  if (!hasHistoryApi() || urlShowsDocId(docId)) {
    return
  }
  // Avoid stacking duplicate consecutive entries (e.g. re-opening the doc
  // already shown by the current URL).
  window.history.pushState({ docId: docId ?? null }, '', buildDocUrl(docId))
}

export function replaceDocHistory(docId: string | null): void {
  rememberDocId(docId)
  if (!hasHistoryApi() || urlShowsDocId(docId)) {
    return
  }
  window.history.replaceState({ docId: docId ?? null }, '', buildDocUrl(docId))
}
