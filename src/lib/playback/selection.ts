import { hasNonEmptySelection, trimmedContentRange } from './selection-scope'
import type { TtsSegment } from '../tts/segment'
import {
  highlightBoundaries,
  locateBoundaryStartWithinOrBefore,
  locateSegmentStartByCharOffset,
} from './boundaries'
import type { SegmentMeta } from './types'

export interface SessionDeps {
  getSession: () => { segments: TtsSegment[]; sourceContent: string; selectionScoped: boolean }
  getSegmentMetaMap: () => Record<number, SegmentMeta>
  ensureSegments: (content: string) => TtsSegment[]
  fullSegmentsFor: (content: string) => TtsSegment[]
  primeSession: (segments: TtsSegment[], offset: number, range: { from: number; to: number } | null) => void
  refreshSessionFromCache: () => void
  clearSegments: () => void
  resetSession: () => void
  setResumePosition: (index: number, at: number, applySelection: boolean) => void
  warmSelectionScope: (range: { from: number; to: number }) => boolean
}

export interface PlaybackDeps {
  getIsPlaying: () => boolean
  isSuppressed: () => boolean
  getPlaybackEnded: () => boolean
  setPlaybackEnded: (v: boolean) => void
  stopPlayback: () => void
  runPlayback: (segments: TtsSegment[], offset: number, index: number, at: number) => Promise<void>
  locateCaretBoundaryAtOrBefore: (boundaries: import('../tts/segment').TtsBoundary[], base: number, offset: number) => number
}

export interface EditorDeps {
  getEditor: () => { getCaretPosition?: () => number | null; getSelectionRange?: () => { from: number; to: number } | null; clearPlaybackHighlight?: () => void } | null
  getContent: () => string
}

export interface SelectionSyncDeps {
  session: SessionDeps
  playback: PlaybackDeps
  editor: EditorDeps
}

