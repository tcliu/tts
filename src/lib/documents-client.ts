import type { StoredDocument } from './use-documents.svelte'

const BASE_PATH = '/api/documents'
const REQUEST_TIMEOUT_MS = 15_000

interface WireDocument {
  id: string
  name: string
  content: string
  updated_at: number
}

function isWireDocument(value: unknown): value is WireDocument {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<WireDocument>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.content === 'string' &&
    typeof candidate.updated_at === 'number' &&
    Number.isFinite(candidate.updated_at)
  )
}

function mapDocument(wire: WireDocument): StoredDocument {
  return { id: wire.id, name: wire.name, content: wire.content, updatedAt: wire.updated_at }
}

function withTimeout(): { signal: AbortSignal; cleanup: () => void } {
  if (typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cleanup: () => {} }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}))
  if (response.status === 401) {
    throw new Error('Session expired')
  }
  if (!response.ok) {
    throw new Error(
      typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : 'request_failed',
    )
  }
  return body as T
}

export async function fetchServerDocuments(): Promise<StoredDocument[]> {
  const { signal, cleanup } = withTimeout()
  try {
    const response = await fetch(BASE_PATH, { signal })
    const body = await parseResponse<{ documents?: unknown }>(response)
    const documents = Array.isArray(body.documents) ? body.documents : []
    return documents.filter(isWireDocument).map(mapDocument)
  } finally {
    cleanup()
  }
}

export async function saveServerDocument(document: StoredDocument): Promise<StoredDocument> {
  const { signal, cleanup } = withTimeout()
  try {
    const response = await fetch(BASE_PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: document.id,
        name: document.name,
        content: document.content,
        updated_at: document.updatedAt,
      }),
      signal,
    })
    const body = await parseResponse<{ document?: unknown }>(response)
    if (!isWireDocument(body.document)) {
      throw new Error('Unexpected save response')
    }
    return mapDocument(body.document)
  } finally {
    cleanup()
  }
}

export async function deleteServerDocument(id: string): Promise<void> {
  const { signal, cleanup } = withTimeout()
  try {
    const response = await fetch(`${BASE_PATH}?id=${encodeURIComponent(id)}`, { method: 'DELETE', signal })
    await parseResponse<{ ok: boolean }>(response)
  } finally {
    cleanup()
  }
}
