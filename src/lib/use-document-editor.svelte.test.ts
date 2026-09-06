import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocumentEditor, type DocumentEditorHandle } from './use-document-editor.svelte'
import type { DocumentsHandle } from './use-documents.svelte'
import type { SettingsHandle } from './use-settings.svelte'
import { MAX_UPLOAD_BYTES } from './upload-text'

function createEditor(overrides: Partial<Parameters<typeof useDocumentEditor>[0]> = {}): {
  editor: DocumentEditorHandle
  settings: { content: string }
  deps: Parameters<typeof useDocumentEditor>[0]
} {
  let content = ''
  const settings = {
    locale: 'en',
    get content(): string {
      return content
    },
    set content(value: string) {
      content = value
    },
    get canPlay(): boolean {
      return content.trim().length > 0
    },
  } as unknown as SettingsHandle
  const deps = {
    settings,
    documents: {} as DocumentsHandle,
    resetPlaybackSession: vi.fn(),
    closeDrawer: vi.fn(),
    focusEditor: vi.fn(),
    openFilePicker: vi.fn(),
    ...overrides,
  }
  return { editor: useDocumentEditor(deps), settings, deps }
}

describe('useDocumentEditor upload', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('replaces content with the uploaded file and reports success', async () => {
    const { editor, settings, deps } = createEditor()
    editor.markBaseline()
    await editor.importFile(new File(['hello'], 'a.txt'))
    expect(settings.content).toBe('hello')
    expect(editor.uploadNotice).toBe('uploaded')
    expect(deps.resetPlaybackSession).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(4000)
    expect(editor.uploadNotice).toBeNull()
  })

  it('rejects oversized files without touching content', async () => {
    const { editor, settings } = createEditor()
    editor.markBaseline()
    await editor.importFile(new File(['a'.repeat(MAX_UPLOAD_BYTES + 1)], 'big.txt'))
    expect(settings.content).toBe('')
    expect(editor.uploadNotice).toBe('too-large')
  })

  it('reports unreadable files', async () => {
    const { editor } = createEditor()
    const file = new File(['x'], 'x.txt')
    ;(file as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = () => Promise.reject(new Error('boom'))
    await editor.importFile(file)
    expect(editor.uploadNotice).toBe('read-failed')
  })

  it('opens the picker immediately when the buffer is clean', () => {
    const { editor, deps } = createEditor()
    editor.markBaseline()
    editor.requestUpload()
    expect(deps.openFilePicker).toHaveBeenCalledOnce()
    expect(editor.discardDialogOpen).toBe(false)
  })

  it('confirms discarding dirty edits before opening the picker', () => {
    const { editor, settings, deps } = createEditor()
    editor.markBaseline()
    settings.content = 'edited'
    editor.requestUpload()
    expect(deps.openFilePicker).not.toHaveBeenCalled()
    expect(editor.discardDialogOpen).toBe(true)
    editor.confirmDiscard()
    expect(deps.openFilePicker).toHaveBeenCalledOnce()
    expect(editor.discardDialogOpen).toBe(false)
  })

  it('keeps the upload discard kind distinct from new-document', () => {
    const { editor, settings, deps } = createEditor()
    editor.markBaseline()
    settings.content = 'edited'
    editor.requestUpload()
    editor.cancelDiscard()
    editor.requestNewDocument()
    editor.confirmDiscard()
    expect(settings.content).toBe('')
    expect(deps.resetPlaybackSession).toHaveBeenCalledOnce()
  })

  it('resets playback session when opening another document', () => {
    const documents = {
      findById: vi.fn(() => ({ id: 'doc-2', content: 'Loaded content' })),
    } as unknown as DocumentsHandle
    const { editor, settings, deps } = createEditor({ documents })

    editor.requestOpenDocument('doc-2')

    expect(settings.content).toBe('Loaded content')
    expect(deps.resetPlaybackSession).toHaveBeenCalledOnce()
  })

  it('imports a dropped file immediately when the buffer is clean', async () => {
    const { editor, settings, deps } = createEditor()
    editor.markBaseline()
    await editor.requestUploadFile(new File(['dropped'], 'd.txt'))
    expect(settings.content).toBe('dropped')
    expect(editor.uploadNotice).toBe('uploaded')
    expect(deps.openFilePicker).not.toHaveBeenCalled()
  })

  it('confirms discarding dirty edits before importing a dropped file', async () => {
    const { editor, settings, deps } = createEditor()
    editor.markBaseline()
    settings.content = 'edited'
    editor.requestUploadFile(new File(['dropped'], 'd.txt'))
    expect(deps.openFilePicker).not.toHaveBeenCalled()
    expect(settings.content).toBe('edited')
    editor.confirmDiscard()
    await vi.waitFor(() => {
      expect(settings.content).toBe('dropped')
    })
    expect(editor.uploadNotice).toBe('uploaded')
    expect(deps.openFilePicker).not.toHaveBeenCalled()
  })

  it('cancelling clears the pending dropped file so confirm falls back to the picker', () => {
    const { editor, settings, deps } = createEditor()
    editor.markBaseline()
    settings.content = 'edited'
    editor.requestUploadFile(new File(['dropped'], 'd.txt'))
    editor.cancelDiscard()
    editor.requestUpload()
    expect(editor.discardDialogOpen).toBe(true)
    editor.confirmDiscard()
    expect(settings.content).toBe('edited')
    expect(deps.openFilePicker).toHaveBeenCalledOnce()
  })
})

