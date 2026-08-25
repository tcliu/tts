import { beforeEach, describe, expect, it } from 'vitest'
import { useDocuments, type StoredDocument } from './use-documents.svelte'

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
