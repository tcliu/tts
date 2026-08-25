export interface StoredDocument {
  id: string
  name: string
  content: string
  updatedAt: number
}

const STORAGE_KEY = 'tts:web-documents'

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
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

  const sorted = $derived.by(() => [...documents].sort((a, b) => b.updatedAt - a.updatedAt))

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

  function save(name: string, content: string): StoredDocument {
    const trimmedName = name.trim()
    const updatedAt = Date.now()
    const existing = findByName(trimmedName)
    if (existing && existing.name === trimmedName && existing.content === content) {
      return existing
    }
    let saved: StoredDocument
    if (existing) {
      saved = { ...existing, name: trimmedName, content, updatedAt }
      documents = documents.map(document => (document.id === existing.id ? saved : document))
    } else {
      saved = { id: createId(), name: trimmedName, content, updatedAt }
      documents = [...documents, saved]
    }
    writeStoredDocuments(documents)
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
    documents = documents.map(document => (document.id === id ? { ...document, name: trimmedName } : document))
    writeStoredDocuments(documents)
    return true
  }

  function remove(id: string): boolean {
    const existing = documents.find(document => document.id === id)
    if (!existing) {
      return false
    }
    documents = documents.filter(document => document.id !== id)
    writeStoredDocuments(documents)
    return true
  }

  return {
    hydrate,
    get documents() {
      return sorted
    },
    findByName,
    findById,
    save,
    rename,
    remove,
  }
}

export type DocumentsHandle = ReturnType<typeof useDocuments>