export function createSelectionSync(deps: SelectionSyncDeps) {
  let pendingSelectionSeekTimer: ReturnType<typeof setTimeout> | null = null
  let pendingSelectionRange: { from: number; to: number } | null = null
  let pendingCaretOffset: number | null = null
  let pendingSelectionGeneration = 0

  function invalidatePendingSeek() {
    pendingSelectionGeneration += 1
    if (pendingSelectionSeekTimer) {
      clearTimeout(pendingSelectionSeekTimer)
      pendingSelectionSeekTimer = null
      pendingSelectionRange = null
      pendingCaretOffset = null
    }
  }

  async function seekToSelectionRange(range: { from: number; to: number }) {
    const session = deps.session.getSession()
    if (session.segments.length === 0) return
    if (session.selectionScoped) return
    const start = locateSegmentStartByCharOffset(session.segments, range.from)
    const meta = deps.session.getSegmentMetaMap()[start.index]
    const boundaries = highlightBoundaries(meta)
    const absoluteBase = session.segments[start.index]?.indexStart ?? 0
    let targetAt = 0
    if (boundaries.length > 0) {
      targetAt = locateBoundaryStartWithinOrBefore(boundaries, absoluteBase, range)
    }
    deps.playback.stopPlayback()
    deps.playback.setPlaybackEnded(false)
    deps.session.setResumePosition(start.index, targetAt, true)
    await deps.playback.runPlayback(session.segments, 0, start.index, targetAt)
  }

  async function seekToCaretOffset(caretOffset: number) {
    const session = deps.session.getSession()
    if (session.segments.length === 0) return
    const start = locateSegmentStartByCharOffset(session.segments, caretOffset)
    const meta = deps.session.getSegmentMetaMap()[start.index]
    const boundaries = highlightBoundaries(meta)
    const absoluteBase = session.segments[start.index]?.indexStart ?? 0
    let targetAt = 0
    if (boundaries.length > 0) {
      targetAt = deps.playback.locateCaretBoundaryAtOrBefore(boundaries, absoluteBase, caretOffset)
    }
    deps.playback.stopPlayback()
    deps.playback.setPlaybackEnded(false)
    deps.session.setResumePosition(start.index, targetAt, true)
    await deps.playback.runPlayback(session.segments, 0, start.index, targetAt)
  }

  function scheduleSeekFromSelection(range: { from: number; to: number }) {
    const session = deps.session.getSession()
    if (session.selectionScoped) return
    pendingSelectionRange = range
    pendingCaretOffset = null
    pendingSelectionGeneration += 1
    const generation = pendingSelectionGeneration
    if (pendingSelectionSeekTimer) clearTimeout(pendingSelectionSeekTimer)
    pendingSelectionSeekTimer = setTimeout(() => {
      pendingSelectionSeekTimer = null
      if (generation !== pendingSelectionGeneration) return
      const pending = pendingSelectionRange
      pendingSelectionRange = null
      if (!pending || !deps.playback.getIsPlaying() || deps.playback.isSuppressed()) return
      void seekToSelectionRange(pending)
    }, 60)
  }

  function scheduleSeekFromCaret(caretOffset: number) {
    pendingCaretOffset = caretOffset
    pendingSelectionRange = null
    pendingSelectionGeneration += 1
    const generation = pendingSelectionGeneration
    if (pendingSelectionSeekTimer) clearTimeout(pendingSelectionSeekTimer)
    pendingSelectionSeekTimer = setTimeout(() => {
      pendingSelectionSeekTimer = null
      if (generation !== pendingSelectionGeneration) return
      const pending = pendingCaretOffset
      pendingCaretOffset = null
      if (pending == null || !deps.playback.getIsPlaying() || deps.playback.isSuppressed()) return
      void seekToCaretOffset(pending)
    }, 60)
  }

  function syncSelectionStart(range: { from: number; to: number } | null) {
    if (deps.playback.isSuppressed()) return
    const session = deps.session.getSession()
    if (deps.playback.getIsPlaying()) {
      if (range != null) {
        if (session.segments.length === 0) return
        if (session.selectionScoped) return
        scheduleSeekFromSelection(range)
        return
      }
      const caret = deps.editor.getEditor()?.getCaretPosition?.() ?? null
      if (caret == null || session.segments.length === 0) return
      scheduleSeekFromCaret(caret)
      return
    }
    const content = deps.editor.getContent()
    if (!content) {
      deps.session.resetSession()
      return
    }
    function handleCaretSync(caretOffset: number, resumeRange: { from: number; to: number } | null, contentStr: string) {
      const segments = deps.session.ensureSegments(contentStr)
      if (segments.length === 0) {
        deps.session.resetSession()
        return
      }
      if (session.sourceContent !== contentStr) {
        deps.session.clearSegments()
      }
      deps.editor.getEditor()?.clearPlaybackHighlight?.()
      if (session.selectionScoped) {
        const fullSegments = deps.session.fullSegmentsFor(contentStr)
        deps.session.primeSession(fullSegments, 0, resumeRange)
        deps.session.refreshSessionFromCache()
        return
      }
      const start = locateSegmentStartByCharOffset(segments, caretOffset)
      const meta = deps.session.getSegmentMetaMap()[start.index]
      if (!meta) {
        deps.session.primeSession(segments, 0, resumeRange)
        deps.session.refreshSessionFromCache()
        return
      }
      deps.session.primeSession(segments, 0, resumeRange)
      const absoluteBase = segments[start.index]?.indexStart ?? 0
      const boundaries = highlightBoundaries(meta)
      if (boundaries.length === 0) return
      deps.session.setResumePosition(start.index, deps.playback.locateCaretBoundaryAtOrBefore(boundaries, absoluteBase, caretOffset), false)
    }

    if (range && hasNonEmptySelection(range)) {
      const segments = deps.session.ensureSegments(content)
      if (segments.length === 0) {
        deps.session.resetSession()
        return
      }
      if (session.sourceContent !== content) deps.session.clearSegments()
      deps.session.primeSession(segments, 0, range)
      void deps.session.warmSelectionScope(range)
      return
    }
    if (range == null) {
      const caret = deps.editor.getEditor()?.getCaretPosition?.() ?? null
      if (caret == null) {
        if (!content.trim()) deps.session.resetSession()
        return
      }
      handleCaretSync(caret, null, content)
      return
    }
    if (range.from === range.to) {
      handleCaretSync(range.from, range, content)
      return
    }
    syncSelectionStart(null)
  }

  return { syncSelectionStart, scheduleSeekFromSelection, scheduleSeekFromCaret, seekToSelectionRange, seekToCaretOffset, invalidatePendingSeek }
}
