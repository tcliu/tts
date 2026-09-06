import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mergeDocuments, useDocuments, type StoredDocument } from './use-documents.svelte'

describe('useDocuments', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('starts empty and hydrates nothing without stored data', () => {
    const documents = useDocuments()
    documents.hydrate()
    expect(documents.documents).toEqual([])
  })

  it('saves a new document and persists it to localStorage', () => {
    const documents = useDocuments()
    documents.hydrate()
    const saved = documents.save('Hello', 'Hello world')
    expect(saved.name).toBe('Hello')
    expect(saved.content).toBe('Hello world')
    const raw = JSON.parse(localStorage.getItem('tts:web-documents') ?? '[]') as StoredDocument[]
    expect(raw).toHaveLength(1)
    expect(raw[0].name).toBe('Hello')
  })

  it('overwrites an existing document with the same name', () => {
    const documents = useDocuments()
    documents.hydrate()
    documents.save('Notes', 'first')
    const updated = documents.save('Notes', 'second')
    expect(documents.documents).toHaveLength(1)
    expect(updated.content).toBe('second')
    expect(updated.id).toBe(documents.findByName('Notes')?.id)
  })

  it('sorts most recently updated documents first', () => {
    const documents = useDocuments()
    documents.hydrate()
    documents.save('A', 'a')
    documents.save('B', 'b')
    documents.save('A', 'a2')
    expect(documents.documents.map(doc => doc.name)).toEqual(['A', 'B'])
  })

  it('rehydrates previously persisted documents', () => {
    const first = useDocuments()
    first.hydrate()
    first.save('Persisted', 'content')

    const second = useDocuments()
    second.hydrate()
    expect(second.findById(first.findByName('Persisted')?.id ?? '')?.content).toBe('content')
  })

  it('renames a document in place and persists the new name', () => {
    const documents = useDocuments()
    documents.hydrate()
    const saved = documents.save('Notes', 'content')
    expect(documents.rename(saved.id, 'Renamed')).toBe(true)
    expect(documents.findById(saved.id)?.name).toBe('Renamed')

    const second = useDocuments()
    second.hydrate()
    expect(second.findById(saved.id)?.name).toBe('Renamed')
  })

  it('rejects renaming onto an existing document name', () => {
    const documents = useDocuments()
    documents.hydrate()
    const first = documents.save('A', 'a')
    documents.save('B', 'b')
    expect(documents.rename(first.id, 'B')).toBe(false)
    expect(documents.findById(first.id)?.name).toBe('A')
    expect(documents.documents).toHaveLength(2)
  })

  it('removes a document and persists the deletion', () => {
    const documents = useDocuments()
    documents.hydrate()
    const saved = documents.save('Temp', 'content')
    expect(documents.remove(saved.id)).toBe(true)
    expect(documents.documents).toHaveLength(0)

    const second = useDocuments()
    second.hydrate()
    expect(second.documents).toHaveLength(0)
  })

  it('returns false when removing an unknown id', () => {
    const documents = useDocuments()
    documents.hydrate()
    documents.save('A', 'a')
    expect(documents.remove('missing')).toBe(false)
    expect(documents.documents).toHaveLength(1)
  })

  it('ignores malformed stored payloads', () => {
    localStorage.setItem(
      'tts:web-documents',
      JSON.stringify([{ id: 'x' }, { id: 'y', name: 'ok', content: 'c', updatedAt: 1 }, 'junk']),
    )
    const documents = useDocuments()
    documents.hydrate()
    expect(documents.documents).toEqual([{ id: 'y', name: 'ok', content: 'c', updatedAt: 1 }])
  })
})

