import type { SettingsHandle } from './use-settings.svelte'
import type { DocumentsHandle } from './use-documents.svelte'
import { readTextFile } from './upload-text'

export type DiscardKind = 'new' | 'open' | 'delete' | 'clone' | 'upload'

export type UploadNotice = 'uploaded' | 'too-large' | 'read-failed' | 'binary'

const UPLOAD_NOTICE_MS = 4000

function createDraftCacheId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `draft-${crypto.randomUUID()}`
  }
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

interface DocumentEditorDeps {
  settings: SettingsHandle
  documents: DocumentsHandle
  resetPlaybackSession: () => void
  closeDrawer: () => void
  focusEditor: () => void
  openFilePicker: () => void
}

export function useDocumentEditor(deps: DocumentEditorDeps) {
  const { settings, documents } = deps

  let currentDocId = $state<string | null>(null)
  let draftCacheId = $state(createDraftCacheId())
  let baselineContent = $state<string | null>(null)

  let saveDialogOpen = $state(false)
  let saveName = $state('')
  let saveInitialName = $state('')
  let showNameError = $state(false)
  let overwriteConfirmOpen = $state(false)

  let discardDialogOpen = $state(false)
  let pendingDocumentId = $state<string | null>(null)
  let pendingDiscardKind = $state<DiscardKind>('open')
  let pendingUploadFile = $state<File | null>(null)

  let deleteDialogOpen = $state(false)
  let deleteTargetId = $state<string | null>(null)

  type CopyFeedback = 'idle' | 'copied' | 'failed'
  let copyFeedback = $state<CopyFeedback>('idle')
  let copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null

  let uploadNotice = $state<UploadNotice | null>(null)
  let uploadNoticeTimer: ReturnType<typeof setTimeout> | null = null

  const isDirty = $derived(baselineContent !== null && settings.content !== baselineContent)
  // Nothing to persist: the editor is empty, or a document is loaded in its
  // saved state. An unnamed buffer always counts as unsaved work.
  const saveDisabled = $derived(!settings.canPlay || (currentDocId !== null && !isDirty))
  const saveDirty = $derived(saveName !== saveInitialName)
  const currentDocName = $derived(currentDocId ? (documents.findById(currentDocId)?.name ?? '') : '')
  const deleteTargetName = $derived(deleteTargetId ? (documents.findById(deleteTargetId)?.name ?? '') : '')

  function resetDraftCacheId() {
    draftCacheId = createDraftCacheId()
  }

  function markBaseline() {
    baselineContent = settings.content
  }

  function requestOpenDocument(id: string) {
    if (isDirty) {
      pendingDiscardKind = 'open'
      pendingDocumentId = id
      discardDialogOpen = true
      return
    }
    loadDocument(id)
  }

  function loadDocument(id: string) {
    const target = documents.findById(id)
    if (!target) {
      return
    }
    deps.resetPlaybackSession()
    resetDraftCacheId()
    settings.content = target.content
    currentDocId = target.id
    baselineContent = target.content
    deps.closeDrawer()
    deps.focusEditor()
  }

  function handleRenameDocument(name: string): boolean {
    if (!currentDocId) {
      return false
    }
    return documents.rename(currentDocId, name)
  }

  function requestCloneDocument() {
    if (currentDocId && isDirty) {
      pendingDiscardKind = 'clone'
      pendingDocumentId = currentDocId
      discardDialogOpen = true
      return
    }
    cloneCurrentDocument()
  }

  function cloneCurrentDocument() {
    const current = currentDocId ? documents.findById(currentDocId) : undefined
    if (!current) {
      return
    }
    // Detach into a new unsaved document carrying the same content; nothing
    // is persisted until the user saves it under a name.
    currentDocId = null
    resetDraftCacheId()
    baselineContent = settings.content
    deps.focusEditor()
  }

  function requestDeleteDocument(id: string) {
    if (id === currentDocId && isDirty) {
      pendingDiscardKind = 'delete'
      pendingDocumentId = id
      discardDialogOpen = true
      return
    }
    deleteTargetId = id
    deleteDialogOpen = true
  }

  function handleConfirmDelete() {
    const id = deleteTargetId
    deleteDialogOpen = false
    deleteTargetId = null
    if (!id) {
      return
    }
    if (documents.remove(id) && id === currentDocId) {
      currentDocId = null
      resetDraftCacheId()
    }
  }

  function handleCancelDelete() {
    deleteDialogOpen = false
    deleteTargetId = null
  }

  function requestNewDocument() {
    if (isDirty) {
      pendingDiscardKind = 'new'
      pendingDocumentId = null
      discardDialogOpen = true
      return
    }
    createNewDocument()
  }

  function createNewDocument() {
    deps.resetPlaybackSession()
    settings.content = ''
    currentDocId = null
    resetDraftCacheId()
    baselineContent = ''
    deps.closeDrawer()
    deps.focusEditor()
  }

  function resetEditor() {
    const current = currentDocId ? documents.findById(currentDocId) : undefined
    if (current) {
      loadDocument(current.id)
      return
    }
    deps.resetPlaybackSession()
    settings.content = ''
    resetDraftCacheId()
    baselineContent = ''
    deps.focusEditor()
  }

  async function copyEditorContent() {
    try {
      await navigator.clipboard.writeText(settings.content)
      copyFeedback = 'copied'
    } catch {
      copyFeedback = 'failed'
    }
    if (copyFeedbackTimer) {
      clearTimeout(copyFeedbackTimer)
    }
    copyFeedbackTimer = setTimeout(() => (copyFeedback = 'idle'), 1500)
  }

  function showUploadNotice(kind: UploadNotice) {
    if (uploadNoticeTimer) {
      clearTimeout(uploadNoticeTimer)
    }
    uploadNotice = kind
    uploadNoticeTimer = setTimeout(() => (uploadNotice = null), UPLOAD_NOTICE_MS)
  }

  function requestUpload() {
    pendingUploadFile = null
    if (isDirty) {
      pendingDiscardKind = 'upload'
      pendingDocumentId = null
      discardDialogOpen = true
      return
    }
    deps.openFilePicker()
  }

  function requestUploadFile(file: File): Promise<void> | undefined {
    if (isDirty) {
      pendingDiscardKind = 'upload'
      pendingDocumentId = null
      pendingUploadFile = file
      discardDialogOpen = true
      return
    }
    return importFile(file)
  }

  async function importFile(file: File) {
    const result = await readTextFile(file)
    if (!result.ok) {
      showUploadNotice(result.reason)
      return
    }
    // Replacing the buffer invalidates any running playback session.
    deps.resetPlaybackSession()
    settings.content = result.text
    showUploadNotice('uploaded')
  }

  function openSaveDialog() {
    if (saveDisabled) {
      return
    }
    const current = currentDocId ? documents.findById(currentDocId) : undefined
    saveName = current?.name ?? ''
    saveInitialName = saveName
    showNameError = false
    saveDialogOpen = true
  }

  function resetSaveDraft() {
    saveName = saveInitialName
    showNameError = false
  }

  function cancelSave() {
    saveDialogOpen = false
    overwriteConfirmOpen = false
  }

  // Dismissing only the stacked replace-confirm returns to the save form;
  // the base dialog stays open.
  function cancelOverwrite() {
    overwriteConfirmOpen = false
  }

  function confirmSave() {
    const name = saveName.trim()
    if (!name) {
      showNameError = true
      return
    }
    // Saving under a name owned by a different document replaces that
    // document; require an explicit confirmation before destroying it.
    const existing = documents.findByName(name)
    if (existing && existing.id !== currentDocId) {
      overwriteConfirmOpen = true
      return
    }
    applySave(name)
  }

  function applyOverwrite() {
    applySave(saveName.trim())
  }

  function applySave(name: string) {
    const saved = documents.save(name, settings.content)
    currentDocId = saved.id
    baselineContent = saved.content
    saveDialogOpen = false
    overwriteConfirmOpen = false
  }

  function handleConfirmDiscard() {
    const id = pendingDocumentId
    const kind = pendingDiscardKind
    discardDialogOpen = false
    pendingDocumentId = null
    pendingDiscardKind = 'open'
    if (kind === 'open') {
      if (id) {
        loadDocument(id)
      }
    } else if (kind === 'delete') {
      if (id) {
        deleteTargetId = id
        deleteDialogOpen = true
      }
    } else if (kind === 'clone') {
      const source = id ? documents.findById(id) : undefined
      if (source) {
        // Confirmed discard: drop the unsaved edits so the detached copy
        // carries only the source document's saved content.
        deps.resetPlaybackSession()
        settings.content = source.content
        cloneCurrentDocument()
      }
    } else if (kind === 'upload') {
      const file = pendingUploadFile
      pendingUploadFile = null
      if (file) {
        void importFile(file)
      } else {
        deps.openFilePicker()
      }
    } else {
      createNewDocument()
    }
  }

  function handleCancelDiscard() {
    discardDialogOpen = false
    pendingDocumentId = null
    pendingDiscardKind = 'open'
    pendingUploadFile = null
  }

  return {
    get currentDocId() {
      return currentDocId
    },
    get cacheScopeId() {
      return currentDocId ?? draftCacheId
    },
    get isDirty() {
      return isDirty
    },
    get saveDisabled() {
      return saveDisabled
    },
    get currentDocName() {
      return currentDocName
    },
    get saveDialogOpen() {
      return saveDialogOpen
    },
    get saveDirty() {
      return saveDirty
    },
    get saveName() {
      return saveName
    },
    set saveName(value) {
      saveName = value
    },
    get showNameError() {
      return showNameError
    },
    set showNameError(value) {
      showNameError = value
    },
    get overwriteConfirmOpen() {
      return overwriteConfirmOpen
    },
    get discardDialogOpen() {
      return discardDialogOpen
    },
    get deleteDialogOpen() {
      return deleteDialogOpen
    },
    get deleteTargetName() {
      return deleteTargetName
    },
    get copyFeedback() {
      return copyFeedback
    },
    get uploadNotice() {
      return uploadNotice
    },
    markBaseline,
    requestOpenDocument,
    requestDeleteDocument,
    requestNewDocument,
    confirmDiscard: handleConfirmDiscard,
    cancelDiscard: handleCancelDiscard,
    confirmDelete: handleConfirmDelete,
    cancelDelete: handleCancelDelete,
    loadDocument,
    renameDocument: handleRenameDocument,
    requestCloneDocument,
    requestUpload,
    requestUploadFile,
    importFile,
    resetEditor,
    copyEditorContent,
    openSaveDialog,
    resetSaveDraft,
    cancelSave,
    cancelOverwrite,
    confirmSave,
    applyOverwrite,
  }
}

export type DocumentEditorHandle = ReturnType<typeof useDocumentEditor>
