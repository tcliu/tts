import {
  activeHighlightRange,
  REFERENCE_LANGUAGES,
  SPEEDS,
  splitHighlightRanges,
  splitTtsSegments,
  toWrittenLang,
  type HighlightRange,
  type TtsBoundary,
  type TtsVoice,
} from './tts-reference'
import {
  getCachedSynthesis,
  isSynthesisCacheHydrated,
  onSynthesisCacheHydrated,
  peekCachedSynthesis,
} from './tts-client'
import { UI_TEXT, segmentLanguageName, type UiLocale } from './ui-text'
import type { SettingsHandle } from './use-settings.svelte'
import {
  activeBoundaryAt,
  formatClock,
  highlightBoundaries,
  locateBoundaryStartWithinOrBefore,
  locateSegmentStartByCharOffset,
  readAudioDuration,
  RESUME_EPSILON,
  trimWhitespaceRange,
} from './playback-helpers'

export { formatClock, RESUME_EPSILON }

export type CodeEditorHandle = {
  getSelectionText: () => string
  getSelectionRange: () => { from: number; to: number } | null
  getCaretPosition?: () => number | null
  setSelection: (from: number, to: number) => boolean
  clearSelection: () => void
  focus: () => void
  hasFocus: () => boolean
}

export interface SegmentMeta {
  index: number
  lang: string
  text: string
  ranges: HighlightRange[]
  boundaries: TtsBoundary[]
  wordBoundaries?: TtsBoundary[]
  baseOffset: number
  duration?: number
  spokenStart?: number
  spokenEnd?: number
  rate?: number
}

interface PlaybackController {
  cancelled: boolean
  abort: AbortController
  cancelAudio?: () => void
}

class LocalizedPlaybackError extends Error {}

export interface PlaybackHandle {
  readonly isPlaying: boolean
  readonly hasSession: boolean
  readonly isPlaybackEnded: boolean
  readonly currentSegmentIndex: number
  readonly totalSegments: number
  readonly synthesizedCount: number
  readonly playedDuration: number
  readonly positionSegmentIndex: number
  readonly positionVoiceName: string
  readonly positionVoiceGender: string
  readonly positionVoiceLocale: string
  readonly positionSegmentLang: string
  readonly positionLanguageCode: string
  readonly positionSegmentText: string
  readonly currentSynthesisRate: number
  readonly playbackElapsed: number
  readonly playbackDuration: number
  readonly totalElapsed: number
  readonly totalDuration: number
  readonly statusMessage: string
  readonly metadataAvailable: boolean
  readonly voiceSwitching: boolean
  readonly segments: Record<number, SegmentMeta>
  readonly sessionSource: string
  readonly playbackSpeed: number
  readonly effectiveSpeed: number
  initStatus: () => void
  onLocaleChanged: (locale: UiLocale) => void
  startPlayback: () => Promise<void>
  stopPlayback: () => void
  seekTo: (elapsed: number) => Promise<void>
  playFromSegment: (index: number, charOffset?: number) => Promise<void>
  syncSelectionStart: (range: { from: number; to: number } | null) => void
  warmFromCache: () => void
  primeSession: (
    segments: ReturnType<typeof splitTtsSegments>,
    offset: number,
    selectedRange?: { from: number; to: number } | null,
  ) => void
  recordSegment: (index: number, record: SegmentMeta) => void
  setSegmentDuration: (index: number, duration: number) => void
  setMetadataAvailability: (value: boolean) => void
  clearSegments: () => void
  resetSession: () => void
  resynthesizeSegment: (index: number, voiceEdge: string) => Promise<void>
  overrideSegmentLanguage: (index: number, lang: string) => Promise<void>
  overrideSegmentVoice: (index: number, voiceEdge: string) => Promise<void>
  effectiveVoiceEdge: (segmentLang: string) => string
  setPlaybackSpeed: (speed: number) => void
}

export interface PlaybackDeps {
  settings: SettingsHandle
  getEditor: () => CodeEditorHandle | null
  getCacheScopeId: () => string
  prepareForPlayback: () => void
}

