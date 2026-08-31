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
  setPlaybackHighlight?: (from: number, to: number) => void
  setPlaybackHighlightSelected?: (from: number, to: number) => void
  clearPlaybackHighlight?: () => void
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
  readonly isSelectionScoped: boolean
  readonly activeInfoOffset: number
  readonly activeInfoKind: 'sentence' | 'word' | null
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
  playSentence: (index: number, charOffset: number) => Promise<void>
  playWord: (index: number, charOffset: number) => Promise<void>
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
  let activeInfoOffset = $state(-1)
  let activeInfoKind = $state<'sentence' | 'word' | null>(null)

  let segmentMetaMap = $state<Record<number, SegmentMeta>>({})
  let sessionSegments: ReturnType<typeof splitTtsSegments> = []
  let sessionOffset = 0
  let sessionSelectedRange: { from: number; to: number } | null = null
  let sessionSelectionScoped = false
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

  function hasNonEmptySelection(range: { from: number; to: number } | null | undefined): boolean {
    return !!range && range.to > range.from
  }

  function clampRangeToContent(range: { from: number; to: number }, content: string): { from: number; to: number } | null {
    const from = Math.max(0, Math.min(range.from, content.length))
    const to = Math.max(from, Math.min(range.to, content.length))
    return to > from ? { from, to } : null
  }

  function trimmedContentRange(range: { from: number; to: number }, content: string): { from: number; to: number; text: string } | null {
    const clamped = clampRangeToContent(range, content)
    if (!clamped) return null
    const raw = content.slice(clamped.from, clamped.to)
    const trimmed = trimWhitespaceRange(raw, 0, raw.length)
    const text = raw.slice(trimmed.start, trimmed.end)
    if (!text) return null
    return {
      from: clamped.from + trimmed.start,
      to: clamped.from + trimmed.end,
      text,
    }
  }

  function isWordChar(ch: string): boolean {
    return /[A-Za-z0-9]/.test(ch)
  }

  function isPartialWordSelection(scoped: { from: number; to: number }, content: string, covering: ReturnType<typeof splitTtsSegments>): boolean {
    // Check if the first or last word of the selection is cut in the middle.
    // For word-aligned reuse we require both boundaries to sit on word edges.
    // Use cached word boundaries when available, otherwise fall back to a
    // simple isWordChar check so CJK (non-ASCII) is never considered partial.
    const from = scoped.from
    const to = scoped.to
    if (covering.length === 0) return false
    const firstSeg = covering[0]
    const lastSeg = covering[covering.length - 1]
    const firstIdx = sessionSegments.findIndex(s => s.indexStart === firstSeg.indexStart && s.indexEnd === firstSeg.indexEnd && s.text === firstSeg.text)
    const lastIdx = sessionSegments.findIndex(s => s.indexStart === lastSeg.indexStart && s.indexEnd === lastSeg.indexEnd && s.text === lastSeg.text)
    const firstMeta = firstIdx >= 0 ? segmentMetaMap[firstIdx] : undefined
    const lastMeta = lastIdx >= 0 ? segmentMetaMap[lastIdx] : undefined

    const checkInsideWord = (absOffset: number, seg: ReturnType<typeof splitTtsSegments>[number], meta: SegmentMeta | undefined): boolean => {
      if (!meta?.wordBoundaries || meta.wordBoundaries.length === 0) {
        const prev = absOffset > 0 ? content[absOffset - 1] : ''
        const curr = absOffset < content.length ? content[absOffset] : ''
        return !!prev && !!curr && isWordChar(prev) && isWordChar(curr)
      }
      for (const wb of meta.wordBoundaries) {
        const wFrom = seg.indexStart + wb.offset
        const wTo = wFrom + (wb.text?.length ?? 0)
        if (absOffset > wFrom && absOffset < wTo) return true
      }
      return false
    }

    if (checkInsideWord(from, firstSeg, firstMeta)) return true
    if (checkInsideWord(to, lastSeg, lastMeta)) return true
    return false
  }

  function getCoveringSegments(scoped: { from: number; to: number }, segments: ReturnType<typeof splitTtsSegments>): ReturnType<typeof splitTtsSegments> {
    return segments.filter(seg => seg.indexStart < scoped.to && seg.indexEnd >= scoped.from)
  }

  interface ReusableScopedSegment {
    source: ReturnType<typeof splitTtsSegments>[number]
    text: string
    lang: string
    indexStart: number
    indexEnd: number
    sourceStartAt: number
    sourceEndAt: number
    boundaries: TtsBoundary[]
    wordBoundaries: TtsBoundary[]
  }

  function buildReusableScopedSegments(
    scoped: { from: number; to: number },
    content: string,
  ): ReusableScopedSegment[] | null {
    const fullSegments = splitTtsSegments(content)
    const covering = getCoveringSegments(scoped, fullSegments)
    if (covering.length === 0) return null
    if (isPartialWordSelection(scoped, content, covering)) return null
    const reusable: ReusableScopedSegment[] = []
    for (const seg of covering) {
      const voice = resolveEffectiveVoice(seg.lang)
      if (!voice?.edge) return null
      const cached = peekCachedSynthesis(seg.text, voice.edge, effectiveSpeed)
      if (!cached) return null
      const sourceWordBoundaries = cached.wordBoundaries ?? []
      const sourceBoundaries = sourceWordBoundaries.length > 0 ? sourceWordBoundaries : cached.boundaries
      if (sourceBoundaries.length === 0) return null
      const selectedWords = sourceBoundaries.filter(boundary => {
        const absoluteStart = seg.indexStart + boundary.offset
        const absoluteEnd = absoluteStart + (boundary.text?.length ?? 0)
        return absoluteStart >= scoped.from && absoluteEnd <= scoped.to
      })
      if (selectedWords.length === 0) continue
      const first = selectedWords[0]
      const last = selectedWords[selectedWords.length - 1]
      const sourceStartAt = first.at
      const lastBoundaryEnd = last.duration != null ? last.at + last.duration : null
      const nextAfterLast = sourceBoundaries.find(boundary => boundary.at > last.at)
      const sourceEndAt = lastBoundaryEnd ?? nextAfterLast?.at ?? cached.spokenEnd ?? last.at + 0.5
      const absoluteStart = seg.indexStart + first.offset
      const absoluteEnd = Math.min(scoped.to, seg.indexEnd + 1)
      const text = content.slice(absoluteStart, absoluteEnd)
      const wordBoundaries = selectedWords.map(boundary => ({
        offset: seg.indexStart + boundary.offset - absoluteStart,
        at: boundary.at - sourceStartAt,
        text: boundary.text,
        duration: boundary.duration,
      }))
      const sentenceStarts = [absoluteStart]
      for (const boundary of cached.boundaries) {
        const start = seg.indexStart + boundary.offset
        if (start > absoluteStart && start < absoluteEnd) {
          sentenceStarts.push(start)
        }
      }
      sentenceStarts.sort((a, b) => a - b)
      const sentenceBoundaries = sentenceStarts.map((start, index) => {
        const nextStart = sentenceStarts[index + 1] ?? absoluteEnd
        const offset = start - absoluteStart
        const text = content.slice(start, nextStart)
        const sourceBoundary = cached.boundaries.find(boundary => seg.indexStart + boundary.offset === start)
        const boundaryAt = sourceBoundary ? Math.max(0, sourceBoundary.at - sourceStartAt) : 0
        return {
          offset,
          at: boundaryAt,
          text,
        }
      })
      reusable.push({
        source: seg,
        text,
        lang: seg.lang,
        indexStart: absoluteStart,
        indexEnd: absoluteEnd - 1,
        sourceStartAt,
        sourceEndAt,
        boundaries: sentenceBoundaries,
        wordBoundaries,
      })
    }
    return reusable.length > 0 ? reusable : null
  }

  function applyPlaybackHighlight(from: number, to: number) {
    const editor = deps.getEditor()
    if (!editor) return
    const useSelected =
      sessionSelectionScoped &&
      sessionSelectedRange &&
      from >= sessionSelectedRange.from &&
      to <= sessionSelectedRange.to &&
      !!editor.setPlaybackHighlightSelected
    if (useSelected) {
      editor.setPlaybackHighlightSelected?.(from, to)
    } else {
      editor.setPlaybackHighlight?.(from, to)
    }
  }

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
      activeInfoOffset = -1
      activeInfoKind = null
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
      activeInfoOffset = -1
      activeInfoKind = null
      statusMessage = UI_TEXT[deps.settings.locale].playbackFinished
      return
    }
    lastStatusReason = 'stopped'
    playbackEnded = false
    activeInfoOffset = -1
    activeInfoKind = null
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

  function updateHighlightForPosition(index: number, at: number): { from: number; to: number } | null {
    const meta = segmentMetaMap[index]
    const segment = sessionSegments[index]
    if (!segment) return null
    const absoluteBase = sessionOffset + segment.indexStart
    const setWholeSegmentSelection = (): { from: number; to: number } => {
      const trimmed = trimWhitespaceRange(segment.text, 0, segment.text.length)
      const range = { from: absoluteBase + trimmed.start, to: absoluteBase + trimmed.end }
      applyPlaybackHighlight(range.from, range.to)
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
      applyPlaybackHighlight(range.from, range.to)
      return range
    }
    const range = activeHighlightRange(meta.ranges, boundaries, at)
    if (!range) {
      return setWholeSegmentSelection()
    }
    const trimmed = trimWhitespaceRange(segment.text, range.start, range.end)
    const applied = { from: absoluteBase + trimmed.start, to: absoluteBase + trimmed.end }
    applyPlaybackHighlight(applied.from, applied.to)
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
    sessionResumeSelection = updateHighlightForPosition(clampedIndex, clampedAt) ?? sessionResumeSelection
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
    if (sessionSelectionScoped) return
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
    if (sessionSelectionScoped) return
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
        if (sessionSelectionScoped) return
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
    if (range && hasNonEmptySelection(range)) {
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
      primeSession(segments, 0, range)
      void warmSelectionScope(range)
      return
    }
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
      deps.getEditor()?.clearPlaybackHighlight?.()
      if (sessionSelectionScoped) {
        const fullSegments = splitTtsSegments(content)
        primeSession(fullSegments, 0, null)
        refreshSessionFromCache()
        return
      }
      const start = locateSegmentStartByCharOffset(segments, caret)
      const meta = segmentMetaMap[start.index]
      if (!meta) {
        primeSession(segments, 0, null)
        refreshSessionFromCache()
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
    if (range.from === range.to) {
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
      deps.getEditor()?.clearPlaybackHighlight?.()
      if (sessionSelectionScoped) {
        const fullSegments = splitTtsSegments(content)
        primeSession(fullSegments, 0, range)
        refreshSessionFromCache()
        return
      }
      const start = locateSegmentStartByCharOffset(segments, range.from)
      const meta = segmentMetaMap[start.index]
      if (!meta) {
        primeSession(segments, 0, range)
        refreshSessionFromCache()
        return
      }
      primeSession(segments, 0, range)
      const absoluteBase = segments[start.index]?.indexStart ?? 0
      const boundaries = highlightBoundaries(meta, [])
      if (boundaries.length === 0) {
        return
      }
      setResumePosition(start.index, locateCaretBoundaryAtOrBefore(boundaries, absoluteBase, range.from), false)
      return
    }
    // Collapsed selection is treated as caret positioning, not a playback scope.
    syncSelectionStart(null)
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
    if (matchesResume) {
      return true
    }
    if (sessionSelectionScoped !== hasNonEmptySelection(selectedRange)) {
      return false
    }
    return matchesOriginal
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
    activeInfoOffset = -1
    activeInfoKind = null
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
          updateHighlightForPosition(index, currentTime)
        }
        const selectWholeSegment = () => {
          const trimmed = trimWhitespaceRange(segment.text, 0, segment.text.length)
          applyPlaybackHighlight(absoluteBase + trimmed.start, absoluteBase + trimmed.end)
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
              applyPlaybackHighlight(absoluteBase + trimmed.start, absoluteBase + trimmed.end)
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
      activeInfoOffset = -1
      activeInfoKind = null
      lastStatusReason = 'finished'
      playbackEnded = true
      synthesizedCount = totalSegments
      resumeSegmentIndex = 0
      resumeSegmentTime = 0
      playedDuration = measuredTotal
      playbackElapsed = 0
      deps.getEditor()?.clearPlaybackHighlight?.()
      statusMessage = UI_TEXT[deps.settings.locale].playbackFinished
    } catch (error) {
      if (controller.cancelled) return
      currentController = null
      isPlaying = false
      activeInfoOffset = -1
      activeInfoKind = null
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
    const scopedSelection = hasNonEmptySelection(selectedRange) ? null : selectedRange
    primeSession(segments, 0, scopedSelection)
    refreshSessionFromCache()
  }

  function refreshSessionFromCache() {
    // Surface only already-cached segments so the status strip and slider can
    // appear without the Info panel; uncached synthesis stays deferred to Play.
    for (let index = 0; index < sessionSegments.length; index += 1) {
      const segment = sessionSegments[index]
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
    sessionSelectionScoped = hasNonEmptySelection(selectedRange)
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
    const selectedRange = editor.getSelectionRange()
    if (hasNonEmptySelection(selectedRange) && selectedRange) {
      deps.prepareForPlayback()
      await playSelectedText(selectedRange)
      return
    }
    if (sessionMatchesEditor(editor, content)) {
      playbackEnded = false
      deps.prepareForPlayback()
      await runPlayback(sessionSegments, sessionOffset, resumeSegmentIndex, resumeSegmentTime)
      return
    }
    const segments = splitTtsSegments(content)
    if (segments.length === 0) {
      return
    }
    const caretLikeOffset = selectedRange && selectedRange.from === selectedRange.to ? selectedRange.from : undefined
    const start =
      caretLikeOffset != null
        ? locateSegmentStartByCharOffset(segments, caretLikeOffset)
        : { index: 0, charOffset: undefined }
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
    kind: 'sentence' | 'word',
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

    const setIsolatedSelection = (start: number, end: number) => {
      const trimmed = trimWhitespaceRange(segment.text, start, end)
      if (trimmed.end <= trimmed.start) return false
      isolatedText = segment.text.slice(trimmed.start, trimmed.end)
      selFrom = absoluteBase + trimmed.start
      selTo = absoluteBase + trimmed.end
      return true
    }

    const wordBoundary = kind === 'word' ? meta.wordBoundaries?.find(b => meta.baseOffset + b.offset === charOffset) : undefined
    if (wordBoundary) {
      const raw = wordBoundary.text ?? ''
      if (raw.trim()) {
        setIsolatedSelection(wordBoundary.offset, wordBoundary.offset + raw.length)
      } else {
        // Whitespace‑only or empty label: fall back to the nearest highlight range
        // so the word‑play button still isolates a slice rather than becoming continuous playback.
        const fallbackRange =
          meta.ranges.find(r => wordBoundary.offset >= r.start && wordBoundary.offset < r.end) ?? meta.ranges[meta.ranges.length - 1]
        if (fallbackRange) {
          setIsolatedSelection(fallbackRange.start, fallbackRange.end)
        }
      }
    } else {
      // Sentence: try the exact highlight range that charOffset lands in first;
      // this avoids the synthetic‑row‑only heuristic and works for every row.
      const range = meta.ranges.find(r => meta.baseOffset + r.start === charOffset)
      if (range && setIsolatedSelection(range.start, range.end)) {
        // isolated slice built from the row's own range
      } else {
        // Fall back to boundary‑based slicing (existing logic)
        const boundary = meta.boundaries.find(b => meta.baseOffset + b.offset === charOffset)
        if (boundary) {
          const boundaryIndex = meta.boundaries.findIndex(b => b === boundary)
          const start = boundary.offset
          const end = meta.boundaries[boundaryIndex + 1]?.offset ?? meta.text.length
          if (!setIsolatedSelection(start, end)) {
            const fallbackRange =
              meta.ranges.find(r => boundary.offset >= r.start && boundary.offset < r.end) ?? meta.ranges[meta.ranges.length - 1]
            if (fallbackRange) {
              setIsolatedSelection(fallbackRange.start, fallbackRange.end)
            }
          }
        }
      }
    }

    if (!isolatedText) return false
    const fragmentText: string = isolatedText

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
    activeInfoOffset = charOffset
    activeInfoKind = kind
    currentSegmentIndex = segmentIndex + 1
    totalSegments = sessionSegments.length
    playbackElapsed = 0
    playbackDuration = 0

    // Highlight the isolated slice in the editor without touching native selection.
    if (selFrom >= 0 && selTo >= 0 && selFrom !== selTo) {
      applyPlaybackHighlight(selFrom, selTo)
    }

    try {
      const docId = deps.getCacheScopeId()
      const synth = await getCachedSynthesis(fragmentText, voice.edge, effectiveSpeed, controller.abort.signal, docId)
      if (controller.cancelled) return true
      const duration = await readAudioDuration(synth.blob, controller.abort.signal)
      if (controller.cancelled) return true
      currentSynthesisRate = effectiveSpeed
      metadataAvailable = (synth.boundaries.length > 0 || (synth.wordBoundaries?.length ?? 0) > 0)
      playbackDuration = duration
      // Play the isolated fragment only; do not continue to subsequent sentences.
      const spokenStart = synth.spokenStart ?? 0
      const spokenEnd = kind === 'word' ? undefined : synth.spokenEnd
      const fragmentRanges = splitHighlightRanges(fragmentText)
      const isolatedHighlights = highlightBoundaries(
        { wordBoundaries: synth.wordBoundaries, boundaries: synth.boundaries },
        synth.wordBoundaries?.length ? synth.wordBoundaries : synth.boundaries,
      )
      const applyIsolatedHighlight = (currentTime: number) => {
        if (isolatedHighlights.length === 0) return
        const relativeAt = currentTime - spokenStart
        const active = activeBoundaryAt(isolatedHighlights, relativeAt)
        if (active?.text) {
          const wordStart = active.offset
          const wordEnd = wordStart + active.text.length
          const trimmed = trimWhitespaceRange(fragmentText, wordStart, wordEnd)
          if (trimmed.end > trimmed.start) {
            applyPlaybackHighlight(selFrom + trimmed.start, selFrom + trimmed.end)
          }
          return
        }
        const activeRange = activeHighlightRange(fragmentRanges, isolatedHighlights, relativeAt)
        if (activeRange) {
          const trimmed = trimWhitespaceRange(fragmentText, activeRange.start, activeRange.end)
          if (trimmed.end > trimmed.start) {
            applyPlaybackHighlight(selFrom + trimmed.start, selFrom + trimmed.end)
          }
          return
        }
        // Fallback to the whole isolated fragment when metadata cannot map to
        // a more precise word or sentence range.
        const fallbackTrimmed = trimWhitespaceRange(fragmentText, 0, fragmentText.length)
        if (fallbackTrimmed.end > fallbackTrimmed.start) {
          applyPlaybackHighlight(selFrom + fallbackTrimmed.start, selFrom + fallbackTrimmed.end)
        }
      }
      await playAudioBlob(
        controller,
        synth.blob,
        isolatedHighlights.length > 0 ? applyIsolatedHighlight : undefined,
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
      activeInfoOffset = -1
      activeInfoKind = null
      lastStatusReason = 'finished'
      statusMessage = UI_TEXT[deps.settings.locale].playbackFinished
      playbackElapsed = 0
      if (selFrom >= 0 && selTo >= 0) {
        sessionResumeSelection = { from: selFrom, to: selTo }
      }
      deps.getEditor()?.clearPlaybackHighlight?.()
      return true
    } catch (error) {
      if (controller.cancelled) return true
      currentController = null
      isPlaying = false
      activeInfoOffset = -1
      activeInfoKind = null
      lastStatusReason = 'error'
      metadataAvailable = false
      deps.getEditor()?.clearPlaybackHighlight?.()
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
    playbackEnded = false
    stopPlayback()
    activeInfoOffset = -1
    activeInfoKind = null
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

  async function playSentence(index: number, charOffset: number) {
    if (voiceSwitching) return
    if (sessionSegments.length === 0) {
      return
    }
    const meta = segmentMetaMap[index]
    const segment = sessionSegments[index]
    if (!meta || !segment) {
      await playFromSegment(index, charOffset)
      return
    }
    playbackEnded = false
    stopPlayback()
    const handled = await playIsolatedFragment('sentence', index, charOffset, meta, segment)
    if (!handled) {
      await playFromSegment(index, charOffset)
    }
  }

  async function playWord(index: number, charOffset: number) {
    if (voiceSwitching) return
    if (sessionSegments.length === 0) {
      return
    }
    const meta = segmentMetaMap[index]
    const segment = sessionSegments[index]
    if (!meta || !segment) {
      await playFromSegment(index, charOffset)
      return
    }
    playbackEnded = false
    stopPlayback()
    const handled = await playIsolatedFragment('word', index, charOffset, meta, segment)
    if (!handled) {
      await playFromSegment(index, charOffset)
    }
  }

  function warmSelectionScope(range: { from: number; to: number }): boolean {
    const content = deps.settings.content
    const scoped = trimmedContentRange(range, content)
    if (!scoped) return false
    const reusable = buildReusableScopedSegments(scoped, content)
    if (reusable) {
      sessionSegments = reusable.map(segment => ({
        text: segment.text,
        lang: segment.lang,
        indexStart: segment.indexStart,
        indexEnd: segment.indexEnd,
      }))
      sessionOffset = 0
      sessionSelectedRange = range
      sessionSelectionScoped = true
      sessionSourceContent = content
      sessionResumeSelection = { from: scoped.from, to: scoped.to }
      totalSegments = sessionSegments.length
      deps.getEditor()?.clearPlaybackHighlight?.()
      clearSegments()
      for (let i = 0; i < reusable.length; i += 1) {
        const segment = reusable[i]
        recordSegment(
          i,
          buildSegmentMeta(
            i,
            sessionSegments[i],
            {
              boundaries: segment.boundaries,
              wordBoundaries: segment.wordBoundaries,
              spokenStart: 0,
              spokenEnd: Math.max(0, segment.sourceEndAt - segment.sourceStartAt),
              rate: effectiveSpeed,
            },
            segment.indexStart,
          ),
        )
      }
      if (Object.keys(segmentMetaMap).length === 0) return false
      metadataAvailable = true
      currentSegmentIndex = 1
      playbackElapsed = 0
      playbackDuration = segmentDurationAt(0)
      currentSynthesisRate = effectiveSpeed
      deps.getEditor()?.clearPlaybackHighlight?.()
      return true
    }
    const lang = splitTtsSegments(scoped.text)[0]?.lang ?? splitTtsSegments(content)[0]?.lang ?? 'en'
    const voice = resolveEffectiveVoice(lang)
    if (!voice?.edge) return false
    const cached = peekCachedSynthesis(scoped.text, voice.edge, effectiveSpeed)
    if (!cached) return false
    sessionSegments = [{ text: scoped.text, lang, indexStart: scoped.from, indexEnd: scoped.to - 1 }]
    sessionOffset = 0
    sessionSelectedRange = range
    sessionSelectionScoped = true
    sessionSourceContent = content
    sessionResumeSelection = { from: scoped.from, to: scoped.to }
    totalSegments = 1
    deps.getEditor()?.clearPlaybackHighlight?.()
    clearSegments()
    recordSegment(
      0,
      buildSegmentMeta(
        0,
        sessionSegments[0],
        {
          boundaries: cached.boundaries,
          wordBoundaries: cached.wordBoundaries,
          spokenStart: cached.spokenStart,
          spokenEnd: cached.spokenEnd,
          rate: effectiveSpeed,
        },
        scoped.from,
      ),
    )
    metadataAvailable = true
    currentSegmentIndex = 1
    playbackElapsed = 0
    playbackDuration = segmentDurationAt(0)
    currentSynthesisRate = effectiveSpeed
    deps.getEditor()?.clearPlaybackHighlight?.()
    return true
  }

  async function playSelectedText(range: { from: number; to: number }) {
    const content = deps.settings.content
    const scoped = trimmedContentRange(range, content)
    if (!scoped) {
      return
    }
    const editor = deps.getEditor()
    if (editor && sessionMatchesEditor(editor, content) && sessionSelectionScoped) {
      playbackEnded = false
      await runPlayback(sessionSegments, sessionOffset, resumeSegmentIndex, resumeSegmentTime)
      return
    }
    const fullSegments = splitTtsSegments(content)
    if (fullSegments.length === 0) {
      return
    }
    primeSession(fullSegments, 0, range)
    clearSegments()
    const lang = splitTtsSegments(scoped.text)[0]?.lang ?? splitTtsSegments(content)[0]?.lang ?? 'en'
    const voice = resolveEffectiveVoice(lang)
    if (!voice?.edge) {
      throw new LocalizedPlaybackError(
        `${UI_TEXT[deps.settings.locale].voiceNotConfigured} (${segmentLanguageName(deps.settings.locale, lang)})`,
      )
    }
    const reusable = buildReusableScopedSegments(scoped, content)
    if (reusable) {
      playbackEnded = false
      stopPlayback()
      activeInfoOffset = -1
      activeInfoKind = null
      sessionSegments = reusable.map(segment => ({
        text: segment.text,
        lang: segment.lang,
        indexStart: segment.indexStart,
        indexEnd: segment.indexEnd,
      }))
      sessionOffset = 0
      sessionSelectedRange = range
      sessionSelectionScoped = true
      sessionSourceContent = content
      sessionResumeSelection = { from: scoped.from, to: scoped.to }
      totalSegments = sessionSegments.length
      clearSegments()
      for (let i = 0; i < reusable.length; i += 1) {
        const segment = reusable[i]
        recordSegment(
          i,
          buildSegmentMeta(
            i,
            sessionSegments[i],
            {
              boundaries: segment.boundaries,
              wordBoundaries: segment.wordBoundaries,
              spokenStart: 0,
              spokenEnd: Math.max(0, segment.sourceEndAt - segment.sourceStartAt),
              rate: effectiveSpeed,
            },
            segment.indexStart,
          ),
        )
      }
      if (Object.keys(segmentMetaMap).length === 0) {
        // Fallback to single-segment synthesis if slicing produced nothing.
      } else {
        metadataAvailable = true
        currentSegmentIndex = 1
        playbackElapsed = 0
        playbackDuration = segmentDurationAt(0)
        currentSynthesisRate = effectiveSpeed
        updateHighlightForPosition(0, 0)
        const controller: PlaybackController = { cancelled: false, abort: new AbortController() }
        currentController = controller
        isPlaying = true
        lastStatusReason = 'ready'
        try {
          measuredTotal = 0
          playedDuration = 0
          for (let idx = 0; idx < reusable.length; idx += 1) {
            if (controller.cancelled) return
            const segment = reusable[idx]
            const segVoice = resolveEffectiveVoice(segment.lang)
            if (!segVoice?.edge) {
              throw new LocalizedPlaybackError(
                `${UI_TEXT[deps.settings.locale].voiceNotConfigured} (${segmentLanguageName(deps.settings.locale, segment.lang)})`,
              )
            }
            const cached = peekCachedSynthesis(segment.source.text, segVoice.edge, effectiveSpeed)
            if (!cached) {
              throw new Error('Scoped playback lost its source cache entry')
            }
            const meta = segmentMetaMap[idx]
            if (!meta) continue
            currentSegmentIndex = idx + 1
            playbackDuration = segmentDurationAt(idx)
            playbackElapsed = 0
            // Highlight will be driven per word via the sliced word boundaries.
            const segHighlights = highlightBoundaries(meta, meta.wordBoundaries ?? [])
            if (segHighlights.length > 0) updateHighlightForPosition(idx, 0)
            else {
              const trimmed = trimWhitespaceRange(segment.text, 0, segment.text.length)
              applyPlaybackHighlight(segment.indexStart + trimmed.start, segment.indexStart + trimmed.end)
            }
            // Play only the selected whole-word slice on the source blob timeline.
            const slicedStartOrig = segment.sourceStartAt
            const slicedEndOrig = segment.sourceEndAt
            await playAudioBlob(controller, cached.blob, (currentTime) => {
              const rel = currentTime - slicedStartOrig
              updateHighlightForPosition(idx, rel)
            }, d => setSegmentDuration(idx, d), 0, slicedStartOrig, slicedEndOrig)
            if (controller.cancelled) return
            measuredTotal += segmentDurationAt(idx)
            playedDuration = measuredTotal
          }
          currentController = null
          isPlaying = false
          lastStatusReason = 'finished'
          playbackEnded = true
          deps.getEditor()?.clearPlaybackHighlight?.()
          statusMessage = UI_TEXT[deps.settings.locale].playbackFinished
          playbackElapsed = 0
        } catch (error) {
          if (controller.cancelled) return
          currentController = null
          isPlaying = false
          lastStatusReason = 'error'
          metadataAvailable = false
          deps.getEditor()?.clearPlaybackHighlight?.()
          console.error(error)
          statusMessage = error instanceof LocalizedPlaybackError ? error.message : UI_TEXT[deps.settings.locale].playbackFailed
        }
        return
      }
    }
    playbackEnded = false
    stopPlayback()
    activeInfoOffset = -1
    activeInfoKind = null
    sessionSegments = [{ text: scoped.text, lang, indexStart: scoped.from, indexEnd: scoped.to - 1 }]
    sessionOffset = 0
    sessionSelectedRange = range
    sessionSelectionScoped = true
    sessionSourceContent = content
    sessionResumeSelection = { from: scoped.from, to: scoped.to }
    totalSegments = 1
    clearSegments()
    const controller: PlaybackController = { cancelled: false, abort: new AbortController() }
    currentController = controller
    isPlaying = true
    lastStatusReason = 'ready'
    currentSegmentIndex = 1
    playbackElapsed = 0
    playbackDuration = 0
    try {
      const synth = await getCachedSynthesis(scoped.text, voice.edge, effectiveSpeed, controller.abort.signal, deps.getCacheScopeId())
      if (controller.cancelled) return
      const duration = await readAudioDuration(synth.blob, controller.abort.signal)
      if (controller.cancelled) return
      currentSynthesisRate = effectiveSpeed
      metadataAvailable = (synth.boundaries.length > 0 || (synth.wordBoundaries?.length ?? 0) > 0)
      playbackDuration = duration
      const scopedMeta: SegmentMeta = {
        index: 0,
        lang,
        text: scoped.text,
        ranges: splitHighlightRanges(scoped.text),
        boundaries: synth.boundaries,
        wordBoundaries: synth.wordBoundaries ?? [],
        baseOffset: scoped.from,
        duration,
        spokenStart: synth.spokenStart,
        spokenEnd: synth.spokenEnd,
        rate: effectiveSpeed,
      }
      recordSegment(0, scopedMeta)
      const scopedHighlights = highlightBoundaries(scopedMeta, scopedMeta.wordBoundaries ?? scopedMeta.boundaries)
      const applyHighlight = (currentTime: number) => {
        const relativeAt = currentTime - (synth.spokenStart ?? 0)
        updateHighlightForPosition(0, relativeAt)
      }
      if (scopedHighlights.length > 0) {
        updateHighlightForPosition(0, 0)
      } else {
        applyPlaybackHighlight(scoped.from, scoped.to)
      }
      await playAudioBlob(
        controller,
        synth.blob,
        applyHighlight,
        d => {
          playbackDuration = d
          setSegmentDuration(0, d)
        },
        0,
        synth.spokenStart ?? 0,
        synth.spokenEnd,
      )
      if (controller.cancelled) return
      currentController = null
      isPlaying = false
      lastStatusReason = 'finished'
      playbackEnded = true
      deps.getEditor()?.clearPlaybackHighlight?.()
      statusMessage = UI_TEXT[deps.settings.locale].playbackFinished
      playbackElapsed = 0
    } catch (error) {
      if (controller.cancelled) return
      currentController = null
      isPlaying = false
      lastStatusReason = 'error'
      metadataAvailable = false
      deps.getEditor()?.clearPlaybackHighlight?.()
      console.error(error)
      statusMessage =
        error instanceof LocalizedPlaybackError ? error.message : UI_TEXT[deps.settings.locale].playbackFailed
    }
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
    sessionSelectionScoped = false
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
    get isSelectionScoped() {
      return sessionSelectionScoped
    },
    get activeInfoOffset() {
      return activeInfoOffset
    },
    get activeInfoKind() {
      return activeInfoKind
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
    playSentence,
    playWord,
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
