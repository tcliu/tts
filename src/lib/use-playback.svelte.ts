import {
  activeHighlightRange,
  splitHighlightRanges,
  splitTtsSegments,
  type HighlightRange,
  type TtsBoundary,
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
  readonly positionSegmentLabel: string
  readonly positionVoiceName: string
  readonly currentSynthesisRate: number
  readonly playbackElapsed: number
  readonly playbackDuration: number
  readonly totalElapsed: number
  readonly totalDuration: number
  readonly statusMessage: string
  readonly metadataAvailable: boolean
  readonly segments: Record<number, SegmentMeta>
  readonly sessionSource: string
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
}

export interface PlaybackDeps {
  settings: SettingsHandle
  getEditor: () => CodeEditorHandle | null
  getCacheScopeId: () => string
  segmentLabel: (lang: string) => string
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

  let lastStatusReason = $state<'ready' | 'stopped' | 'finished' | 'error'>('ready')
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
  let resumeSegmentIndex = 0
  let resumeSegmentTime = 0

  const totalElapsed = $derived(playedDuration + playbackElapsed)
  const totalDuration = $derived.by(() => {
    let total = 0
    for (let i = 0; i < sessionSegments.length; i += 1) {
      total += segmentDurationAt(i)
    }
    return total
  })

  // Status-strip facts for the segment at the slider position, so lang and
  // voice stay meaningful before, during, and after playback.
  const positionLocation = $derived(locatePlaybackPosition(totalElapsed))
  const positionSegmentIndex = $derived(positionLocation ? positionLocation.index : -1)
  const positionSegmentLabel = $derived.by(() => {
    const segment = positionSegmentIndex >= 0 ? sessionSegments[positionSegmentIndex] : undefined
    return segment ? deps.segmentLabel(segment.lang) : ''
  })
  const positionVoiceName = $derived.by(() => {
    const segment = positionSegmentIndex >= 0 ? sessionSegments[positionSegmentIndex] : undefined
    return segment ? (deps.settings.resolveVoiceForSegment(segment.lang)?.name ?? '') : ''
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
      currentAudio.playbackRate = deps.settings.speed / currentSynthesisRate
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

  function updateSelectionForPosition(index: number, at: number): { from: number; to: number } | null {
    const meta = segmentMetaMap[index]
    const segment = sessionSegments[index]
    if (!segment) return null
    const absoluteBase = sessionOffset + segment.indexStart
    const setWholeSegmentSelection = (): { from: number; to: number } => {
      const trimmed = trimWhitespaceRange(segment.text, 0, segment.text.length)
      const range = { from: absoluteBase + trimmed.start, to: absoluteBase + trimmed.end }
      deps.getEditor()?.setSelection(range.from, range.to)
      return range
    }
    const boundaries = highlightBoundaries(meta, [])
    if (!meta || meta.ranges.length === 0 || boundaries.length === 0) {
      return setWholeSegmentSelection()
    }
    const activeBoundary = activeBoundaryAt(boundaries, at)
    if (activeBoundary?.text) {
      const wordStart = activeBoundary.offset
      const wordEnd = wordStart + activeBoundary.text.length
      const trimmed = trimWhitespaceRange(segment.text, wordStart, wordEnd)
      const range = { from: absoluteBase + trimmed.start, to: absoluteBase + trimmed.end }
      deps.getEditor()?.setSelection(range.from, range.to)
      return range
    }
    const range = activeHighlightRange(meta.ranges, boundaries, at)
    if (!range) {
      return setWholeSegmentSelection()
    }
    const trimmed = trimWhitespaceRange(segment.text, range.start, range.end)
    const applied = { from: absoluteBase + trimmed.start, to: absoluteBase + trimmed.end }
    deps.getEditor()?.setSelection(applied.from, applied.to)
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
    if (applySelection) {
      // The selection echo of our own positioning must not re-enter
      // syncSelectionStart, or a seek to the end snaps back to the last word.
      // Record the painted range as the resume selection so the very next
      // Play recognizes the seek-scrolled state instead of rebuilding the
      // session (which drops the dragged position and warmed metadata).
      applyingResumeSelection = true
      try {
        sessionResumeSelection = updateSelectionForPosition(clampedIndex, clampedAt) ?? sessionResumeSelection
      } finally {
        applyingResumeSelection = false
      }
    }
  }

  function syncSelectionStart(range: { from: number; to: number } | null) {
    if (isPlaying || applyingResumeSelection) return
    const content = deps.settings.content
    if (!content) {
      resetSession()
      return
    }
    // Selection changes fire on every caret move; segment the document only
    // when a selection actually needs a resume position computed.
    if (range == null) {
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

  function locatePlaybackPosition(elapsed: number): { index: number; startAt: number } | null {
    if (sessionSegments.length === 0) return null
    const clampedElapsed = Math.max(0, Math.min(elapsed, totalDuration || elapsed))
    let total = 0
    for (let index = 0; index < sessionSegments.length; index += 1) {
      const duration = segmentDurationAt(index)
      if (index === sessionSegments.length - 1 || clampedElapsed <= total + duration) {
        return { index, startAt: Math.max(0, clampedElapsed - total) }
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
        const voice = deps.settings.resolveVoiceForSegment(segment.lang)
        const rate = deps.settings.speed
        const task = (async () => {
          await acquire()
          try {
            if (!voice?.edge) {
              throw new LocalizedPlaybackError(
                `${UI_TEXT[deps.settings.locale].voiceNotConfigured} (${segmentLanguageName(deps.settings.locale, segment.lang)})`,
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
            }
          } finally {
            release()
          }
        })()
        task.then((res) => {
          if (controller.cancelled) return
          const existingMeta = segmentMetaMap[index]
          // Merge with the existing meta only when it describes this exact
          // text; a mismatch means it was recorded under an older split and
          // its boundaries, duration, and spoken range would be wrong here.
          const compatible = existingMeta?.text === segment.text
          const base = buildSegmentMeta(
            index,
            segment,
            {
              boundaries: res.boundaries,
              wordBoundaries: res.wordBoundaries,
              duration: res.duration,
              spokenStart: res.spokenStart,
              spokenEnd: res.spokenEnd,
            },
            playbackOffset + segment.indexStart,
          )
          if (!compatible) {
            recordSegment(index, base)
          } else {
            recordSegment(index, {
              ...existingMeta,
              ...base,
              boundaries: base.boundaries.length > 0 ? base.boundaries : existingMeta.boundaries,
              wordBoundaries:
                (base.wordBoundaries?.length ?? 0) > 0 ? base.wordBoundaries : (existingMeta.wordBoundaries ?? []),
              duration: existingMeta.duration ?? base.duration,
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
        const result = await launch(index)
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
          deps.getEditor()?.setSelection(absoluteBase + trimmed.start, absoluteBase + trimmed.end)
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
              deps.getEditor()?.setSelection(absoluteBase + trimmed.start, absoluteBase + trimmed.end)
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
      if (sessionSelectedRange) {
        deps.getEditor()?.setSelection(sessionSelectedRange.from, sessionSelectedRange.to)
      } else {
        deps.getEditor()?.clearSelection()
      }
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
      const cached = peekCachedSynthesis(segment.text, voice.edge, deps.settings.speed)
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
    if (!deps.settings.canPlay || !editor || isPlaying) {
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

  async function playFromSegment(index: number, charOffset?: number) {
    if (sessionSegments.length === 0) {
      return
    }
    playbackEnded = false
    stopPlayback()
    let startAt = 0
    if (charOffset != null) {
      const meta = segmentMetaMap[index]
      const boundary = meta?.boundaries.find(b => meta.baseOffset + b.offset === charOffset)
      if (boundary) {
        startAt = boundary.at
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
    segmentMetaMap = {}
    synthesizedCount = 0
    currentSegmentIndex = 0
    totalSegments = sessionSegments.length
    playedDuration = 0
    measuredTotal = 0
    playbackElapsed = 0
    playbackDuration = 0
    currentSynthesisRate = deps.settings.speed
    metadataAvailable = false
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
    if (lastStatusReason === 'finished') {
      statusMessage = UI_TEXT[next].playbackFinished
      return
    }
    lastStatusReason = 'ready'
    statusMessage = UI_TEXT[next].ready
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
    get positionSegmentLabel() {
      return positionSegmentLabel
    },
    get positionVoiceName() {
      return positionVoiceName
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
  }
}
