import { deleteServerDocument, fetchServerDocuments, saveServerDocument } from './documents-client'

export interface StoredDocument {
  id: string
  name: string
  content: string
  updatedAt: number
}

const STORAGE_KEY = 'tts:web-documents'

// Short, URL-friendly document ids so deep links stay compact (`/{docId}`).
const ID_LENGTH = 6
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(ID_LENGTH)
    crypto.getRandomValues(bytes)
    let id = ''
    for (let i = 0; i < ID_LENGTH; i++) {
      id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length]
    }
    return id
  }
  let id = ''
  for (let i = 0; i < ID_LENGTH; i++) {
    id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)]
  }
  return id
}

function isStoredDocument(value: unknown): value is StoredDocument {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<StoredDocument>
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.name === 'string' &&
    typeof candidate.content === 'string' &&
    typeof candidate.updatedAt === 'number' &&
    Number.isFinite(candidate.updatedAt)
  )
}

export function mergeDocuments(local: StoredDocument[], remote: StoredDocument[]): StoredDocument[] {
  const merged = new Map<string, StoredDocument>()
  for (const document of local) {
    merged.set(document.id, document)
  }
  for (const document of remote) {
    const existing = merged.get(document.id)
    // Same doc id in both stores: newest updatedAt wins so edits from another
    // device or session are not silently dropped.
    if (!existing || document.updatedAt >= existing.updatedAt) {
      merged.set(document.id, document)
    }
  }
  return [...merged.values()]
}

function readStoredDocuments(): StoredDocument[] {
  if (typeof localStorage === 'undefined') {
    return []
  }
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(isStoredDocument)
  } catch {
    // Ignore invalid local storage data.
    return []
  }
}

function writeStoredDocuments(documents: StoredDocument[]) {
  if (typeof localStorage === 'undefined') {
    return
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(documents))
}