export function usePlayback(deps: PlaybackDeps): PlaybackHandle {
  let isPlaying = $state(false)
  let currentSegmentIndex = $state(0)
  let totalSegments = $state(0)
  let synthesizedCount = $state(0)
  let playedDuration = $state(0)
  let measuredTotal = $state(0)
  let currentSynthesisRate = $state(1)
  let playbackElapsed = $state(0)
  let playbackDuration = $state(0)
  let statusMessage = $state(UI_TEXT[deps.settings.locale].ready)

  let lastStatusReason = $state<'ready' | 'stopped' | 'switching' | 'finished' | 'error'>('ready')
  let playbackEnded = $state(false)
  let currentController: PlaybackController | null = null
  let currentAudio = $state<HTMLAudioElement | null>(null)
  let currentAudioUrl = ''

  let metadataAvailable = $state(false)

  let segmentMetaMap = $state<Record<number, SegmentMeta>>({})
  let sessionSegments: ReturnType<typeof splitTtsSegments> = []
  let sessionOffset = 0
  let sessionSelectedRange: { from: number; to: number } | null = null
  let sessionSourceContent = ''
  let sessionResumeSelection: { from: number; to: number } | null = null
  let applyingResumeSelection = false
  let suppressSelectionCounter = 0
  let pendingSelectionSeekTimer: ReturnType<typeof setTimeout> | null = null
  let pendingSelectionRange: { from: number; to: number } | null = null
  let pendingCaretOffset: number | null = null
  let pendingSelectionGeneration = 0
  let resumeSegmentIndex = 0
  let resumeSegmentTime = 0

  // Per-segment language overrides keyed by session index so a mis-detected
  // segment can be corrected for the active session without mutating the
  // heuristic output. Cleared when the session is reset or re-primed.
  let segmentLangOverrides = $state<Map<number, string>>(new Map())

  // Per-language voice overrides for the active session. Changing the voice
  // model from the playback voice chip records the choice here so the rest of
  // the session plays with it, but the user's persisted default voice setting
  // is never touched. Cleared when the session is reset or re-primed.
  let sessionVoiceSelections = $state<Map<string, string>>(new Map())

  // Per-session playback speed override. The chip defaults to
  // `settings.speed` but adjusting it must not mutate the persisted default.
  let sessionSpeed = $state<number | null>(null)
  const effectiveSpeed = $derived(sessionSpeed ?? deps.settings.speed)
  const playbackSpeed = $derived(effectiveSpeed)

  // True while a mid-playback voice switch has paused playback and is still
  // synthesizing the current segment for the new voice. Gates Play so a
  // second playback loop cannot race the pending resume.
  let voiceSwitching = $state(false)
  // Bumped by every stop/session invalidation; a pending switch resume whose
  // generation no longer matches is abandoned.
  let voiceSwitchGeneration = 0

  function effectiveSegmentLang(index: number): string {
    if (index < 0 || index >= sessionSegments.length) return ''
    return segmentLangOverrides.get(index) ?? sessionSegments[index]?.lang ?? ''
  }

  function resolveEffectiveVoice(segmentLang: string): TtsVoice | undefined {
    const languageCode = toWrittenLang(segmentLang)
    const overrideEdge = sessionVoiceSelections.get(languageCode)
    if (overrideEdge) {
      const voice = REFERENCE_LANGUAGES.find(item => item.code === languageCode)?.voices.find(
        item => item.edge === overrideEdge,
      )
      if (voice) return voice
    }
    return deps.settings.resolveVoiceForSegment(segmentLang)
  }

  // Plain Map (not $state) — only read imperatively in launch/resynthesize/
  // playback loop. Generations are monotonic and intentionally never cleared;
  // stale tasks from prior runs are already guarded by `controller.cancelled`.
  // Bumped when a segment is re-synthesized outside the playback pipeline so
  // a queued task launched earlier can neither record stale meta nor play
  // stale audio.
  let taskGeneration = new Map<number, number>()

  const totalDuration = $derived.by(() => {
    let total = 0
    for (let i = 0; i < sessionSegments.length; i += 1) {
      total += scaledDurationAt(i)
    }
    return total
  })

  const totalElapsed = $derived.by(() => {
    if (sessionSegments.length === 0) return 0
    // Scaled elapsed = scaled completed + scaled current, using real wall time
    const curIdx = currentSegmentIndex > 0 ? currentSegmentIndex - 1 : resumeSegmentIndex
    // When not yet started, currentSegmentIndex===0 and resume at 0, no elapsed
    if (curIdx < 0) return 0
    // If playback has ended, show full duration
    if (playbackEnded) return totalDuration
    let scaled = 0
    for (let i = 0; i < curIdx; i += 1) {
      scaled += scaledDurationAt(i)
    }
    scaled += scaledAtForMedia(curIdx, playbackElapsed)
    // Clamp to duration
    if (scaled > totalDuration) return totalDuration
    if (scaled < 0) return 0
    return scaled
  })

  // Status-strip facts for the segment at the slider position, so lang and
  // voice stay meaningful before, during, and after playback.
  const positionLocation = $derived(locatePlaybackPosition(totalElapsed))
  const positionSegmentIndex = $derived(positionLocation ? positionLocation.index : -1)
  const positionSegmentLang = $derived.by(() => effectiveSegmentLang(positionSegmentIndex))
  const positionVoiceName = $derived.by(() =>
    positionSegmentLang ? (resolveEffectiveVoice(positionSegmentLang)?.name ?? '') : '',
  )
  const positionVoiceGender = $derived.by(() =>
    positionSegmentLang ? (resolveEffectiveVoice(positionSegmentLang)?.gender ?? '') : '',
  )
  const positionVoiceLocale = $derived.by(() => {
    const voice = positionSegmentLang ? resolveEffectiveVoice(positionSegmentLang) : undefined
    return voice ? voice.edge.split('-').slice(0, 2).join('-') : ''
  })
  const positionLanguageCode = $derived(toWrittenLang(positionSegmentLang))
  const positionSegmentText = $derived.by(() => {
    const segment = positionSegmentIndex >= 0 ? sessionSegments[positionSegmentIndex] : undefined
    return segment?.text ?? ''
  })

  $effect(() => {
    if (isPlaying) {
      return
    }
    const strings = UI_TEXT[deps.settings.locale]
    if (lastStatusReason === 'stopped') {
      statusMessage = strings.playbackStopped
      return
    }
    if (lastStatusReason === 'switching') {
      statusMessage = strings.voiceSwitching
      return
    }
    if (lastStatusReason === 'finished') {
      statusMessage = strings.playbackFinished
      return
    }
    if (lastStatusReason === 'ready') {
      statusMessage = strings.ready
    }
  })

  $effect(() => {
    if (isPlaying && currentAudio) {
      const idx = currentSegmentIndex - 1
      const segRate = segmentMetaMap[idx]?.rate ?? effectiveSpeed
      currentAudio.playbackRate = effectiveSpeed / segRate
    }
  })

  // A stop landing at (or in the trailing silence after) the spoken end means
  // the segment finished; treat it as a completed playback, not a pause.
  function finishedSegmentIndexAtStop(): number {
    const audio = currentAudio
    if (!audio) {
      return -1
    }
    const index = Math.max(0, currentSegmentIndex - 1)
    const meta = segmentMetaMap[index]
    if (!meta) {
      return -1
    }
    const segmentDuration = segmentDurationAt(index)
    if (segmentDuration <= 0) {
      return -1
    }
    const audioAt = Math.max(0, audio.currentTime - (meta.spokenStart ?? 0))
    return audioAt >= segmentDuration - RESUME_EPSILON ? index : -1
  }

  function stopPlayback() {
    // Invalidate a pending voice-switch resume: a Stop (or any path that
    // tears playback down) during the switch's synthesis must leave playback
    // stopped instead of restarting it.
    voiceSwitchGeneration += 1
    if (pendingSelectionSeekTimer) {
      clearTimeout(pendingSelectionSeekTimer)
      pendingSelectionSeekTimer = null
      pendingSelectionRange = null
      pendingCaretOffset = null
      pendingSelectionGeneration += 1
    }
    if (playbackEnded) {
      return
    }
    if (!currentController) {
      return
    }
    const finishedIndex = finishedSegmentIndexAtStop()
    rememberResumePosition()
    const controller = currentController
    controller.cancelled = true
    controller.abort.abort()
    controller.cancelAudio?.()
    currentController = null
    isPlaying = false
    currentAudio?.pause()
    currentAudio = null
    if (currentAudioUrl) {
      URL.revokeObjectURL(currentAudioUrl)
      currentAudioUrl = ''
    }
    if (finishedIndex >= 0) {
      measuredTotal += segmentDurationAt(finishedIndex)
      playedDuration = measuredTotal
      playbackElapsed = 0
      lastStatusReason = 'finished'
      playbackEnded = true
      synthesizedCount = finishedIndex + 1
      resumeSegmentIndex = 0
      resumeSegmentTime = 0
      statusMessage = UI_TEXT[deps.settings.locale].playbackFinished
      return
    }
    lastStatusReason = 'stopped'
    playbackEnded = false
    statusMessage = UI_TEXT[deps.settings.locale].playbackStopped
  }

  function segmentDurationAt(index: number): number {
    const meta = segmentMetaMap[index]
    if (!meta) return 0
    if (meta.spokenEnd != null && meta.spokenStart != null) {
      return Math.max(0, meta.spokenEnd - meta.spokenStart)
    }
    return meta.duration ?? 0
  }

  function scaledDurationAt(index: number): number {
    const base = segmentDurationAt(index)
    if (base === 0) return 0
    const meta = segmentMetaMap[index]
    const rate = meta?.rate ?? effectiveSpeed
    const speed = effectiveSpeed || 1
    return (base * rate) / speed
  }

  function scaledAtForMedia(index: number, mediaAt: number): number {
    const meta = segmentMetaMap[index]
    const rate = meta?.rate ?? effectiveSpeed
    const speed = effectiveSpeed || 1
    return (mediaAt * rate) / speed
  }

  function mediaAtForScaled(index: number, scaledAt: number): number {
    const meta = segmentMetaMap[index]
    const rate = meta?.rate ?? effectiveSpeed
    const speed = effectiveSpeed || 1
    return (scaledAt * speed) / rate
  }

  function rememberResumePosition() {
    resumeSegmentIndex = Math.max(0, currentSegmentIndex - 1)
    const audioAt = currentAudio
      ? Math.max(0, currentAudio.currentTime - (segmentMetaMap[resumeSegmentIndex]?.spokenStart ?? 0))
      : playbackElapsed
    const nudgedAt = audioAt > RESUME_EPSILON ? audioAt + RESUME_EPSILON : audioAt
    const segmentDuration = segmentDurationAt(resumeSegmentIndex)
    resumeSegmentTime = segmentDuration > 0 ? Math.min(Math.max(0, nudgedAt), segmentDuration) : Math.max(0, nudgedAt)
    sessionResumeSelection = deps.getEditor()?.getSelectionRange() ?? null
  }

  function withSuppressedSelection<T>(fn: () => T): T {
    suppressSelectionCounter += 1
    try {
      return fn()
    } finally {
      suppressSelectionCounter -= 1
    }
  }

  function isSelectionSyncSuppressed(): boolean {
    return suppressSelectionCounter > 0 || applyingResumeSelection
  }

  // Run an editor mutation as our own positioning echo so the resulting
  // selection event is ignored by syncSelectionStart (prevents a seek from
  // snapping back to the last word or rebuilding the session).
  function applyOwnSelection(fn: () => void): void {
    applyingResumeSelection = true
    suppressSelectionCounter += 1
    try {
      withSuppressedSelection(fn)
    } finally {
      applyingResumeSelection = false
      suppressSelectionCounter -= 1
    }
  }

  function updateSelectionForPosition(index: number, at: number): { from: number; to: number } | null {
    const meta = segmentMetaMap[index]
    const segment = sessionSegments[index]
    if (!segment) return null
    const absoluteBase = sessionOffset + segment.indexStart
    const setWholeSegmentSelection = (): { from: number; to: number } => {
      const trimmed = trimWhitespaceRange(segment.text, 0, segment.text.length)
      const range = { from: absoluteBase + trimmed.start, to: absoluteBase + trimmed.end }
      withSuppressedSelection(() => deps.getEditor()?.setSelection(range.from, range.to))
      return range
    }
    const boundaries = highlightBoundaries(meta, [])
    if (!meta || meta.ranges.length === 0 || boundaries.length === 0) {
      return setWholeSegmentSelection()
    }
    // Word boundaries begin at spokenStart (> 0), so a position at the very
    // start of the segment sits before the first boundary. Clamp to the first
    // word there instead of falling through to the whole-sentence range, which
    // would flash the entire sentence before narrowing to per-word on playback.
    const activeBoundary = at < (boundaries[0]?.at ?? 0) ? boundaries[0] : activeBoundaryAt(boundaries, at)
    if (activeBoundary?.text) {
      const wordStart = activeBoundary.offset
      const wordEnd = wordStart + activeBoundary.text.length
      const trimmed = trimWhitespaceRange(segment.text, wordStart, wordEnd)
      const range = { from: absoluteBase + trimmed.start, to: absoluteBase + trimmed.end }
      withSuppressedSelection(() => deps.getEditor()?.setSelection(range.from, range.to))
      return range
    }
    const range = activeHighlightRange(meta.ranges, boundaries, at)
    if (!range) {
      return setWholeSegmentSelection()
    }
    const trimmed = trimWhitespaceRange(segment.text, range.start, range.end)
    const applied = { from: absoluteBase + trimmed.start, to: absoluteBase + trimmed.end }
    withSuppressedSelection(() => deps.getEditor()?.setSelection(applied.from, applied.to))
    return applied
  }

  function setResumePosition(index: number, at: number, applySelection = true) {
    if (sessionSegments.length === 0) return
    const clampedIndex = Math.max(0, Math.min(index, sessionSegments.length - 1))
    let accumulated = 0
    for (let i = 0; i < clampedIndex; i += 1) {
      accumulated += segmentDurationAt(i)
    }
    const segmentDuration = segmentDurationAt(clampedIndex)
    const clampedAt = segmentDuration > 0 ? Math.min(Math.max(0, at), segmentDuration) : Math.max(0, at)
    resumeSegmentIndex = clampedIndex
    resumeSegmentTime = clampedAt
    currentSegmentIndex = clampedIndex + 1
    totalSegments = sessionSegments.length
    measuredTotal = accumulated
    playedDuration = accumulated
    playbackElapsed = clampedAt
    playbackDuration = segmentDuration
    if (!applySelection) return
    // The selection echo of our own positioning must not re-enter
    // syncSelectionStart, or a seek to the end snaps back to the last word.
    // Record the painted range as the resume selection so the very next
    // Play recognizes the seek-scrolled state instead of rebuilding the
    // session (which drops the dragged position and warmed metadata).
    applyOwnSelection(() => {
      sessionResumeSelection = updateSelectionForPosition(clampedIndex, clampedAt) ?? sessionResumeSelection
    })
  }

  function locateCaretBoundaryAtOrBefore(
    boundaries: TtsBoundary[],
    absoluteBase: number,
    caretOffset: number,
  ): number {
    let candidate: number | null = null
    for (const b of boundaries) {
      const abs = absoluteBase + b.offset
      if (abs <= caretOffset) candidate = b.at
      else break
    }
    return candidate ?? 0
  }

  // Maps a spoken position inside a segment to a segment-relative character
  // offset so it can be re-anchored onto another voice's word boundaries:
  // voices time the same text differently, so a raw elapsed time cannot
  // survive a voice change.
  function charOffsetAtPosition(index: number, at: number): number {
    const meta = segmentMetaMap[index]
    const segment = sessionSegments[index]
    if (!meta || !segment) return 0
    const boundaries = highlightBoundaries(meta, [])
    const active =
      boundaries.length > 0 && at < (boundaries[0]?.at ?? 0) ? boundaries[0] : activeBoundaryAt(boundaries, at)
    if (active?.text) {
      return active.offset
    }
    const duration = segmentDurationAt(index)
    if (duration > 0) {
      return Math.min(segment.text.length, Math.round((at / duration) * segment.text.length))
    }
    return 0
  }

  // Inverse of charOffsetAtPosition: anchors a segment-relative character
  // offset onto the segment's current boundaries, snapping to the word start
  // at or before the offset (ratio interpolation without boundaries).
  function resumeTimeForCharOffset(index: number, charOffset: number): number {
    const meta = segmentMetaMap[index]
    const segment = sessionSegments[index]
    if (!meta || !segment) return 0
    const boundaries = highlightBoundaries(meta, [])
    if (boundaries.length > 0) {
      const absoluteBase = sessionOffset + segment.indexStart
      return locateCaretBoundaryAtOrBefore(boundaries, absoluteBase, absoluteBase + charOffset)
    }
    const duration = segmentDurationAt(index)
    if (duration > 0) {
      return (charOffset / Math.max(1, segment.text.length)) * duration
    }
    return 0
  }

  async function seekToSelectionRange(range: { from: number; to: number }) {
    if (sessionSegments.length === 0) return
    const start = locateSegmentStartByCharOffset(sessionSegments, range.from)
    const meta = segmentMetaMap[start.index]
    const boundaries = highlightBoundaries(meta, [])
    const absoluteBase = sessionSegments[start.index]?.indexStart ?? 0
    let targetAt = 0
    if (boundaries.length > 0) {
      targetAt = locateBoundaryStartWithinOrBefore(boundaries, absoluteBase, range)
    }
    // Stop the current playback and restart from the selected word. The
    // existing resume position (based on audio.currentTime) is discarded in
    // favor of the snapped word boundary inside the new selection.
    stopPlayback()
    playbackEnded = false
    setResumePosition(start.index, targetAt, true)
    await runPlayback(sessionSegments, sessionOffset, start.index, targetAt)
  }

  async function seekToCaretOffset(caretOffset: number) {
    if (sessionSegments.length === 0) return
    const start = locateSegmentStartByCharOffset(sessionSegments, caretOffset)
    const meta = segmentMetaMap[start.index]
    const boundaries = highlightBoundaries(meta, [])
    const absoluteBase = sessionSegments[start.index]?.indexStart ?? 0
    let targetAt = 0
    if (boundaries.length > 0) {
      targetAt = locateCaretBoundaryAtOrBefore(boundaries, absoluteBase, caretOffset)
    }
    stopPlayback()
    playbackEnded = false
    setResumePosition(start.index, targetAt, true)
    await runPlayback(sessionSegments, sessionOffset, start.index, targetAt)
  }

  function scheduleSeekFromSelection(range: { from: number; to: number }) {
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
      if (!pending || !isPlaying || isSelectionSyncSuppressed()) return
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
      if (pending == null || !isPlaying || isSelectionSyncSuppressed()) return
      void seekToCaretOffset(pending)
    }, 60)
  }

  function syncSelectionStart(range: { from: number; to: number } | null) {
    if (isSelectionSyncSuppressed()) return
    if (isPlaying) {
      if (range != null) {
        if (sessionSegments.length === 0) return
        scheduleSeekFromSelection(range)
        return
      }
      const caret = deps.getEditor()?.getCaretPosition?.() ?? null
      if (caret == null || sessionSegments.length === 0) return
      scheduleSeekFromCaret(caret)
      return
    }
    const content = deps.settings.content
    if (!content) {
      resetSession()
      return
    }
    // Selection changes fire on every caret move; segment the document only
    // when a selection actually needs a resume position computed.
    if (range == null) {
      const caret = deps.getEditor()?.getCaretPosition?.() ?? null
      if (caret == null) {
        if (!content.trim()) {
          resetSession()
        }
        return
      }
      const contentChanged = sessionSourceContent !== content
      const segments =
        sessionSegments.length > 0 && !contentChanged ? sessionSegments : splitTtsSegments(content)
      if (segments.length === 0) {
        resetSession()
        return
      }
      if (contentChanged) {
        clearSegments()
      }
      const start = locateSegmentStartByCharOffset(segments, caret)
      const meta = segmentMetaMap[start.index]
      if (!meta) {
        primeSession(segments, 0, null)
        return
      }
      primeSession(segments, 0, null)
      const absoluteBase = segments[start.index]?.indexStart ?? 0
      const boundaries = highlightBoundaries(meta, [])
      if (boundaries.length === 0) {
        return
      }
      setResumePosition(start.index, locateCaretBoundaryAtOrBefore(boundaries, absoluteBase, caret), false)
      return
    }
    const contentChanged = sessionSourceContent !== content
    const segments =
      sessionSegments.length > 0 && !contentChanged ? sessionSegments : splitTtsSegments(content)
    if (segments.length === 0) {
      resetSession()
      return
    }
    if (contentChanged) {
      // A re-split renumbers every segment; stale metadata recorded under the
      // old numbering must not survive into the new session, or rows merge
      // across texts (wrong boundaries, truncated speech, duplicated Seg
      // numbers).
      clearSegments()
    }
    const start = locateSegmentStartByCharOffset(segments, range.from)
    const meta = segmentMetaMap[start.index]
    if (!meta) {
      primeSession(segments, 0, range)
      return
    }
    primeSession(segments, 0, range)
    const absoluteBase = segments[start.index]?.indexStart ?? 0
    const boundaries = highlightBoundaries(meta, [])
    if (boundaries.length === 0) {
      return
    }
    setResumePosition(start.index, locateBoundaryStartWithinOrBefore(boundaries, absoluteBase, range), false)
  }

  function sessionMatchesEditor(editor: CodeEditorHandle, content: string): boolean {
    if (sessionSegments.length === 0 || sessionSourceContent !== content) {
      return false
    }
    const selectedRange = editor.getSelectionRange()
    const matchesOriginal =
      (selectedRange?.from ?? null) === (sessionSelectedRange?.from ?? null) &&
      (selectedRange?.to ?? null) === (sessionSelectedRange?.to ?? null)
    const matchesResume =
      (selectedRange?.from ?? null) === (sessionResumeSelection?.from ?? null) &&
      (selectedRange?.to ?? null) === (sessionResumeSelection?.to ?? null)
    return matchesOriginal || matchesResume
  }

  function locatePlaybackPosition(scaledElapsed: number): { index: number; startAt: number } | null {
    if (sessionSegments.length === 0) return null
    const clampedScaled = Math.max(0, Math.min(scaledElapsed, totalDuration || scaledElapsed))
    let total = 0
    for (let index = 0; index < sessionSegments.length; index += 1) {
      const duration = scaledDurationAt(index)
      if (index === sessionSegments.length - 1 || clampedScaled <= total + duration) {
        const scaledAt = Math.max(0, clampedScaled - total)
        return { index, startAt: mediaAtForScaled(index, scaledAt) }
      }
      total += duration
    }
    return { index: sessionSegments.length - 1, startAt: 0 }
  }

  function playAudioBlob(
    controller: PlaybackController,
    blob: Blob,
    onProgress?: (currentTime: number) => void,
    onDuration?: (duration: number) => void,
    startAt = 0,
    spokenStart = 0,
    spokenEnd?: number,
  ) {
    return new Promise<void>((resolve, reject) => {
      const audio = new Audio()
      const url = URL.createObjectURL(blob)
      currentAudio?.pause()
      if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl)
      }
      currentAudioUrl = url
      currentAudio = audio
      audio.src = url

      let rafId = 0
      let settled = false

      const cleanup = () => {
        stopTick()
        audio.pause()
        controller.cancelAudio = undefined
        if (currentAudioUrl === url) {
          URL.revokeObjectURL(url)
          currentAudioUrl = ''
          currentAudio = null
        }
      }
      const spokenDuration = () =>
        spokenEnd != null
          ? Math.max(0, spokenEnd - spokenStart)
          : Number.isFinite(audio.duration)
            ? audio.duration
            : 0
      const cancelResolve = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }
      controller.cancelAudio = cancelResolve

      const stopTick = () => {
        if (rafId) {
          cancelAnimationFrame(rafId)
          rafId = 0
        }
      }
      const elapsedWithin = (currentTime: number) => {
        const spoken = spokenDuration()
        const value = currentTime - spokenStart
        return spoken > 0 ? Math.min(Math.max(0, value), spoken) : Math.max(0, value)
      }
      const finishSegment = (endedAt?: number) => {
        if (settled) return
        settled = true
        const spoken = spokenDuration()
        const elapsed =
          endedAt != null
            ? endedAt
            : spokenEnd != null
              ? spoken
              : Number.isFinite(audio.currentTime)
                ? audio.currentTime
                : spoken
        playbackElapsed = elapsed
        playbackDuration = elapsed
        onDuration?.(elapsed)
        audio.pause()
        cleanup()
        resolve()
      }
      const tick = () => {
        rafId = 0
        if (controller.cancelled || audio.paused || audio.ended) return
        const current = audio.currentTime
        playbackElapsed = elapsedWithin(current)
        onProgress?.(current)
        if (spokenEnd != null && current >= spokenEnd - 0.01) {
          finishSegment()
          return
        }
        rafId = requestAnimationFrame(tick)
      }

      audio.onloadedmetadata = () => {
        const full = Number.isFinite(audio.duration) ? audio.duration : 0
        playbackDuration = spokenDuration()
        onDuration?.(playbackDuration)
        const seekTo = spokenStart + startAt
        if (seekTo > 0 && full > 0) {
          audio.currentTime = Math.min(seekTo, full)
        }
      }
      audio.ontimeupdate = () => {
        if (settled || audio.paused || audio.ended) return
        if (!document.hidden && rafId) return
        if (controller.cancelled) return
        const current = audio.currentTime
        playbackElapsed = elapsedWithin(current)
        onProgress?.(current)
        if (spokenEnd != null && current >= spokenEnd - 0.01) {
          finishSegment()
        }
      }
      audio.onended = () => {
        if (settled) return
        finishSegment()
      }
      audio.onerror = () => {
        if (settled) return
        settled = true
        cleanup()
        if (controller.cancelled) {
          resolve()
          return
        }
        reject(new Error(UI_TEXT[deps.settings.locale].playbackFailed))
      }

      audio.play().then(() => {
        if (!rafId && !settled) {
          rafId = requestAnimationFrame(tick)
        }
      }).catch(error => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      })
    })
  }

  async function runPlayback(
    segments: ReturnType<typeof splitTtsSegments>,
    playbackOffset: number,
    startIndex: number,
    startAt = 0,
    startCharOffset?: number,
  ) {
    const controller: PlaybackController = { cancelled: false, abort: new AbortController() }
    currentController = controller
    isPlaying = true
    lastStatusReason = 'ready'
    measuredTotal = 0
    playedDuration = 0
    for (let i = 0; i < startIndex; i += 1) {
      const prior = segmentDurationAt(i)
      measuredTotal += prior
      playedDuration += prior
    }
    let wasCancelled = false

    try {
      const concurrency = deps.settings.synthesisConcurrency
      synthesizedCount = Object.keys(segmentMetaMap).length
      const tasks = new Map<
        number,
        Promise<{
          blob: Blob
          boundaries: TtsBoundary[]
          wordBoundaries: TtsBoundary[]
          rate: number
          voiceName: string
          duration: number
          spokenStart?: number
          spokenEnd?: number
          generation: number
          effectiveLang: string
        }>
      >()
      let active = 0
      const waiters: Array<() => void> = []
      const acquire = () =>
        new Promise<void>(resolve => {
          if (active < concurrency) {
            active += 1
            resolve()
          } else {
            waiters.push(resolve)
          }
        })
      let nextToLaunch = 0
      const scheduleNext = () => {
        if (controller.cancelled) return
        while (nextToLaunch < segments.length && active < concurrency) {
          launch(nextToLaunch++)
        }
      }
      const release = () => {
        active -= 1
        const next = waiters.shift()
        if (next) {
          active += 1
          next()
        }
        // Keep the synthesis pipeline full: launch follow-up segments without
        // waiting for playback to reach them.
        scheduleNext()
      }
      const launch = (index: number) => {
        const existing = tasks.get(index)
        if (existing) return existing
        const segment = segments[index]
        const generationAtQueue = taskGeneration.get(index) ?? 0
        const task = (async () => {
          await acquire()
          // Re-read after queue wait; an override may have landed while queued.
          const effectiveLang = effectiveSegmentLang(index)
          const voice = resolveEffectiveVoice(effectiveLang)
          const rate = effectiveSpeed
          const generation = taskGeneration.get(index) ?? generationAtQueue
          try {
            if (!voice?.edge) {
              throw new LocalizedPlaybackError(
                `${UI_TEXT[deps.settings.locale].voiceNotConfigured} (${segmentLanguageName(deps.settings.locale, effectiveLang)})`,
              )
            }
            const synth = await getCachedSynthesis(
              segment.text,
              voice.edge,
              rate,
              controller.abort.signal,
              deps.getCacheScopeId(),
            )
            const duration = await readAudioDuration(synth.blob, controller.abort.signal)
            return {
              blob: synth.blob,
              boundaries: synth.boundaries,
              wordBoundaries: synth.wordBoundaries ?? [],
              rate,
              voiceName: voice.name,
              duration,
              spokenStart: synth.spokenStart,
              spokenEnd: synth.spokenEnd,
              generation,
              effectiveLang,
            }
          } finally {
            release()
          }
        })()
        task.then((res) => {
          if (controller.cancelled) return
          // A re-synthesis outside the pipeline superseded this task; the
          // fresh meta is already recorded, so skip the stale result.
          if ((taskGeneration.get(index) ?? 0) !== res.generation) return
          const existingMeta = segmentMetaMap[index]
          // Merge with the existing meta only when it describes this exact
          // text; a mismatch means it was recorded under an older split and
          // its boundaries, duration, and spoken range would be wrong here.
          const compatible = existingMeta?.text === segment.text
          const effective = { ...segment, lang: res.effectiveLang }
          const base = buildSegmentMeta(
            index,
            effective,
            {
              boundaries: res.boundaries,
              wordBoundaries: res.wordBoundaries,
              duration: res.duration,
              spokenStart: res.spokenStart,
              spokenEnd: res.spokenEnd,
              rate: res.rate,
            },
            playbackOffset + segment.indexStart,
          )
          if (!compatible) {
            recordSegment(index, base)
          } else {
            // Fresh synthesis wins: the base already reflects the segment's
            // current language/voice, so a boundary-less re-synthesis must
            // not resurrect the previous voice's timing.
            recordSegment(index, {
              ...existingMeta,
              ...base,
              boundaries: base.boundaries.length > 0 ? base.boundaries : existingMeta.boundaries,
              wordBoundaries:
                (base.wordBoundaries?.length ?? 0) > 0 ? base.wordBoundaries : (existingMeta.wordBoundaries ?? []),
              duration: base.duration ?? existingMeta.duration,
              spokenStart: base.spokenStart ?? existingMeta.spokenStart,
              spokenEnd: base.spokenEnd ?? existingMeta.spokenEnd,
            })
          }
        })
        tasks.set(index, task)
        return task
      }

      // Prioritize the segment where playback begins so it is synthesized
      // first; the whole text then synthesizes ahead in the background as
      // concurrency slots free up, independent of playback progress.
      void launch(startIndex)
      scheduleNext()
      for (let index = startIndex; index < segments.length; index += 1) {
        const segment = segments[index]
        if (controller.cancelled) return
        currentSegmentIndex = index + 1
        totalSegments = segments.length
        playbackElapsed = index === startIndex ? startAt : 0
        playbackDuration = 0
        const ranges = splitHighlightRanges(segment.text)
        const absoluteBase = playbackOffset + segment.indexStart
        let result = await launch(index)
        // A queued task can be superseded by a language or voice override made
        // while playback is paused or switching; rebuild it so the segment
        // plays audio that matches its current language and voice.
        while (!controller.cancelled && result.generation !== (taskGeneration.get(index) ?? 0)) {
          tasks.delete(index)
          result = await launch(index)
        }
        if (controller.cancelled) return
        currentSynthesisRate = result.rate
        metadataAvailable = result.boundaries.length > 0 || result.wordBoundaries.length > 0
        playbackDuration = result.duration

        const segmentMeta = segmentMetaMap[index]
        const highlightMarks = highlightBoundaries(
          segmentMeta,
          result.wordBoundaries.length > 0 ? result.wordBoundaries : result.boundaries,
        )

        const applyHighlight = (currentTime: number) => {
          updateSelectionForPosition(index, currentTime)
        }
        const selectWholeSegment = () => {
          const trimmed = trimWhitespaceRange(segment.text, 0, segment.text.length)
          withSuppressedSelection(() =>
            deps.getEditor()?.setSelection(absoluteBase + trimmed.start, absoluteBase + trimmed.end),
          )
        }
        let segAt = index === startIndex ? startAt : 0
        if (highlightMarks.length > 0) {
          applyHighlight(segAt)
        } else {
          selectWholeSegment()
        }

        if (index === startIndex && startCharOffset != null && highlightMarks.length > 0) {
          let candidateAt = 0
          for (const boundary of highlightMarks) {
            if (absoluteBase + boundary.offset <= startCharOffset) {
              candidateAt = boundary.at
              continue
            }
            break
          }
          segAt = candidateAt
          playbackElapsed = segAt
          if (segAt > 0) {
            const range = activeHighlightRange(ranges, highlightMarks, segAt)
            if (range) {
              const trimmed = trimWhitespaceRange(segment.text, range.start, range.end)
              withSuppressedSelection(() =>
                deps.getEditor()?.setSelection(absoluteBase + trimmed.start, absoluteBase + trimmed.end),
              )
            }
          }
        }

        const spokenStart = segmentMeta?.spokenStart ?? 0
        const spokenEnd = segmentMeta?.spokenEnd
        await playAudioBlob(
          controller,
          result.blob,
          ranges.length > 0 && highlightMarks.length > 0 ? applyHighlight : undefined,
          duration => {
            setSegmentDuration(index, duration)
          },
          segAt,
          spokenStart,
          spokenEnd,
        )
        if (controller.cancelled) {
          wasCancelled = true
        } else {
          measuredTotal += playbackDuration
          playedDuration = measuredTotal
        }
      }

      if (wasCancelled) return
      currentController = null
      isPlaying = false
      lastStatusReason = 'finished'
      playbackEnded = true
      synthesizedCount = totalSegments
      resumeSegmentIndex = 0
      resumeSegmentTime = 0
      playedDuration = measuredTotal
      playbackElapsed = 0
      withSuppressedSelection(() => {
        if (sessionSelectedRange) {
          deps.getEditor()?.setSelection(sessionSelectedRange.from, sessionSelectedRange.to)
        } else {
          deps.getEditor()?.clearSelection()
        }
      })
      statusMessage = UI_TEXT[deps.settings.locale].playbackFinished
    } catch (error) {
      if (controller.cancelled) return
      currentController = null
      isPlaying = false
      lastStatusReason = 'error'
      metadataAvailable = false
      console.error(error)
      statusMessage =
        error instanceof LocalizedPlaybackError
          ? error.message
          : UI_TEXT[deps.settings.locale].playbackFailed
    }
  }

  function warmFromCache() {
    if (!isSynthesisCacheHydrated()) {
      // On boot the IndexedDB-backed segment cache may still be loading; defer
      // the scan until it lands so a reload surfaces previously synthesized
      // segments instead of warming from an empty map.
      onSynthesisCacheHydrated(() => warmFromCache())
      return
    }
    resetSession()
    const content = deps.settings.content
    if (!content.trim()) {
      return
    }
    const segments = splitTtsSegments(content)
    if (segments.length === 0) {
      return
    }
    const selectedRange = deps.getEditor()?.getSelectionRange() ?? null
    primeSession(segments, 0, selectedRange)
    // Surface only already-cached segments so the status strip and slider can
    // appear without the Info panel; uncached synthesis stays deferred to Play.
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]
      const voice = deps.settings.resolveVoiceForSegment(segment.lang)
      if (!voice?.edge) {
        continue
      }
      const cached = peekCachedSynthesis(segment.text, voice.edge, effectiveSpeed)
      if (!cached) {
        continue
      }
      recordSegment(
        index,
        buildSegmentMeta(
          index,
          segment,
          {
            boundaries: cached.boundaries,
            wordBoundaries: cached.wordBoundaries,
            spokenStart: cached.spokenStart,
            spokenEnd: cached.spokenEnd,
            rate: effectiveSpeed,
          },
          segment.indexStart,
        ),
      )
    }
    metadataAvailable = Object.keys(segmentMetaMap).length > 0
  }

  function primeSession(
    segments: ReturnType<typeof splitTtsSegments>,
    offset: number,
    selectedRange: { from: number; to: number } | null = null,
  ) {
    // A new split invalidates index-keyed overrides from the prior session;
    // keep them only when the reference array is the same object.
    if (segments !== sessionSegments) {
      segmentLangOverrides = new Map()
      sessionVoiceSelections = new Map()
      sessionSpeed = null
    }
    sessionSegments = segments
    sessionOffset = offset
    sessionSelectedRange = selectedRange
    sessionSourceContent = deps.settings.content
    sessionResumeSelection = selectedRange
    resumeSegmentIndex = 0
    resumeSegmentTime = 0
    totalSegments = segments.length
  }

  async function startPlayback() {
    const editor = deps.getEditor()
    if (!deps.settings.canPlay || !editor || isPlaying || voiceSwitching) {
      return
    }
    const content = deps.settings.content
    if (sessionMatchesEditor(editor, content)) {
      playbackEnded = false
      deps.prepareForPlayback()
      await runPlayback(sessionSegments, sessionOffset, resumeSegmentIndex, resumeSegmentTime)
      return
    }
    const selectedRange = editor.getSelectionRange()
    const segments = splitTtsSegments(content)
    if (segments.length === 0) {
      return
    }
    const start = selectedRange ? locateSegmentStartByCharOffset(segments, selectedRange.from) : { index: 0, charOffset: undefined }
    primeSession(segments, 0, selectedRange)
    clearSegments()
    deps.prepareForPlayback()
    await runPlayback(segments, 0, start.index, 0, start.charOffset)
  }

  async function seekTo(elapsed: number) {
    // Inert while a voice switch owns playback: a paused seek here would be
    // clobbered by the switch's pending resume.
    if (voiceSwitching) return
    const position = locatePlaybackPosition(elapsed)
    if (!position) return
    if (isPlaying) {
      stopPlayback()
      await runPlayback(sessionSegments, sessionOffset, position.index, position.startAt)
      return
    }
    playbackEnded = false
    setResumePosition(position.index, position.startAt)
  }

  async function playIsolatedFragment(
    segmentIndex: number,
    charOffset: number,
    meta: SegmentMeta,
    segment: ReturnType<typeof splitTtsSegments>[number],
  ): Promise<boolean> {
    // Try to isolate the exact sentence or word slice for single-playback.
    // Returns true when an isolated fragment was played, false to fall back
    // to the full segment chain.
    const absoluteBase = sessionOffset + segment.indexStart
    let isolatedText: string | null = null
    let selFrom = -1
    let selTo = -1

    const wordBoundary = meta.wordBoundaries?.find(b => meta.baseOffset + b.offset === charOffset)
    if (wordBoundary) {
      const raw = wordBoundary.text ?? ''
      if (raw.trim()) {
        isolatedText = raw
        const trimmed = trimWhitespaceRange(segment.text, wordBoundary.offset, wordBoundary.offset + raw.length)
        selFrom = absoluteBase + trimmed.start
        selTo = absoluteBase + trimmed.end
      }
    } else {
      const boundary = meta.boundaries.find(b => meta.baseOffset + b.offset === charOffset)
      if (boundary) {
        const range =
          meta.ranges.find(r => boundary.offset >= r.start && boundary.offset < r.end) ?? meta.ranges[meta.ranges.length - 1]
        const raw = boundary.text ?? (range ? segment.text.slice(range.start, range.end) : '')
        if (raw.trim()) {
          isolatedText = raw
          const start = boundary.offset
          const end = start + raw.length
          const trimmed = trimWhitespaceRange(segment.text, start, end)
          selFrom = absoluteBase + trimmed.start
          selTo = absoluteBase + trimmed.end
        }
      } else {
        const range = meta.ranges.find(r => meta.baseOffset + r.start === charOffset)
        if (range) {
          const raw = segment.text.slice(range.start, range.end)
          const trimmedRaw = raw.trim() !== '' ? raw.trim() : raw
          if (trimmedRaw) {
            isolatedText = trimmedRaw
            const trimmed = trimWhitespaceRange(segment.text, range.start, range.end)
            selFrom = absoluteBase + trimmed.start
            selTo = absoluteBase + trimmed.end
          }
        }
      }
    }

    if (!isolatedText) return false

    const lang = effectiveSegmentLang(segmentIndex)
    const voice = resolveEffectiveVoice(lang)
    if (!voice?.edge) {
      throw new LocalizedPlaybackError(
        `${UI_TEXT[deps.settings.locale].voiceNotConfigured} (${segmentLanguageName(deps.settings.locale, lang)})`,
      )
    }

    const controller: PlaybackController = { cancelled: false, abort: new AbortController() }
    currentController = controller
    isPlaying = true
    playbackEnded = false
    lastStatusReason = 'ready'
    currentSegmentIndex = segmentIndex + 1
    totalSegments = sessionSegments.length
    playbackElapsed = 0
    playbackDuration = 0

    // Highlight the isolated slice in the editor as our own echo.
    if (selFrom >= 0 && selTo >= 0 && selFrom !== selTo) {
      applyOwnSelection(() => {
        withSuppressedSelection(() => deps.getEditor()?.setSelection(selFrom, selTo))
      })
    }

    try {
      const docId = deps.getCacheScopeId()
      const synth = await getCachedSynthesis(isolatedText, voice.edge, effectiveSpeed, controller.abort.signal, docId)
      if (controller.cancelled) return true
      const duration = await readAudioDuration(synth.blob, controller.abort.signal)
      if (controller.cancelled) return true
      currentSynthesisRate = effectiveSpeed
      metadataAvailable = (synth.boundaries.length > 0 || (synth.wordBoundaries?.length ?? 0) > 0)
      playbackDuration = duration
      // Play the isolated fragment only; do not continue to subsequent sentences.
      const spokenStart = synth.spokenStart ?? 0
      const spokenEnd = synth.spokenEnd
      await playAudioBlob(
        controller,
        synth.blob,
        undefined,
        d => {
          playbackDuration = d
        },
        0,
        spokenStart,
        spokenEnd,
      )
      if (controller.cancelled) return true
      currentController = null
      isPlaying = false
      lastStatusReason = 'finished'
      statusMessage = UI_TEXT[deps.settings.locale].playbackFinished
      playbackElapsed = 0
      // Restore the original selection echo so a subsequent Play from the
      // editor still recognises the isolated position.
      applyOwnSelection(() => {
        if (selFrom >= 0 && selTo >= 0) {
          withSuppressedSelection(() => deps.getEditor()?.setSelection(selFrom, selTo))
          sessionResumeSelection = { from: selFrom, to: selTo }
        }
      })
      return true
    } catch (error) {
      if (controller.cancelled) return true
      currentController = null
      isPlaying = false
      lastStatusReason = 'error'
      metadataAvailable = false
      console.error(error)
      statusMessage =
        error instanceof LocalizedPlaybackError ? error.message : UI_TEXT[deps.settings.locale].playbackFailed
      return true
    }
  }

  async function playFromSegment(index: number, charOffset?: number) {
    // Inert while a voice switch owns playback: starting a session here would
    // race the switch's pending resume for the same segment.
    if (voiceSwitching) return
    if (sessionSegments.length === 0) {
      return
    }
    // When the Info panel triggers a word or sentence row (charOffset
    // provided), play only that single fragment and do not continue to the
    // next sentence or word.
    if (charOffset != null) {
      const meta = segmentMetaMap[index]
      const segment = sessionSegments[index]
      if (meta && segment) {
        playbackEnded = false
        stopPlayback()
        const handled = await playIsolatedFragment(index, charOffset, meta, segment)
        if (handled) return
        // Fall through to the full-chain path if no isolated slice was found.
      }
    }
    playbackEnded = false
    stopPlayback()
    let startAt = 0
    if (charOffset != null) {
      const meta = segmentMetaMap[index]
      if (meta) {
        const wordBoundary = meta.wordBoundaries?.find(b => meta.baseOffset + b.offset === charOffset)
        if (wordBoundary) {
          startAt = wordBoundary.at
        } else {
          const boundary = meta.boundaries.find(b => meta.baseOffset + b.offset === charOffset)
          if (boundary) {
            startAt = boundary.at
          } else {
            // Fallback: synthetic sentence rows (CJK space/comma split) have no
            // matching SentenceBoundary — locate the highlight range instead and
            // interpolate timing by character offset.
            const range = meta.ranges.find(r => meta.baseOffset + r.start === charOffset)
            if (range) {
              const segDuration = segmentDurationAt(index)
              if (segDuration > 0) {
                startAt = (range.start / Math.max(1, meta.text.length)) * segDuration
              }
            }
          }
        }
      }
    }
    setResumePosition(index, startAt)
    await runPlayback(sessionSegments, sessionOffset, index, startAt)
  }

  function buildSegmentMeta(
    index: number,
    segment: ReturnType<typeof splitTtsSegments>[number],
    fields: {
      boundaries: TtsBoundary[]
      wordBoundaries?: TtsBoundary[]
      duration?: number
      spokenStart?: number
      spokenEnd?: number
      rate?: number
    },
    baseOffset: number,
  ): SegmentMeta {
    return {
      index,
      lang: segment.lang,
      text: segment.text,
      ranges: splitHighlightRanges(segment.text),
      boundaries: fields.boundaries,
      wordBoundaries: fields.wordBoundaries ?? [],
      baseOffset,
      duration: fields.duration,
      spokenStart: fields.spokenStart,
      spokenEnd: fields.spokenEnd,
      rate: fields.rate ?? effectiveSpeed,
    }
  }

  function recordSegment(index: number, record: SegmentMeta) {
    segmentMetaMap[index] = record
    synthesizedCount = Object.keys(segmentMetaMap).length
  }

  function setSegmentDuration(index: number, duration: number) {
    const recorded = segmentMetaMap[index]
    if (recorded) {
      segmentMetaMap[index] = { ...recorded, duration }
    }
  }

  function clearSegments() {
    // A cleared metadata map invalidates any pending voice-switch resume that
    // still expects to re-anchor onto the old segment timings.
    voiceSwitchGeneration += 1
    segmentMetaMap = {}
    synthesizedCount = 0
    currentSegmentIndex = 0
    totalSegments = sessionSegments.length
    playedDuration = 0
    measuredTotal = 0
    playbackElapsed = 0
    playbackDuration = 0
    currentSynthesisRate = effectiveSpeed
    metadataAvailable = false
    // A re-split renumbers every segment; any per-segment language override
    // keyed by the old index would now address the wrong text.
    segmentLangOverrides = new Map()
    sessionVoiceSelections = new Map()
    // Invalidate any pending debounced seek that was queued before the reset.
    pendingSelectionGeneration += 1
    if (pendingSelectionSeekTimer) {
      clearTimeout(pendingSelectionSeekTimer)
      pendingSelectionSeekTimer = null
      pendingSelectionRange = null
      pendingCaretOffset = null
    }
  }

  function resetSession() {
    stopPlayback()
    sessionSegments = []
    sessionOffset = 0
    sessionSelectedRange = null
    sessionSourceContent = ''
    sessionResumeSelection = null
    resumeSegmentIndex = 0
    resumeSegmentTime = 0
    playbackEnded = false
    segmentLangOverrides = new Map()
    sessionVoiceSelections = new Map()
    sessionSpeed = null
    clearSegments()
    initStatus()
  }

  function initStatus() {
    lastStatusReason = 'ready'
    statusMessage = UI_TEXT[deps.settings.locale].ready
  }

  function onLocaleChanged(next: UiLocale) {
    if (lastStatusReason === 'stopped') {
      statusMessage = UI_TEXT[next].playbackStopped
      return
    }
    if (lastStatusReason === 'switching') {
      statusMessage = UI_TEXT[next].voiceSwitching
      return
    }
    if (lastStatusReason === 'finished') {
      statusMessage = UI_TEXT[next].playbackFinished
      return
    }
    lastStatusReason = 'ready'
    statusMessage = UI_TEXT[next].ready
  }

  async function resynthesizeSegment(index: number, voiceEdge: string): Promise<void> {
    if (index < 0 || index >= sessionSegments.length) return
    const segment = sessionSegments[index]
    if (!segment) return
    // Invalidate any queued task for this index so its result can neither
    // record nor play stale audio over the re-synthesized segment.
    taskGeneration.set(index, (taskGeneration.get(index) ?? 0) + 1)
    const effective = { ...segment, lang: effectiveSegmentLang(index) }
    const rate = effectiveSpeed
    const docId = deps.getCacheScopeId()
    const synth = await getCachedSynthesis(segment.text, voiceEdge, rate, undefined, docId)
    const abort = new AbortController()
    const duration = await readAudioDuration(synth.blob, abort.signal)
    const baseOffset = sessionOffset + segment.indexStart
    const meta = buildSegmentMeta(
      index,
      effective,
      {
        boundaries: synth.boundaries,
        wordBoundaries: synth.wordBoundaries,
        duration,
        spokenStart: synth.spokenStart,
        spokenEnd: synth.spokenEnd,
        rate,
      },
      baseOffset,
    )
    recordSegment(index, meta)
    if (meta.boundaries.length > 0 || (meta.wordBoundaries?.length ?? 0) > 0) {
      metadataAvailable = true
    }
  }

  async function overrideSegmentLanguage(index: number, lang: string): Promise<void> {
    if (index < 0 || index >= sessionSegments.length) return
    // Resolve the voice for the requested language before recording the
    // override; resolveVoiceForSegment maps spoken codes (yue) onto the
    // written language and falls back to defaults. A language without a
    // configured voice leaves the segment untouched instead of failing later
    // during playback.
    const effectiveVoice = deps.settings.resolveVoiceForSegment(lang)
    const edge = effectiveVoice?.edge
    if (!edge) return
    const next = new Map(segmentLangOverrides)
    next.set(index, lang)
    segmentLangOverrides = next
    await resynthesizeSegment(index, edge)
  }

  // Serialized voice switches: a pick landing while an earlier switch is
  // still synthesizing queues behind it, and the resumed playback resolves
  // the segment's voice through the latest recorded override.
  let voiceSwitchChain: Promise<void> = Promise.resolve()

  function recordSessionVoiceOverride(languageCode: string, voiceEdge: string) {
    const next = new Map(sessionVoiceSelections)
    next.set(languageCode, voiceEdge)
    sessionVoiceSelections = next
  }

  function setPlaybackSpeed(speed: number) {
    if (!SPEEDS.includes(speed as (typeof SPEEDS)[number])) return
    // Keep session override separate from persisted default: selecting the
    // default clears the override so future default changes are followed.
    if (speed === deps.settings.speed) {
      sessionSpeed = null
    } else {
      sessionSpeed = speed
    }
  }

  async function overrideSegmentVoice(index: number, voiceEdge: string): Promise<void> {
    if (index < 0 || index >= sessionSegments.length) return
    // Picking the voice that already applies is a no-op: re-running the
    // switch would needlessly restart the playing audio.
    if (resolveEffectiveVoice(effectiveSegmentLang(index))?.edge === voiceEdge) return
    const run = voiceSwitchChain.then(() => applyVoiceOverride(index, voiceEdge))
    voiceSwitchChain = run.catch(() => {})
    await run
  }

  async function applyVoiceOverride(index: number, voiceEdge: string): Promise<void> {
    if (index < 0 || index >= sessionSegments.length) return
    if (isPlaying) {
      await switchVoiceDuringPlayback(Math.max(0, currentSegmentIndex - 1), voiceEdge)
      return
    }
    // Paused: remap the stored resume time onto the new voice's timing when
    // the changed segment is the resume target, so the next Play starts at
    // the same word instead of at a stale old-voice time.
    const remapResume = index === resumeSegmentIndex && resumeSegmentTime > 0
    const resumeCharOffset = remapResume ? charOffsetAtPosition(index, resumeSegmentTime) : null
    try {
      await resynthesizeSegment(index, voiceEdge)
    } catch (error) {
      console.error(error)
      lastStatusReason = 'error'
      metadataAvailable = false
      statusMessage = UI_TEXT[deps.settings.locale].playbackFailed
      return
    }
    // Record the override only after synthesis succeeded so a failed switch
    // leaves the session resolving the previous voice.
    recordSessionVoiceOverride(toWrittenLang(effectiveSegmentLang(index)), voiceEdge)
    if (resumeCharOffset != null) {
      const remapped = resumeTimeForCharOffset(index, resumeCharOffset)
      resumeSegmentTime = remapped
      playbackElapsed = remapped
    }
  }

  async function switchVoiceDuringPlayback(playIndex: number, voiceEdge: string) {
    // Pause at the current word, resynthesize the segment for the new voice,
    // then resume from the same word once synthesis is ready. The word
    // travels as a character offset because voices time the same text
    // differently; the old voice's elapsed time is meaningless to it.
    voiceSwitching = true
    let generation = -1
    try {
      const segment = sessionSegments[playIndex]
      if (!segment) return
      const languageCode = toWrittenLang(effectiveSegmentLang(playIndex))
      const audio = currentAudio
      const at = audio
        ? Math.max(0, audio.currentTime - (segmentMetaMap[playIndex]?.spokenStart ?? 0))
        : playbackElapsed
      const charOffset = charOffsetAtPosition(playIndex, at)
      stopPlayback()
      recordSessionVoiceOverride(languageCode, voiceEdge)
      if (playbackEnded) {
        // The stop landed at (or past) the spoken end: the segment finished,
        // so there is nothing to resume and the override applies from the
        // next Play.
        return
      }
      lastStatusReason = 'switching'
      statusMessage = UI_TEXT[deps.settings.locale].voiceSwitching
      generation = ++voiceSwitchGeneration
      await resynthesizeSegment(playIndex, voiceEdge)
      if (generation !== voiceSwitchGeneration) {
        // A Stop, reset, or session invalidation landed while synthesizing:
        // leave playback where that path left it.
        return
      }
      const targetAt = resumeTimeForCharOffset(playIndex, charOffset)
      setResumePosition(playIndex, targetAt, true)
      // Fire-and-forget: the switch is applied once playback has restarted;
      // runPlayback settles itself on finish, cancellation, or error.
      void runPlayback(sessionSegments, sessionOffset, playIndex, targetAt)
    } catch (error) {
      console.error(error)
      if (generation === voiceSwitchGeneration) {
        lastStatusReason = 'error'
        metadataAvailable = false
        statusMessage = UI_TEXT[deps.settings.locale].playbackFailed
      }
    } finally {
      voiceSwitching = false
    }
  }

  return {
    get isPlaying() {
      return isPlaying
    },
    get hasSession() {
      return sessionSegments.length > 0
    },
    get sessionSource() {
      return sessionSourceContent
    },
    get playbackSpeed() {
      return playbackSpeed
    },
    get effectiveSpeed() {
      return effectiveSpeed
    },
    get isPlaybackEnded() {
      return playbackEnded
    },
    get currentSegmentIndex() {
      return currentSegmentIndex
    },
    get totalSegments() {
      return totalSegments
    },
    get synthesizedCount() {
      return synthesizedCount
    },
    get playedDuration() {
      return playedDuration
    },
    get positionSegmentIndex() {
      return positionSegmentIndex
    },
    get positionVoiceName() {
      return positionVoiceName
    },
    get positionVoiceGender() {
      return positionVoiceGender
    },
    get positionVoiceLocale() {
      return positionVoiceLocale
    },
    get positionSegmentLang() {
      return positionSegmentLang
    },
    get positionLanguageCode() {
      return positionLanguageCode
    },
    get positionSegmentText() {
      return positionSegmentText
    },
    get currentSynthesisRate() {
      return currentSynthesisRate
    },
    get playbackElapsed() {
      return playbackElapsed
    },
    get playbackDuration() {
      return playbackDuration
    },
    get totalElapsed() {
      return totalElapsed
    },
    get totalDuration() {
      return totalDuration
    },
    get statusMessage() {
      return statusMessage
    },
    get metadataAvailable() {
      return metadataAvailable
    },
    get voiceSwitching() {
      return voiceSwitching
    },
    setMetadataAvailability(value: boolean) {
      metadataAvailable = value
    },
    get segments() {
      return segmentMetaMap
    },
    initStatus,
    onLocaleChanged,
    startPlayback,
    stopPlayback,
    seekTo,
    playFromSegment,
    syncSelectionStart,
    warmFromCache,
    primeSession,
    recordSegment,
    setSegmentDuration,
    clearSegments,
    resetSession,
    resynthesizeSegment,
    overrideSegmentLanguage,
    overrideSegmentVoice,
    effectiveVoiceEdge: (segmentLang: string) => resolveEffectiveVoice(segmentLang)?.edge ?? '',
    setPlaybackSpeed,
  }
}
