import type { SettingsHandle } from './use-settings.svelte'
import type { DocumentsHandle } from './use-documents.svelte'
import { UI_TEXT } from './ui-text'
import { readTextFile } from './upload-text'
import { browser } from '$app/environment'
import {
  createDraftCacheId,
  nextAvailableDraftName as nextAvailableDraftNameImpl,
  type PendingAction,
  type UploadNotice,
  type DiscardKind,
} from './document-editor/helpers'
import { parseDocId, pushDocHistory, replaceDocHistory } from './document-history'

export type { DiscardKind, UploadNotice, PendingAction } from './document-editor/helpers'

const UPLOAD_NOTICE_MS = 4000

interface DocumentEditorDeps {
  settings: SettingsHandle
  documents: DocumentsHandle
  resetPlaybackSession: () => void
  closeDrawer: () => void
  focusEditor: () => void
  openFilePicker: () => void
  isPlaybackActive?: () => boolean
}

export function useDocumentEditor(deps: DocumentEditorDeps) {
  const { settings, documents } = deps

  let currentDocId = $state<string | null>(null)
  let draftCacheId = $state(createDraftCacheId())
  let baselineContent = $state<string | null>(null)

  let draftName = $state('')
  let pendingSaveName = $state('')
  let overwriteConfirmOpen = $state(false)

  let discardDialogOpen = $state(false)
  let pendingAction = $state<PendingAction | null>(null)

  let deleteDialogOpen = $state(false)
  let deleteTargetId = $state<string | null>(null)

  let playbackConfirmOpen = $state(false)

  type CopyFeedback = 'idle' | 'copied' | 'failed'
  let copyFeedback = $state<CopyFeedback>('idle')
  let copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null

  let uploadNotice = $state<UploadNotice | null>(null)
  let uploadNoticeTimer: ReturnType<typeof setTimeout> | null = null

  const isDirty = $derived(baselineContent !== null && settings.content !== baselineContent)
  // Nothing to persist: the editor is empty, or a document is loaded in its
  // saved state. Draft buffers stay saveable through their inline title.
  const saveDisabled = $derived(!settings.canPlay || (currentDocId !== null && !isDirty))
  const currentDocName = $derived(currentDocId ? (documents.findById(currentDocId)?.name ?? '') : draftName.trim() || nextAvailableDraftName())
  const deleteTargetName = $derived(deleteTargetId ? (documents.findById(deleteTargetId)?.name ?? '') : '')

  function nextAvailableDraftName(): string {
    return nextAvailableDraftNameImpl(documents, settings.locale)
  }

  function resetDraftCacheId() {
    draftCacheId = createDraftCacheId()
  }

  function markBaseline() {
    baselineContent = settings.content
  }

  function gateNavigation(
    kind: DiscardKind,
    id: string | null,
    file: File | null,
    needsDiscard: boolean,
  ): boolean {
    const action: PendingAction = { kind, id, file }
    if (deps.isPlaybackActive?.()) {
      pendingAction = action
      playbackConfirmOpen = true
      return true
    }
    if (needsDiscard) {
      pendingAction = action
      discardDialogOpen = true
      return true
    }
    return false
  }

  function requestOpenDocument(id: string) {
    if (gateNavigation('open', id, null, isDirty)) return
    openDocument(id)
  }

  // Shared "navigate to a document" step used by both the drawer request path
  // and the discard-confirmed executor so neither forgets the history push.
  function openDocument(id: string) {
    loadDocument(id)
    pushDocHistory(id)
  }

  // Loads a document into the editor without touching history or the drawer;
  // shared by both user-initiated and history-driven navigation.
  function applyDocState(docId: string | null) {
    deps.resetPlaybackSession()
    resetDraftCacheId()
    if (docId) {
      const target = documents.findById(docId)
      if (!target) {
        settings.content = ''
        currentDocId = null
        draftName = ''
        baselineContent = ''
        return
      }
      settings.content = target.content
      currentDocId = target.id
      draftName = ''
      baselineContent = target.content
    } else {
      settings.content = ''
      currentDocId = null
      draftName = ''
      baselineContent = ''
    }
  }

  function loadDocument(id: string) {
    const target = documents.findById(id)
    if (!target) {
      return
    }
    applyDocState(id)
    deps.closeDrawer()
    deps.focusEditor()
  }

  // Syncs the editor to the document referenced by the current URL: used on
  // initial load (deep link / reload) and on every `popstate` (Back/Forward),
  // so it must not push a new history entry. Unsaved-changes and playback
  // guards apply; when gated, the URL is reverted so the pending entry still
  // points at the current document until the user confirms.
  function handleHistoryNavigation() {
    if (!browser) {
      return
    }
    const targetId = parseDocId()
    if (targetId === currentDocId) {
      return
    }
    const kind: DiscardKind = targetId ? 'open' : 'new'
    if (gateNavigation(kind, targetId, null, isDirty)) {
      replaceDocHistory(currentDocId)
      return
    }
    if (targetId) {
      const target = documents.findById(targetId)
      if (target) {
        applyDocState(targetId)
        return
      }
    }
    applyDocState(null)
  }

  function handleRenameDocument(name: string): boolean {
    if (!currentDocId) {
      draftName = name.trim()
      return true
    }
    return documents.rename(currentDocId, name)
  }

  function requestCloneDocument() {
    if (gateNavigation('clone', currentDocId, null, !!(currentDocId && isDirty))) return
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
    draftName = ''
    resetDraftCacheId()
    baselineContent = settings.content
    deps.focusEditor()
    pushDocHistory(null)
  }

  function requestDeleteDocument(id: string) {
    const isCurrent = id === currentDocId
    if (isCurrent && gateNavigation('delete', id, null, isDirty)) {
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
      draftName = ''
      resetDraftCacheId()
      pushDocHistory(null)
    }
  }

  function handleCancelDelete() {
    deleteDialogOpen = false
    deleteTargetId = null
  }

  function requestNewDocument() {
    if (gateNavigation('new', null, null, isDirty)) return
    createNewDocument()
  }

  function createNewDocument() {
    applyDocState(null)
    deps.closeDrawer()
    deps.focusEditor()
    pushDocHistory(null)
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
    if (gateNavigation('upload', null, null, isDirty)) return
    pendingAction = null
    deps.openFilePicker()
  }

  function requestUploadFile(file: File): Promise<void> | undefined {
    if (gateNavigation('upload', null, file, isDirty)) return
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

  function saveDocument() {
    if (saveDisabled) {
      return
    }
    const name = currentDocId ? currentDocName : draftName.trim() || nextAvailableDraftName()
    // Saving under a name owned by a different document replaces that
    // document; require an explicit confirmation before destroying it.
    const existing = documents.findByName(name)
    if (existing && existing.id !== currentDocId) {
      pendingSaveName = name
      overwriteConfirmOpen = true
      return
    }
    applySave(name)
  }

  // Dismissing only the stacked replace-confirm returns to the save form;
  // the inline draft title stays editable behind it.
  function cancelOverwrite() {
    overwriteConfirmOpen = false
    pendingSaveName = ''
  }

  function applyOverwrite() {
    applySave(pendingSaveName)
  }

  function applySave(name: string) {
    const saved = documents.save(name, settings.content)
    currentDocId = saved.id
    baselineContent = saved.content
    draftName = ''
    pendingSaveName = ''
    overwriteConfirmOpen = false
    pushDocHistory(saved.id)
  }

  function clearPendingState() {
    pendingAction = null
  }

  function executePendingAction(action: PendingAction) {
    const { kind, id, file } = action
    if (kind === 'open') {
      if (id) openDocument(id)
    } else if (kind === 'delete') {
      if (id) {
        deleteTargetId = id
        deleteDialogOpen = true
      }
    } else if (kind === 'clone') {
      cloneCurrentDocument()
    } else if (kind === 'upload') {
      if (file) void importFile(file)
      else deps.openFilePicker()
    } else {
      createNewDocument()
    }
  }

  function handleConfirmDiscard() {
    const action = pendingAction
    discardDialogOpen = false
    clearPendingState()
    if (!action) {
      return
    }
    if (action.kind === 'clone') {
      const source = action.id ? documents.findById(action.id) : undefined
      if (source) {
        // Confirmed discard: drop the unsaved edits so the detached copy
        // carries only the source document's saved content.
        deps.resetPlaybackSession()
        settings.content = source.content
        cloneCurrentDocument()
      }
      return
    }
    executePendingAction(action)
  }

  function handleCancelDiscard() {
    discardDialogOpen = false
    clearPendingState()
  }

  function handleConfirmPlayback() {
    const action = pendingAction
    playbackConfirmOpen = false
    deps.resetPlaybackSession()
    if (!action) {
      clearPendingState()
      return
    }
    const { kind, id, file } = action
    // After stopping playback, check if unsaved changes still require confirmation.
    const needsDiscard =
      (kind === 'open' && isDirty) ||
      (kind === 'new' && isDirty) ||
      (kind === 'delete' && isDirty && id === currentDocId) ||
      (kind === 'clone' && isDirty && !!id) ||
      (kind === 'upload' && isDirty)
    if (needsDiscard) {
      discardDialogOpen = true
      return
    }
    // No discard needed — execute the pending navigation directly.
    clearPendingState()
    executePendingAction(action)
  }

  function handleCancelPlayback() {
    playbackConfirmOpen = false
    clearPendingState()
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
    get playbackConfirmOpen() {
      return playbackConfirmOpen
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
    handleHistoryNavigation,
    confirmDiscard: handleConfirmDiscard,
    cancelDiscard: handleCancelDiscard,
    confirmDelete: handleConfirmDelete,
    cancelDelete: handleCancelDelete,
    confirmPlayback: handleConfirmPlayback,
    cancelPlayback: handleCancelPlayback,
    loadDocument,
    renameDocument: handleRenameDocument,
    requestCloneDocument,
    requestUpload,
    requestUploadFile,
    importFile,
    resetEditor,
    copyEditorContent,
    saveDocument,
    cancelOverwrite,
    applyOverwrite,
  }
}

export type DocumentEditorHandle = ReturnType<typeof useDocumentEditor>