describe('useDocumentEditor save flow', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('exposes a fallback draft name for a new document', () => {
    const documents = {
      documents: [],
    } as unknown as DocumentsHandle
    const { editor } = createEditor({ documents })

    expect(editor.currentDocId).toBeNull()
    expect(editor.currentDocName).toBe('Untitled')
  })

  it('uses the next available untitled name for drafts', () => {
    const documents = {
      documents: [
        { id: '1', name: 'Untitled', content: '', updatedAt: 1 },
        { id: '2', name: 'Untitled 1', content: '', updatedAt: 2 },
      ],
    } as unknown as DocumentsHandle
    const { editor } = createEditor({ documents })

    expect(editor.currentDocName).toBe('Untitled 2')
  })

  it('lets draft documents rename inline before saving', () => {
    const documents = {
      documents: [],
    } as unknown as DocumentsHandle
    const { editor } = createEditor({ documents })

    expect(editor.renameDocument('Scratch')).toBe(true)
    expect(editor.currentDocName).toBe('Scratch')
  })

  it('saves a draft immediately using its inline name', () => {
    const savedDocument = { id: 'doc-1', name: 'Scratch', content: 'Draft body', updatedAt: 10 }
    const save = vi.fn((name: string, content: string) => ({ ...savedDocument, name, content }))
    const documents = {
      documents: [],
      findByName: vi.fn(() => undefined),
      findById: vi.fn((id: string) => (id === savedDocument.id ? savedDocument : undefined)),
      save,
    } as unknown as DocumentsHandle
    const { editor, settings } = createEditor({ documents })

    settings.content = 'Draft body'
    editor.renameDocument('Scratch')
    editor.saveDocument()

    expect(save).toHaveBeenCalledWith('Scratch', 'Draft body')
    expect(editor.currentDocId).toBe('doc-1')
    expect(editor.currentDocName).toBe('Scratch')
    expect(editor.overwriteConfirmOpen).toBe(false)
  })

  it('opens overwrite confirmation when a draft name already exists', () => {
    const existing = { id: 'doc-existing', name: 'Scratch', content: 'old', updatedAt: 1 }
    const save = vi.fn((name: string, content: string) => ({ id: existing.id, name, content, updatedAt: 2 }))
    const documents = {
      documents: [existing],
      findByName: vi.fn((name: string) => (name === 'Scratch' ? existing : undefined)),
      save,
    } as unknown as DocumentsHandle
    const { editor, settings } = createEditor({ documents })

    settings.content = 'Draft body'
    editor.renameDocument('Scratch')
    editor.saveDocument()

    expect(editor.overwriteConfirmOpen).toBe(true)
    expect(save).not.toHaveBeenCalled()

    editor.applyOverwrite()

    expect(save).toHaveBeenCalledWith('Scratch', 'Draft body')
    expect(editor.overwriteConfirmOpen).toBe(false)
    expect(editor.currentDocId).toBe(existing.id)
  })
})

describe('useDocumentEditor server push', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  function openCleanDocument(options: { synced: boolean; syncEnabled: boolean }) {
    const stored = { id: 'local-1', name: 'Local', content: 'body', updatedAt: 1 }
    const documents = {
      documents: [stored],
      isSyncEnabled: options.syncEnabled,
      isSynced: vi.fn(() => options.synced),
      findByName: vi.fn(() => stored),
      findById: vi.fn((id: string) => (id === stored.id ? stored : undefined)),
      save: vi.fn((name: string, content: string) => ({ ...stored, name, content })),
    } as unknown as DocumentsHandle
    const { editor, settings } = createEditor({ documents })
    settings.content = 'body'
    editor.loadDocument('local-1')
    return { editor, documents }
  }

  it('enables Save for a clean browser-only doc while sync is on', () => {
    const { editor } = openCleanDocument({ synced: false, syncEnabled: true })
    expect(editor.isDirty).toBe(false)
    expect(editor.saveDisabled).toBe(false)
  })

  it('keeps Save disabled for a clean doc already on the server', () => {
    const { editor } = openCleanDocument({ synced: true, syncEnabled: true })
    expect(editor.isDirty).toBe(false)
    expect(editor.saveDisabled).toBe(true)
  })

  it('keeps Save disabled for a clean local doc while logged out', () => {
    const { editor } = openCleanDocument({ synced: false, syncEnabled: false })
    expect(editor.isDirty).toBe(false)
    expect(editor.saveDisabled).toBe(true)
  })

  it('pushes the unchanged doc to the server on Save', () => {
    const { editor, documents } = openCleanDocument({ synced: false, syncEnabled: true })
    editor.saveDocument()
    expect(documents.save).toHaveBeenCalledWith('Local', 'body')
    expect(editor.overwriteConfirmOpen).toBe(false)
  })
})