export function useDocuments() {
  let documents = $state<StoredDocument[]>([])
  let hydrated = false
  let syncEnabled = $state(false)
  let syncing = false
  let syncGeneration = 0
  let syncRequested = false
  // Ids known to exist on the server (from fetches or successful pushes).
  // Reactive so Save-enable derivations update once a push lands.
  let syncedIds = $state(new Set<string>())
  // Last sync failure, if any; cleared on the next successful fetch.
  let syncError = $state<string | null>(null)
  // Ids deleted locally while sync was on that the server may still hold
  // (the DELETE failed or is still in flight). Excluded from push candidates
  // and the merged listing until the server confirms the delete.
  let pendingDeletes = new Set<string>()
  // Ids mutated locally since the last successful push. Retained on sign-out
  // so unpushed edits are never dropped with server-only rows.
  let dirtyIds = new Set<string>()
  // Per-document op chains so a stale PUT cannot resolve after a DELETE and
  // clear the tombstone (resurrecting the server copy), and rapid saves
  // cannot resolve out of order with stale content winning.
  const inFlightOps = new Map<string, Promise<void>>()

  function toSyncError(error: unknown): string {
    return error instanceof Error && error.message === 'Session expired' ? 'session_expired' : 'sync_failed'
  }
  // Session bookkeeping so sign-out can drop server-only rows without
  // touching pre-existing local docs (plain lets: logic-only, never rendered).
  let preSyncLocalIds = new Set<string>()
  let sessionCreatedIds = new Set<string>()
  let lastRemoteIds = new Set<string>()
  const sorted = $derived.by(() => [...documents].sort((a, b) => b.updatedAt - a.updatedAt))

  function persistLocal() {
    writeStoredDocuments(documents)
  }

  function hydrate() {
    if (hydrated) {
      return
    }
    hydrated = true
    documents = readStoredDocuments()
  }

  function findByName(name: string): StoredDocument | undefined {
    return documents.find(document => document.name === name)
  }

  function findById(id: string): StoredDocument | undefined {
    return documents.find(document => document.id === id)
  }

  // Pulls the server copy and merges it with the browser store by doc id,
  // newest updatedAt winning each conflict, then pushes local-only docs
  // upward so a browser-only listing created while logged out actually
  // reaches the server on sign-in. Push candidates are ids the server does
  // not know and we never synced: previously-synced ids missing remotely
  // were deleted elsewhere and must not resurrect. Concurrent calls coalesce
  // to one fetch (latest-wins) so a slow response cannot overwrite newer state.
  async function syncFromServer() {
    if (!syncEnabled || syncing) {
      syncRequested = syncRequested || syncEnabled
      return
    }
    syncing = true
    const generation = syncGeneration
    try {
      const remote = await fetchServerDocuments()
      if (!syncEnabled || generation !== syncGeneration) return
      const remoteIds = new Set(remote.map(document => document.id))
      lastRemoteIds = remoteIds
      const local = readStoredDocuments()
      const pushCandidates = local.filter(
        document => !remoteIds.has(document.id) && !syncedIds.has(document.id) && !pendingDeletes.has(document.id),
      )
      // Union, never replace: a previously-synced id missing remotely was
      // deleted on another device, and forgetting it would re-push the local
      // copy on the next sync.
      syncedIds = new Set([...syncedIds, ...remoteIds])
      // Local deletes the server still holds need another DELETE, not a merge.
      for (const id of pendingDeletes) {
        if (remoteIds.has(id)) {
          retryDelete(id)
        } else {
          pendingDeletes.delete(id)
        }
      }
      documents = mergeDocuments(local, remote).filter(document => !pendingDeletes.has(document.id))
      persistLocal()
      syncError = null
      for (const document of pushCandidates) {
        pushToServer(document)
      }
    } catch (error) {
      // Offline or logged out: keep the local listing untouched.
      syncError = toSyncError(error)
    } finally {
      syncing = false
      if (syncRequested) {
        syncRequested = false
        void syncFromServer()
      }
    }
  }

  // Chain server ops per document id so PUT/DELETE for the same doc run in
  // issue order: a stale PUT can never land after a DELETE, and rapid saves
  // resolve with the latest content winning.
  function chainDocOp(id: string, op: () => Promise<void>): void {
    const previous = inFlightOps.get(id) ?? Promise.resolve()
    const next = previous.then(op).catch(() => {})
    inFlightOps.set(id, next)
    void next.finally(() => {
      if (inFlightOps.get(id) === next) {
        inFlightOps.delete(id)
      }
    })
  }

  function retryDelete(id: string) {
    if (!syncEnabled) {
      return
    }
    // Only the DELETE path clears the tombstone; a PUT resolving late must
    // never mark a deleted id as synced (that resurrects the server copy).
    chainDocOp(id, () =>
      deleteServerDocument(id)
        .then(() => {
          pendingDeletes.delete(id)
        })
        .catch(error => {
          syncError = toSyncError(error)
        }),
    )
  }

  function markSynced(id: string) {
    dirtyIds.delete(id)
    if (syncedIds.has(id)) {
      return
    }
    syncedIds = new Set(syncedIds).add(id)
  }

  function markDirty(id: string) {
    dirtyIds.add(id)
    if (syncedIds.has(id)) {
      syncedIds = new Set([...syncedIds].filter(syncedId => syncedId !== id))
    }
  }

  function isSynced(id: string): boolean {
    return syncedIds.has(id)
  }

  function pushToServer(document: StoredDocument) {
    if (!syncEnabled) {
      return
    }
    // Skip pushes for docs deleted while the PUT was queued: the DELETE
    // chain owns the tombstone, and pushing would resurrect the server copy.
    chainDocOp(document.id, () => {
      if (pendingDeletes.has(document.id)) {
        return Promise.resolve()
      }
      return saveServerDocument(document)
        .then(() => markSynced(document.id))
        .catch(error => {
          syncError = toSyncError(error)
        })
    })
  }

  function save(name: string, content: string): StoredDocument {
    const trimmedName = name.trim()
    const updatedAt = Date.now()
    const existing = findByName(trimmedName)
    if (existing && existing.name === trimmedName && existing.content === content) {
      pushToServer(existing)
      return existing
    }
    let saved: StoredDocument
    if (existing) {
      saved = { ...existing, name: trimmedName, content, updatedAt }
      documents = documents.map(document => (document.id === existing.id ? saved : document))
    } else {
      let id = createId()
      while (documents.some(document => document.id === id)) {
        id = createId()
      }
      saved = { id, name: trimmedName, content, updatedAt }
      documents = [...documents, saved]
      if (syncEnabled) {
        sessionCreatedIds.add(id)
      }
    }
    persistLocal()
    markDirty(saved.id)
    pushToServer(saved)
    return saved
  }

  function rename(id: string, name: string): boolean {
    const trimmedName = name.trim()
    const existing = documents.find(document => document.id === id)
    if (!existing || !trimmedName || trimmedName === existing.name) {
      return false
    }
    if (documents.some(document => document.id !== id && document.name === trimmedName)) {
      return false
    }
    const renamed = { ...existing, name: trimmedName, updatedAt: Date.now() }
    documents = documents.map(document => (document.id === id ? renamed : document))
    persistLocal()
    markDirty(id)
    pushToServer(renamed)
    return true
  }

  function remove(id: string): boolean {
    const existing = documents.find(document => document.id === id)
    if (!existing) {
      return false
    }
    documents = documents.filter(document => document.id !== id)
    persistLocal()
    sessionCreatedIds.delete(id)
    dirtyIds.delete(id)
    if (syncEnabled) {
      // Keep the tombstone: the id stays in syncedIds so later syncs treat a
      // lingering server copy as a failed delete (retried) rather than a new
      // local doc (resurrected).
      pendingDeletes.add(id)
      retryDelete(id)
    }
    return true
  }

  function setSyncEnabled(enabled: boolean) {
    syncEnabled = enabled
    syncGeneration += 1
    if (!enabled) {
      syncError = null
      // Drop server-only rows fetched during the session so a shared device
      // does not leak the previous user's listing. Pre-existing local docs,
      // session-created docs, and unsynced local-only docs stay.
      if (lastRemoteIds.size > 0) {
        documents = documents.filter(
          document =>
            preSyncLocalIds.has(document.id) ||
            sessionCreatedIds.has(document.id) ||
            dirtyIds.has(document.id) ||
            !lastRemoteIds.has(document.id),
        )
        persistLocal()
      }
      syncedIds = new Set()
      pendingDeletes = new Set()
      inFlightOps.clear()
      preSyncLocalIds = new Set()
      sessionCreatedIds = new Set()
      lastRemoteIds = new Set()
      return
    }
    preSyncLocalIds = new Set(documents.map(document => document.id))
    void syncFromServer()
  }

  return {
    hydrate,
    syncFromServer,
    setSyncEnabled,
    get documents() {
      return sorted
    },
    get isSyncEnabled() {
      return syncEnabled
    },
    get syncError() {
      return syncError
    },
    findByName,
    findById,
    save,
    isSynced,
    rename,
    remove,
  }
}
export type DocumentsHandle = ReturnType<typeof useDocuments>