describe('mergeDocuments', () => {
  it('unions both stores deduplicated by doc id', () => {
    const merged = mergeDocuments(
      [{ id: 'a', name: 'A', content: 'a', updatedAt: 1 }],
      [{ id: 'b', name: 'B', content: 'b', updatedAt: 2 }],
    )
    expect(merged.map(doc => doc.id).sort()).toEqual(['a', 'b'])
  })

  it('resolves same-id conflicts by newest updatedAt', () => {
    const local = [{ id: 'a', name: 'A', content: 'old', updatedAt: 1 }]
    const remote = [{ id: 'a', name: 'A', content: 'new', updatedAt: 2 }]
    expect(mergeDocuments(local, remote)).toEqual(remote)
    expect(mergeDocuments(remote, local)).toEqual(remote)
  })

  it('keeps the local copy when it is newer than the server copy', () => {
    const local = [{ id: 'a', name: 'A', content: 'new', updatedAt: 3 }]
    const remote = [{ id: 'a', name: 'A', content: 'old', updatedAt: 2 }]
    expect(mergeDocuments(local, remote)).toEqual(local)
  })
})

describe('useDocuments server sync', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('merges the server listing into local documents on sync', async () => {
    const remote = [{ id: 'b', name: 'B', content: 'b', updatedAt: 2 }]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ documents: [{ id: 'b', name: 'B', content: 'b', updated_at: 2 }] }), { status: 200 })),
    )
    const documents = useDocuments()
    documents.hydrate()
    documents.save('A', 'a')
    documents.setSyncEnabled(true)
    await documents.syncFromServer()
    await vi.waitFor(() => {
      expect(documents.findById('b')?.content).toBe('b')
    })
    expect(documents.findByName('A')).toBeDefined()
    expect(remote).toHaveLength(1)
  })

  it('pushes saves to the server when sync is enabled', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body)) as { id: string; name: string; content: string; updated_at: number }
          return new Response(JSON.stringify({ document: body }), { status: 200 })
        }
        return new Response(JSON.stringify({ documents: [] }), { status: 200 })
      }),
    )
    const documents = useDocuments()
    documents.hydrate()
    documents.setSyncEnabled(true)
    await documents.syncFromServer()
    const saved = documents.save('Notes', 'content')
    await vi.waitFor(() => {
      expect(calls.some(call => call.init?.method === 'PUT')).toBe(true)
    })
    const put = calls.find(call => call.init?.method === 'PUT')
    expect(JSON.parse(String(put?.init?.body))).toMatchObject({ id: saved.id, name: 'Notes' })
  })

  it('does not hit the network when sync is disabled', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ documents: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const documents = useDocuments()
    documents.hydrate()
    documents.save('Local', 'content')
    await documents.syncFromServer()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('useDocuments sync tracking', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('marks fetched server ids as synced', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ documents: [{ id: 'a', name: 'A', content: 'a', updated_at: 1 }] }), { status: 200 })),
    )
    const documents = useDocuments()
    documents.hydrate()
    expect(documents.isSynced('a')).toBe(false)
    documents.setSyncEnabled(true)
    await documents.syncFromServer()
    await vi.waitFor(() => {
      expect(documents.isSynced('a')).toBe(true)
    })
  })

  it('clears synced ids when sync is disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ documents: [{ id: 'a', name: 'A', content: 'a', updated_at: 1 }] }), { status: 200 })),
    )
    const documents = useDocuments()
    documents.hydrate()
    documents.setSyncEnabled(true)
    await documents.syncFromServer()
    await vi.waitFor(() => {
      expect(documents.isSynced('a')).toBe(true)
    })
    documents.setSyncEnabled(false)
    expect(documents.isSynced('a')).toBe(false)
    expect(documents.isSyncEnabled).toBe(false)
  })
})

