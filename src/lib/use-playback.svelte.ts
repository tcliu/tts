import {
  activeHighlightRange,
  REFERENCE_LANGUAGES,
  splitHighlightRanges,
  splitTtsSegments,
  toWrittenLang,
  type HighlightRange,
  type TtsBoundary,
  type TtsSegment,
  type TtsVoice,
} from './tts-reference'
import {
  getCachedSynthesis,
  isSynthesisCacheHydrated,
  onSynthesisCacheHydrated,
  peekCachedSynthesis,
} from './tts-client'
import { CANONICAL_SYNTHESIS_RATE, canonicalRate } from './tts-cache-key'
import { UI_TEXT, segmentLanguageName, type UiLocale } from './ui-text'
import {
  hasNonEmptySelection,
  trimmedContentRange,
  buildReusableScopedSegments as buildReusableScopedSegmentsImpl,
  type ReusableScopedSegment,
} from './playback/selection-scope'
import {
  locatePlaybackPosition as locatePlaybackPositionPure,
  mediaAtForScaled as mediaAtForScaledPure,
  scaledAtForMedia as scaledAtForMediaPure,
  scaledDurationAt as scaledDurationAtPure,
  segmentDurationAt as segmentDurationAtPure,
} from './playback/progress'
import {
  locateCaretBoundaryAtOrBefore as locateCaretBoundaryAtOrBeforeImpl,
  charOffsetAtPosition as charOffsetAtPositionImpl,
  resumeTimeForCharOffset as resumeTimeForCharOffsetImpl,
} from './playback/voice-remap'
import { createAudioPlayer } from './playback/audio'
import { getHighlightRangeForPosition } from './playback/highlight'
import { createVoiceSwitch } from './playback/voice-switch'
import { buildSegmentMeta } from './playback/segment-meta'
import { createEmptySession, type PlaybackSession } from './playback/session'
import { LocalizedPlaybackError } from './playback/types'
import { createIsolatedPlayer } from './playback/isolated'
import { createSelectionSync } from './playback/selection'
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

