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
    get content(): string {
      return content
    },
    set content(value: string) {
      content = value
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
    file.text = () => Promise.reject(new Error('boom'))
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