describe('useDocuments sign-in push-up and sign-out prune', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('pushes logged-out local docs upward on first sync', async () => {
    const puts: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body)) as { id: string; name: string; content: string; updated_at: number }
          puts.push(body)
          return new Response(JSON.stringify({ document: body }), { status: 200 })
        }
        return new Response(JSON.stringify({ documents: [] }), { status: 200 })
      }),
    )
    const documents = useDocuments()
    documents.hydrate()
    const saved = documents.save('Offline', 'draft')
    expect(puts).toHaveLength(0)
    documents.setSyncEnabled(true)
    await vi.waitFor(() => {
      expect(puts).toHaveLength(1)
    })
    expect(puts[0]).toMatchObject({ id: saved.id, name: 'Offline' })
  })

  it('does not push previously-synced docs missing from the server', async () => {
    let remote: unknown[] = [{ id: 'a', name: 'A', content: 'a', updated_at: 1 }]
    const puts: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          puts.push(JSON.parse(String(init.body)))
          return new Response(JSON.stringify({ document: {} }), { status: 200 })
        }
        return new Response(JSON.stringify({ documents: remote }), { status: 200 })
      }),
    )
    const documents = useDocuments()
    documents.hydrate()
    documents.setSyncEnabled(true)
    await documents.syncFromServer()
    await vi.waitFor(() => {
      expect(documents.isSynced('a')).toBe(true)
    })
    remote = []
    puts.length = 0
    await documents.syncFromServer()
    // Flush the fire-and-forget push chain deterministically: the stubbed
    // fetch plus `Response.json()` settle in microtasks, so draining the
    // microtask queue (no wall-clock sleep) proves no PUT was issued.
    for (let i = 0; i < 20; i += 1) {
      await Promise.resolve()
    }
    expect(puts).toHaveLength(0)
    expect(documents.findById('a')).toBeDefined()
  })

  it('does not resurrect a document deleted while its save is in flight', async () => {
    let releaseSave!: () => void
    const saveGate = new Promise<void>(resolve => {
      releaseSave = resolve
    })
    const requests: Array<{ method?: string; id?: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body)) as { id: string }
          requests.push({ method: 'PUT', id: body.id })
          await saveGate
          return new Response(JSON.stringify({ document: { ...body, name: 'N', content: 'c', updated_at: 1 } }), {
            status: 200,
          })
        }
        if (init?.method === 'DELETE') {
          requests.push({ method: 'DELETE' })
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        }
        return new Response(JSON.stringify({ documents: [] }), { status: 200 })
      }),
    )
    const documents = useDocuments()
    documents.hydrate()
    documents.setSyncEnabled(true)
    await documents.syncFromServer()
    const saved = documents.save('N', 'c')
    // Delete while the PUT is still in flight: the stale PUT resolving late
    // must not clear the delete tombstone or mark the id synced.
    expect(documents.remove(saved.id)).toBe(true)
    releaseSave()
    await vi.waitFor(() => {
      expect(requests).toContainEqual({ method: 'DELETE' })
    })
    for (let i = 0; i < 20; i += 1) {
      await Promise.resolve()
    }
    expect(documents.findById(saved.id)).toBeUndefined()
    expect(documents.isSynced(saved.id)).toBe(false)
  })

  it('drops server-only docs on sign-out but keeps local docs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ documents: [{ id: 'srv', name: 'Srv', content: 's', updated_at: 1 }] }), { status: 200 })),
    )
    const documents = useDocuments()
    documents.hydrate()
    documents.save('Mine', 'm')
    documents.setSyncEnabled(true)
    await documents.syncFromServer()
    await vi.waitFor(() => {
      expect(documents.findById('srv')).toBeDefined()
    })
    documents.setSyncEnabled(false)
    expect(documents.findById('srv')).toBeUndefined()
    expect(documents.findByName('Mine')).toBeDefined()
    expect(documents.isSyncEnabled).toBe(false)
  })

  it('records syncError when the server fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    const documents = useDocuments()
    documents.hydrate()
    expect(documents.syncError).toBeNull()
    documents.setSyncEnabled(true)
    await documents.syncFromServer()
    await vi.waitFor(() => {
      expect(documents.syncError).toBe('sync_failed')
    })
  })
})
