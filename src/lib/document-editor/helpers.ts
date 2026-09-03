import { UI_TEXT } from '../ui-text'
import type { DocumentsHandle } from '../use-documents.svelte'

export type DiscardKind = 'new' | 'open' | 'delete' | 'clone' | 'upload'

export type UploadNotice = 'uploaded' | 'too-large' | 'read-failed' | 'binary'

export interface PendingAction {
  kind: DiscardKind
  id: string | null
  file: File | null
}

export function createDraftCacheId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `draft-${crypto.randomUUID()}`
  }
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function nextAvailableDraftName(documents: DocumentsHandle, locale: string): string {
  const baseName = UI_TEXT[locale as keyof typeof UI_TEXT]?.documentNamePlaceholder ?? 'Untitled'
  const existingNames = new Set(documents.documents.map(document => document.name))
  let fallbackName = baseName
  if (existingNames.has(fallbackName)) {
    let index = 1
    while (existingNames.has(`${baseName} ${index}`)) index += 1
    fallbackName = `${baseName} ${index}`
  }
  return fallbackName
}

export function gateNavigation(input: {
  kind: PendingAction['kind']
  id: string | null
  file: File | null
  isDirty: boolean
  isPlaybackActive: boolean
}): { gate: 'playback' | 'discard' | 'none' } {
  if (input.isPlaybackActive) return { gate: 'playback' }
  if (input.isDirty) return { gate: 'discard' }
  return { gate: 'none' }
}