import type { SegmentMeta, PlaybackController } from './playback/types'
export type { SegmentMeta, PlaybackController } from './playback/types'

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
  readonly positionVoiceEdge: string
  readonly positionSegmentLang: string
  readonly positionLanguageCode: string
  readonly positionSegmentText: string
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
  readonly currentSessionSegment: TtsSegment | null
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
  let playbackElapsed = $state(0)
  let playbackDuration = $state(0)
  let statusMessage = $state(UI_TEXT[deps.settings.locale].ready)

  let lastStatusReason = $state<'ready' | 'stopped' | 'switching' | 'finished' | 'error'>('ready')
  let playbackEnded = $state(false)
  let currentController: PlaybackController | null = null
  let currentAudio = $state<HTMLAudioElement | null>(null)
  let currentAudioUrl = ''

  let metadataAvailable = $state(false)

  const playAudioBlob = createAudioPlayer({
    getLocale: () => deps.settings.locale,
    getCurrentAudio: () => currentAudio,
    setCurrentAudio: value => { currentAudio = value },
    getCurrentAudioUrl: () => currentAudioUrl,
    setCurrentAudioUrl: value => { currentAudioUrl = value },
    setPlaybackElapsed: value => { playbackElapsed = value },
    setPlaybackDuration: value => { playbackDuration = value },
  })
  let activeInfoOffset = $state(-1)
  let activeInfoKind = $state<'sentence' | 'word' | null>(null)

  let segmentMetaMap = $state<Record<number, SegmentMeta>>({})
  let session = $state<PlaybackSession>(createEmptySession())
  let currentSplitToken: object | null = null
  let applyingResumeSelection = false
  let suppressSelectionCounter = 0
  let selectionSync: ReturnType<typeof createSelectionSync> | null = null

  const effectiveSpeed = $derived(session.speed ?? deps.settings.speed)
  const playbackSpeed = $derived(effectiveSpeed)

  // True while a mid-playback voice switch has paused playback and is still
  // synthesizing the current segment for the new voice. Gates Play so a
  // second playback loop cannot race the pending resume.
  let voiceSwitching = $state(false)
  // Bumped by every stop/session invalidation; a pending switch resume whose
  // generation no longer matches is abandoned.
  let voiceSwitchGeneration = 0

  // Wrappers that bind the current session state to the extracted pure helpers
  // in src/lib/playback/selection-scope.ts. Keeping them local preserves the
  // existing call sites while the helpers themselves live in a dedicated module
  // per references/svelte.md composable extraction.
  function buildReusableScopedSegments(scoped: { from: number; to: number }, content: string): ReusableScopedSegment[] | null {
    return buildReusableScopedSegmentsImpl(scoped, content, {
      peekCachedSynthesis,
      resolveEffectiveVoice,
      sessionSegments: session.segments,
      segmentMetaMap,
    })
  }

  function applyPlaybackHighlight(from: number, to: number) {
    const editor = deps.getEditor()
    if (!editor) return
    const useSelected =
      session.selectionScoped &&
      session.selectedRange &&
      from >= session.selectedRange.from &&
      to <= session.selectedRange.to &&
      !!editor.setPlaybackHighlightSelected
    if (useSelected) {
      editor.setPlaybackHighlightSelected?.(from, to)
    } else {
      editor.setPlaybackHighlight?.(from, to)
    }
  }

  function effectiveSegmentLang(index: number): string {
    if (index < 0 || index >= session.segments.length) return ''
    return session.langOverrides.get(index) ?? session.segments[index]?.lang ?? ''
  }

  function resolveEffectiveVoiceForWrittenLang(languageCode: string): TtsVoice | undefined {
    const overrideEdge = session.voiceSelections.get(languageCode)
    if (overrideEdge) {
      const voice = REFERENCE_LANGUAGES.find(item => item.code === languageCode)?.voices.find(
        item => item.edge === overrideEdge,
      )
      if (voice) return voice
    }
    return deps.settings.resolveVoiceForSegment(languageCode)
  }

  function resolveEffectiveVoice(segmentLang: string): TtsVoice | undefined {
    return resolveEffectiveVoiceForWrittenLang(toWrittenLang(segmentLang))
  }

  function pinVoiceForWrittenLang(languageCode: string, edge: string) {
    if (!edge) return
    if (session.voiceSelections.has(languageCode)) return
    const next = new Map(session.voiceSelections)
    next.set(languageCode, edge)
    session.voiceSelections = next
  }

  function pinVoicesForSegments(segments: { lang: string }[]) {
    for (const segment of segments) {
      const written = toWrittenLang(segment.lang)
      if (session.voiceSelections.has(written)) continue
      const edge = resolveEffectiveVoice(segment.lang)?.edge
      if (edge) pinVoiceForWrittenLang(written, edge)
    }
  }

  // Plain Map (not $state) — only read imperatively in launch/resynthesize/
  // playback loop. Generations are monotonic and intentionally never cleared;
  // stale tasks from prior runs are already guarded by `controller.cancelled`.
  // Bumped when a segment is re-synthesized outside the playback pipeline so
  // a queued task launched earlier can neither record stale meta nor play
  // stale audio.
  let taskGeneration = new Map<number, number>()

  const totalDuration = $derived.by(() => {
    void session.gen
    let total = 0
    for (let i = 0; i < session.segments.length; i += 1) {
      total += scaledDurationAt(i)
    }
    return total
  })

  const totalElapsed = $derived.by(() => {
    void session.gen
    if (session.segments.length === 0) return 0
    // Scaled elapsed = scaled completed + scaled current, using real wall time
    const curIdx = currentSegmentIndex > 0 ? currentSegmentIndex - 1 : session.resumeIndex
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
  const positionLanguageCode = $derived(toWrittenLang(positionSegmentLang))
  const positionVoice = $derived.by(() =>
    positionLanguageCode ? resolveEffectiveVoiceForWrittenLang(positionLanguageCode) : undefined,
  )
  const positionVoiceName = $derived(positionVoice?.name ?? '')
  const positionVoiceGender = $derived(positionVoice?.gender ?? '')
  const positionVoiceLocale = $derived(positionVoice ? positionVoice.edge.split('-').slice(0, 2).join('-') : '')
  const positionVoiceEdge = $derived(positionVoice?.edge ?? '')
  const positionSegmentText = $derived.by(() => {
    const segment = positionSegmentIndex >= 0 ? session.segments[positionSegmentIndex] : undefined
    return segment?.text ?? ''
  })

  function statusForReason(reason: typeof lastStatusReason, locale: UiLocale): string {
    const strings = UI_TEXT[locale]
    if (reason === 'stopped') return strings.playbackStopped
    if (reason === 'switching') return strings.voiceSwitching
    if (reason === 'finished') return strings.playbackFinished
    if (reason === 'error') return strings.playbackFailed
    return strings.ready
  }

  $effect(() => {
    if (isPlaying) {
      return
    }
    statusMessage = statusForReason(lastStatusReason, deps.settings.locale)
  })

  $effect(() => {
    if (isPlaying && currentAudio) {
      const idx = currentSegmentIndex - 1
      const segRate = segmentMetaMap[idx]?.rate ?? CANONICAL_SYNTHESIS_RATE
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
    selectionSync?.invalidatePendingSeek()
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
      session.resumeIndex = 0
      session.resumeTime = 0
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
    return segmentDurationAtPure(segmentMetaMap, index)
  }

  function scaledDurationAt(index: number): number {
    return scaledDurationAtPure(segmentMetaMap, effectiveSpeed, index)
  }

  function scaledAtForMedia(index: number, mediaAt: number): number {
    return scaledAtForMediaPure(segmentMetaMap, effectiveSpeed, index, mediaAt)
  }

  function mediaAtForScaled(index: number, scaledAt: number): number {
    return mediaAtForScaledPure(segmentMetaMap, effectiveSpeed, index, scaledAt)
  }

  function rememberResumePosition() {
    session.resumeIndex = Math.max(0, currentSegmentIndex - 1)
    const audioAt = currentAudio
      ? Math.max(0, currentAudio.currentTime - (segmentMetaMap[session.resumeIndex]?.spokenStart ?? 0))
      : playbackElapsed
    const nudgedAt = audioAt > RESUME_EPSILON ? audioAt + RESUME_EPSILON : audioAt
    const segmentDuration = segmentDurationAt(session.resumeIndex)
    session.resumeTime = segmentDuration > 0 ? Math.min(Math.max(0, nudgedAt), segmentDuration) : Math.max(0, nudgedAt)
    session.resumeSelection = deps.getEditor()?.getSelectionRange() ?? null
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
    const segment = session.segments[index]
    if (!segment) return null
    const absoluteBase = session.offset + segment.indexStart
    const range = getHighlightRangeForPosition(meta, segment, at, absoluteBase)
    if (!range) return null
    applyPlaybackHighlight(range.from, range.to)
    return range
  }

  function ensureSegments(content: string): ReturnType<typeof splitTtsSegments> {
    const contentChanged = session.sourceContent !== content
    if (session.segments.length > 0 && !contentChanged) return session.segments
    return splitTtsSegments(content)
  }

  function resolveScopedPlaybackLang(scopedText: string, content: string): string {
    return splitTtsSegments(scopedText)[0]?.lang ?? splitTtsSegments(content)[0]?.lang ?? 'en'
  }

  function applyScopedSession(input: {
    segments: ReturnType<typeof splitTtsSegments>
    range: { from: number; to: number }
    content: string
    resumeSelection: { from: number; to: number }
  }) {
    const { segments, range, content, resumeSelection } = input
    session.segments = segments
    currentSplitToken = segments
    session.offset = 0
    session.selectedRange = range
    session.selectionScoped = true
    session.sourceContent = content
    session.resumeSelection = resumeSelection
    totalSegments = segments.length
  }

  function finishPlaybackRun(options?: { resetResume?: boolean; clearActiveInfo?: boolean; updateSynthesizedCount?: boolean }) {
    currentController = null
    isPlaying = false
    if (options?.clearActiveInfo ?? true) {
      activeInfoOffset = -1
      activeInfoKind = null
    }
    lastStatusReason = 'finished'
    playbackEnded = true
    if (options?.updateSynthesizedCount) {
      synthesizedCount = totalSegments
    }
    if (options?.resetResume) {
      session.resumeIndex = 0
      session.resumeTime = 0
    }
    playedDuration = measuredTotal
    playbackElapsed = 0
    deps.getEditor()?.clearPlaybackHighlight?.()
    statusMessage = UI_TEXT[deps.settings.locale].playbackFinished
  }

  function failPlaybackRun(error: unknown, options?: { clearActiveInfo?: boolean; clearHighlight?: boolean }) {
    currentController = null
    isPlaying = false
    if (options?.clearActiveInfo ?? true) {
      activeInfoOffset = -1
      activeInfoKind = null
    }
    lastStatusReason = 'error'
    metadataAvailable = false
    if (options?.clearHighlight ?? true) {
      deps.getEditor()?.clearPlaybackHighlight?.()
    }
    console.error(error)
    statusMessage = error instanceof LocalizedPlaybackError ? error.message : UI_TEXT[deps.settings.locale].playbackFailed
  }

  function recordSegmentMeta(index: number, meta: SegmentMeta) {
    recordSegment(index, meta)
    if (meta.boundaries.length > 0 || (meta.wordBoundaries?.length ?? 0) > 0) {
      metadataAvailable = true
    }
  }

  function setResumePosition(index: number, at: number, applySelection = true) {
    if (session.segments.length === 0) return
    const clampedIndex = Math.max(0, Math.min(index, session.segments.length - 1))
    let accumulated = 0
    for (let i = 0; i < clampedIndex; i += 1) {
      accumulated += segmentDurationAt(i)
    }
    const segmentDuration = segmentDurationAt(clampedIndex)
    const clampedAt = segmentDuration > 0 ? Math.min(Math.max(0, at), segmentDuration) : Math.max(0, at)
    session.resumeIndex = clampedIndex
    session.resumeTime = clampedAt
    currentSegmentIndex = clampedIndex + 1
    totalSegments = session.segments.length
    measuredTotal = accumulated
    playedDuration = accumulated
    playbackElapsed = clampedAt
    playbackDuration = segmentDuration
    if (!applySelection) return
    session.resumeSelection = updateHighlightForPosition(clampedIndex, clampedAt) ?? session.resumeSelection
  }

  function locateCaretBoundaryAtOrBefore(
    boundaries: TtsBoundary[],
    absoluteBase: number,
    caretOffset: number,
  ): number {
    return locateCaretBoundaryAtOrBeforeImpl(boundaries, absoluteBase, caretOffset)
  }

  function charOffsetAtPosition(index: number, at: number): number {
    return charOffsetAtPositionImpl(
      segmentMetaMap[index],
      session.segments[index],
      at,
      segmentDurationAt(index),
    )
  }

  function resumeTimeForCharOffset(index: number, charOffset: number): number {
    return resumeTimeForCharOffsetImpl(
      segmentMetaMap[index],
      session.segments[index],
      charOffset,
      session.offset,
      segmentDurationAt(index),
    )
  }

  function sessionMatchesEditor(editor: CodeEditorHandle, content: string): boolean {
    if (session.segments.length === 0 || session.sourceContent !== content) {
      return false
    }
    const selectedRange = editor.getSelectionRange()
    const matchesOriginal =
      (selectedRange?.from ?? null) === (session.selectedRange?.from ?? null) &&
      (selectedRange?.to ?? null) === (session.selectedRange?.to ?? null)
    const matchesResume =
      (selectedRange?.from ?? null) === (session.resumeSelection?.from ?? null) &&
      (selectedRange?.to ?? null) === (session.resumeSelection?.to ?? null)
    if (matchesResume) {
      return true
    }
    if (session.selectionScoped !== hasNonEmptySelection(selectedRange)) {
      return false
    }
    return matchesOriginal
  }

  function locatePlaybackPosition(scaledElapsed: number): { index: number; startAt: number } | null {
    return locatePlaybackPositionPure({
      segments: session.segments,
      metaMap: segmentMetaMap,
      effectiveSpeed,
      totalDuration,
      scaledElapsed,
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
          const rate = CANONICAL_SYNTHESIS_RATE
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
              voiceEdge: voice.edge,
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
          // Pin the voice for this language so the chip stays on the synthesized
          // voice after playback (default before synthesis, sticky after). Manual
          // picks overwrite the pin; cache clear wipes it via resetSession.
          pinVoiceForWrittenLang(toWrittenLang(res.effectiveLang), res.voiceEdge)
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
      finishPlaybackRun({ resetResume: true, clearActiveInfo: true, updateSynthesizedCount: true })
    } catch (error) {
      if (controller.cancelled) return
      failPlaybackRun(error, { clearActiveInfo: true, clearHighlight: false })
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
    const scopedSelection = hasNonEmptySelection(selectedRange) ? selectedRange : null
    primeSession(segments, 0, scopedSelection)
    refreshSessionFromCache()
  }

  function refreshSessionFromCache() {
    // Surface only already-cached segments so the status strip and slider can
    // appear without the Info panel; uncached synthesis stays deferred to Play.
    // Resolve through the effective voice (pinned + default) so a manual chip
    // pick is respected, and pin the voice after a hit so the chip stays sticky.
    for (let index = 0; index < session.segments.length; index += 1) {
      const segment = session.segments[index]
      const voice = resolveEffectiveVoice(segment.lang)
      if (!voice?.edge) {
        continue
      }
      const cached = peekCachedSynthesis(segment.text, voice.edge)
      if (!cached) {
        continue
      }
      recordSegmentMeta(
        index,
        buildSegmentMeta(
          index,
          segment,
          {
            boundaries: cached.boundaries,
            wordBoundaries: cached.wordBoundaries,
            spokenStart: cached.spokenStart,
            spokenEnd: cached.spokenEnd,
            rate: cached.rate ?? CANONICAL_SYNTHESIS_RATE,
          },
          segment.indexStart,
        ),
      )
      pinVoiceForWrittenLang(toWrittenLang(segment.lang), voice.edge)
    }
    metadataAvailable = Object.keys(segmentMetaMap).length > 0
  }

  function primeSession(
    segments: ReturnType<typeof splitTtsSegments>,
    offset: number,
    selectedRange: { from: number; to: number } | null = null,
  ) {
    // A new split invalidates index-keyed overrides from the prior session;
    // keep them only when the reference array is the same object. Use a plain
    // ref outside $state to preserve reference equality (Svelte proxies would
    // break `===` for $state arrays).
    const isSameRef = segments === currentSplitToken
    if (!isSameRef) {
      session.langOverrides = new Map()
      session.voiceSelections = new Map()
      session.speed = null
    }
    session.segments = segments
    currentSplitToken = segments
    session.offset = offset
    session.selectedRange = selectedRange
    session.selectionScoped = hasNonEmptySelection(selectedRange)
    session.sourceContent = deps.settings.content
    session.resumeSelection = selectedRange
    session.resumeIndex = 0
    session.resumeTime = 0
    totalSegments = segments.length
    if (!isSameRef) session.gen += 1
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
      await runPlayback(session.segments, session.offset, session.resumeIndex, session.resumeTime)
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
      await runPlayback(session.segments, session.offset, position.index, position.startAt)
      return
    }
    playbackEnded = false
    setResumePosition(position.index, position.startAt)
  }

  const isolatedPlayer = createIsolatedPlayer({
    getSessionOffset: () => session.offset,
    getEffectiveSegmentLang: effectiveSegmentLang,
    getResolveEffectiveVoice: resolveEffectiveVoice,
    getEffectiveSpeed: () => effectiveSpeed,
    getCacheScopeId: () => deps.getCacheScopeId(),
    getLocale: () => deps.settings.locale,
    getCurrentController: () => currentController,
    setCurrentController: v => { currentController = v },
    getIsPlaying: () => isPlaying,
    setIsPlaying: v => { isPlaying = v },
    getPlaybackEnded: () => playbackEnded,
    setPlaybackEnded: v => { playbackEnded = v },
    getLastStatusReason: () => lastStatusReason,
    setLastStatusReason: v => { lastStatusReason = v },
    getActiveInfoOffset: () => activeInfoOffset,
    setActiveInfoOffset: v => { activeInfoOffset = v },
    getActiveInfoKind: () => activeInfoKind,
    setActiveInfoKind: v => { activeInfoKind = v },
    getCurrentSegmentIndex: () => currentSegmentIndex,
    setCurrentSegmentIndex: v => { currentSegmentIndex = v },
    getTotalSegments: () => totalSegments,
    setTotalSegments: v => { totalSegments = v },
    getPlaybackElapsed: () => playbackElapsed,
    setPlaybackElapsed: v => { playbackElapsed = v },
    getPlaybackDuration: () => playbackDuration,
    setPlaybackDuration: v => { playbackDuration = v },
    getSessionSegments: () => session.segments,
    getSegmentMetaMap: () => segmentMetaMap,
    getSessionResumeSelection: () => session.resumeSelection,
    setSessionResumeSelection: v => { session.resumeSelection = v },
    getMetadataAvailable: () => metadataAvailable,
    setMetadataAvailable: v => { metadataAvailable = v },
    getStatusMessage: () => statusMessage,
    setStatusMessage: v => { statusMessage = v },
    getEditor: () => deps.getEditor(),
    applyPlaybackHighlight,
    playAudioBlob,
  })
  const playIsolatedFragment = isolatedPlayer.playIsolatedFragment

  async function playFromSegment(index: number, charOffset?: number) {
    // Inert while a voice switch owns playback: starting a session here would
    // race the switch's pending resume for the same segment.
    if (voiceSwitching) return
    if (session.segments.length === 0) {
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
    await runPlayback(session.segments, session.offset, index, startAt)
  }

  async function playSentence(index: number, charOffset: number) {
    if (voiceSwitching) return
    if (session.segments.length === 0) {
      return
    }
    const meta = segmentMetaMap[index]
    const segment = session.segments[index]
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
    if (session.segments.length === 0) {
      return
    }
    const meta = segmentMetaMap[index]
    const segment = session.segments[index]
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

  function recordReusableScopedMeta(reusable: NonNullable<ReturnType<typeof buildReusableScopedSegments>>) {
    for (let i = 0; i < reusable.length; i += 1) {
      const segment = reusable[i]
      recordSegmentMeta(
        i,
        buildSegmentMeta(
          i,
          session.segments[i],
          {
            boundaries: segment.boundaries,
            wordBoundaries: segment.wordBoundaries,
            spokenStart: 0,
            spokenEnd: Math.max(0, segment.sourceEndAt - segment.sourceStartAt),
            rate: CANONICAL_SYNTHESIS_RATE,
          },
          segment.indexStart,
        ),
      )
    }
  }

  function finalizeScopedWarmup(
    reusable: ReturnType<typeof buildReusableScopedSegments> | null,
    lang: string | null,
  ) {
    metadataAvailable = true
    currentSegmentIndex = 1
    playbackElapsed = 0
    playbackDuration = segmentDurationAt(0)
    deps.getEditor()?.clearPlaybackHighlight?.()
    if (reusable) pinVoicesForSegments(reusable)
    else if (lang) pinVoiceForWrittenLang(toWrittenLang(lang), resolveEffectiveVoice(lang)?.edge ?? '')
  }

  function warmSelectionScope(range: { from: number; to: number }): boolean {
    const content = deps.settings.content
    const scoped = trimmedContentRange(range, content)
    if (!scoped) return false
    const reusable = buildReusableScopedSegments(scoped, content)
    if (reusable) {
      const newSegments = reusable.map(segment => ({
        text: segment.text,
        lang: segment.lang,
        indexStart: segment.indexStart,
        indexEnd: segment.indexEnd,
      }))
      applyScopedSession({ segments: newSegments, range, content, resumeSelection: { from: scoped.from, to: scoped.to } })
      deps.getEditor()?.clearPlaybackHighlight?.()
      clearSegments()
      recordReusableScopedMeta(reusable)
      if (Object.keys(segmentMetaMap).length === 0) return false
      finalizeScopedWarmup(reusable, null)
      return true
    }
    const lang = resolveScopedPlaybackLang(scoped.text, content)
    const voice = resolveEffectiveVoice(lang)
    if (!voice?.edge) return false
    const cached = peekCachedSynthesis(scoped.text, voice.edge)
    if (!cached) return false
    applyScopedSession({
      segments: [{ text: scoped.text, lang, indexStart: scoped.from, indexEnd: scoped.to - 1 }],
      range,
      content,
      resumeSelection: { from: scoped.from, to: scoped.to },
    })
    deps.getEditor()?.clearPlaybackHighlight?.()
    clearSegments()
    recordSegmentMeta(
      0,
      buildSegmentMeta(
        0,
        session.segments[0],
        {
          boundaries: cached.boundaries,
          wordBoundaries: cached.wordBoundaries,
          spokenStart: cached.spokenStart,
          spokenEnd: cached.spokenEnd,
          rate: canonicalRate(cached.rate),
        },
        scoped.from,
      ),
    )
    finalizeScopedWarmup(null, lang)
    return true
  }

  selectionSync = createSelectionSync({
    session: {
      getSession: () => session,
      getSegmentMetaMap: () => segmentMetaMap,
      ensureSegments,
      primeSession,
      refreshSessionFromCache,
      clearSegments,
      resetSession,
      setResumePosition,
      warmSelectionScope,
    },
    playback: {
      getIsPlaying: () => isPlaying,
      isSuppressed: isSelectionSyncSuppressed,
      getPlaybackEnded: () => playbackEnded,
      setPlaybackEnded: value => { playbackEnded = value },
      stopPlayback,
      runPlayback,
      locateCaretBoundaryAtOrBefore,
    },
    editor: {
      getEditor: deps.getEditor,
      getContent: () => deps.settings.content,
    },
  })

  function syncSelectionStart(range: { from: number; to: number } | null): void {
    selectionSync!.syncSelectionStart(range)
  }

  async function playSelectedText(range: { from: number; to: number }) {
    const content = deps.settings.content
    const scoped = trimmedContentRange(range, content)
    if (!scoped) {
      return
    }
    const editor = deps.getEditor()
    if (editor && sessionMatchesEditor(editor, content) && session.selectionScoped) {
      if (session.segments.length === 1) {
        playbackEnded = false
        await runPlayback(session.segments, session.offset, session.resumeIndex, session.resumeTime)
        return
      }
      const reusableForReuse = buildReusableScopedSegments(scoped, content)
      if (
        reusableForReuse &&
        session.segments.length === reusableForReuse.length &&
        session.segments.every((seg, idx) => seg.text === reusableForReuse[idx].text)
      ) {
        playbackEnded = false
        await runPlayback(session.segments, session.offset, session.resumeIndex, session.resumeTime)
        return
      }
    }
    const lang = resolveScopedPlaybackLang(scoped.text, content)
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
      const newSegments = reusable.map(segment => ({
        text: segment.text,
        lang: segment.lang,
        indexStart: segment.indexStart,
        indexEnd: segment.indexEnd,
      }))
      applyScopedSession({ segments: newSegments, range, content, resumeSelection: { from: scoped.from, to: scoped.to } })
      clearSegments()
      for (let i = 0; i < reusable.length; i += 1) {
        const segment = reusable[i]
        recordSegmentMeta(
          i,
          buildSegmentMeta(
            i,
            session.segments[i],
            {
              boundaries: segment.boundaries,
              wordBoundaries: segment.wordBoundaries,
              spokenStart: 0,
              spokenEnd: Math.max(0, segment.sourceEndAt - segment.sourceStartAt),
              rate: CANONICAL_SYNTHESIS_RATE,
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
        pinVoicesForSegments(reusable)
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
            const cached = peekCachedSynthesis(segment.source.text, segVoice.edge)
            if (!cached) {
              throw new Error('Scoped playback lost its source cache entry')
            }
            const meta = segmentMetaMap[idx]
            if (!meta) continue
            currentSegmentIndex = idx + 1
            playbackDuration = segmentDurationAt(idx)
            playbackElapsed = 0
            // Highlight will be driven per word via the sliced word boundaries.
            const segHighlights = highlightBoundaries(meta)
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
          finishPlaybackRun({ clearActiveInfo: false })
        } catch (error) {
          if (controller.cancelled) return
          failPlaybackRun(error, { clearActiveInfo: false, clearHighlight: true })
        }
        return
      }
    }
    playbackEnded = false
    stopPlayback()
    activeInfoOffset = -1
    activeInfoKind = null
    applyScopedSession({
      segments: [{ text: scoped.text, lang, indexStart: scoped.from, indexEnd: scoped.to - 1 }],
      range,
      content,
      resumeSelection: { from: scoped.from, to: scoped.to },
    })
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
      metadataAvailable = (synth.boundaries.length > 0 || (synth.wordBoundaries?.length ?? 0) > 0)
      playbackDuration = duration
      const scopedMeta = buildSegmentMeta(
        0,
        session.segments[0],
        {
          boundaries: synth.boundaries,
          wordBoundaries: synth.wordBoundaries ?? [],
          duration,
          spokenStart: synth.spokenStart,
          spokenEnd: synth.spokenEnd,
          rate: synth.rate ?? CANONICAL_SYNTHESIS_RATE,
        },
        scoped.from,
      )
      recordSegmentMeta(0, scopedMeta)
      pinVoiceForWrittenLang(toWrittenLang(lang), voice.edge)
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
      finishPlaybackRun({ clearActiveInfo: false })
    } catch (error) {
      if (controller.cancelled) return
      failPlaybackRun(error, { clearActiveInfo: false, clearHighlight: true })
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
    totalSegments = session.segments.length
    playedDuration = 0
    measuredTotal = 0
    playbackElapsed = 0
    playbackDuration = 0
    metadataAvailable = false
    selectionSync?.invalidatePendingSeek()
  }

  function resetSession() {
    stopPlayback()
    {
      const empty: ReturnType<typeof splitTtsSegments> = []
      session.segments = empty
      currentSplitToken = empty
    }
    session.offset = 0
    session.selectedRange = null
    session.selectionScoped = false
    session.sourceContent = ''
    session.resumeSelection = null
    session.resumeIndex = 0
    session.resumeTime = 0
    playbackEnded = false
    session.langOverrides = new Map()
    session.voiceSelections = new Map()
    session.speed = null
    clearSegments()
    initStatus()
  }

  function initStatus() {
    lastStatusReason = 'ready'
    statusMessage = UI_TEXT[deps.settings.locale].ready
  }

  function onLocaleChanged(next: UiLocale) {
    if (lastStatusReason === 'ready') {
      lastStatusReason = 'ready'
      statusMessage = UI_TEXT[next].ready
      return
    }
    statusMessage = statusForReason(lastStatusReason, next)
  }

  const voiceSwitch = createVoiceSwitch({
    getSessionSegments: () => session.segments,
    getSegmentMetaMap: () => segmentMetaMap,
    getSessionOffset: () => session.offset,
    getIsPlaying: () => isPlaying,
    getCurrentSegmentIndex: () => currentSegmentIndex,
    getPlaybackEnded: () => playbackEnded,
    getCurrentAudio: () => currentAudio,
    getPlaybackElapsed: () => playbackElapsed,
    setPlaybackElapsed: v => { playbackElapsed = v },
    getResumeSegmentIndex: () => session.resumeIndex,
    getResumeSegmentTime: () => session.resumeTime,
    setResumeSegmentTime: v => { session.resumeTime = v },
    getVoiceSwitchGeneration: () => voiceSwitchGeneration,
    setVoiceSwitchGeneration: v => { voiceSwitchGeneration = v },
    setVoiceSwitching: v => { voiceSwitching = v },
    setLastStatusReason: v => { lastStatusReason = v },
    setStatusMessage: v => { statusMessage = v },
    setMetadataAvailable: v => { metadataAvailable = v },
    getSegmentLangOverrides: () => session.langOverrides,
    setSegmentLangOverrides: v => { session.langOverrides = v },
    getSessionVoiceSelections: () => session.voiceSelections,
    setSessionVoiceSelections: v => { session.voiceSelections = v },
    getSessionSpeed: () => session.speed,
    setSessionSpeed: v => { session.speed = v },
    getTaskGeneration: () => taskGeneration,
    getSettings: () => deps.settings,
    getCacheScopeId: () => deps.getCacheScopeId(),
    getEffectiveSegmentLang: effectiveSegmentLang,
    getResolveEffectiveVoice: resolveEffectiveVoice,
    getCharOffsetAtPosition: charOffsetAtPosition,
    getResumeTimeForCharOffset: resumeTimeForCharOffset,
    stopPlayback,
    setResumePosition,
    runPlayback,
    recordSegmentMeta,
    getLocale: () => deps.settings.locale,
  })
  const { resynthesizeSegment, overrideSegmentLanguage, overrideSegmentVoice, recordSessionVoiceOverride, setPlaybackSpeed } = voiceSwitch

  return {
    get isPlaying() {
      return isPlaying
    },
    get hasSession() {
      return session.segments.length > 0
    },
    get sessionSource() {
      return session.sourceContent
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
    get positionVoiceEdge() {
      return positionVoiceEdge
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
      return session.selectionScoped
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
    get currentSessionSegment() {
      return positionSegmentIndex >= 0 ? session.segments[positionSegmentIndex] ?? null : null
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
