import {
  activeHighlightRange,
  splitHighlightRanges,
  splitTtsSegments,
  type HighlightRange,
  type TtsBoundary,
} from './tts-reference'
import { getCachedSynthesis } from './tts-client'
import { UI_TEXT, segmentLanguageName, type UiLocale } from './ui-text'
import type { SettingsHandle } from './use-settings.svelte'

export type CodeEditorHandle = {
  getSelectionText: () => string
  getSelectionRange: () => { from: number; to: number } | null
  setSelection: (from: number, to: number) => boolean
  clearSelection: () => void
  focus: () => void
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
  readonly currentSegmentLabel: string
  readonly currentVoiceName: string
  readonly currentSynthesisRate: number
  readonly playbackElapsed: number
  readonly playbackDuration: number
  readonly totalElapsed: number
  readonly totalDuration: number
  readonly statusMessage: string
  readonly metadataAvailable: boolean
  readonly segments: Record<number, SegmentMeta>
  initStatus: () => void
  onLocaleChanged: (locale: UiLocale) => void
  startPlayback: () => Promise<void>
  stopPlayback: () => void
  seekTo: (elapsed: number) => Promise<void>
  playFromSegment: (index: number, charOffset?: number) => Promise<void>
  syncSelectionStart: (range: { from: number; to: number } | null) => void
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

export function formatClock(sec: number): string {
  const value = Math.max(0, sec || 0)
  const roundedTenths = Math.round(value * 10)
  const minutes = Math.floor(roundedTenths / 600)
  const seconds = Math.floor((roundedTenths % 600) / 10)
  const tenths = roundedTenths % 10
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`
}

const RESUME_EPSILON = 0.08

function highlightBoundaries(meta: SegmentMeta | undefined, fallback: TtsBoundary[]): TtsBoundary[] {
  if (meta?.wordBoundaries && meta.wordBoundaries.length > 0) {
    return meta.wordBoundaries
  }
  if (meta?.boundaries.length) {
    return meta.boundaries
  }
  return fallback
}

function locateSegmentStartByCharOffset(
  segments: ReturnType<typeof splitTtsSegments>,
  charOffset: number,
): { index: number; charOffset: number } {
  if (segments.length === 0) {
    return { index: 0, charOffset }
  }
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (charOffset < segment.indexEnd) {
      return { index, charOffset }
    }
  }
  return { index: segments.length - 1, charOffset }
}

function locateBoundaryStartWithinOrBefore(
  boundaries: TtsBoundary[],
  absoluteBase: number,
  range: { from: number; to: number },
): number {
  let candidateAt: number | null = null
  for (const boundary of boundaries) {
    const absoluteOffset = absoluteBase + boundary.offset
    if (absoluteOffset >= range.from && absoluteOffset < range.to) {
      return boundary.at
    }
    if (absoluteOffset <= range.from) {
      candidateAt = boundary.at
      continue
    }
    break
  }
  return candidateAt ?? 0
}

function activeBoundaryAt(boundaries: TtsBoundary[], at: number): TtsBoundary | null {
  let active: TtsBoundary | null = null
  for (let i = 0; i < boundaries.length; i += 1) {
    if (boundaries[i].at <= at) {
      active = boundaries[i]
      continue
    }
    break
  }
  return active
}

function trimWhitespaceRange(text: string, start: number, end: number): { start: number; end: number } {
  let s = start
  let e = end
  while (s < e && /\s/.test(text[s] ?? '')) s += 1
  while (e > s && /\s/.test(text[e - 1] ?? '')) e -= 1
  return { start: s, end: e }
}

function readAudioDuration(blob: Blob, signal: AbortSignal): Promise<number> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve(0)
      return
    }
    const audio = new Audio()
    const url = URL.createObjectURL(blob)
    let settled = false
    const cleanup = () => {
      signal.removeEventListener('abort', handleAbort)
      audio.onloadedmetadata = null
      audio.onerror = null
      audio.pause()
      audio.src = ''
      URL.revokeObjectURL(url)
    }
    const finish = (duration: number) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Number.isFinite(duration) ? duration : 0)
    }
    const handleAbort = () => finish(0)
    signal.addEventListener('abort', handleAbort, { once: true })
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => finish(audio.duration)
    audio.onerror = () => finish(0)
    audio.src = url
  })
}

export interface PlaybackDeps {
  settings: SettingsHandle
  getEditor: () => CodeEditorHandle | null
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
  let currentSegmentLabel = $state('')
  let currentVoiceName = $state('')
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

  function stopPlayback() {
    if (playbackEnded) {
      return
    }
    if (!currentController) {
      return
    }
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

  function updateSelectionForPosition(index: number, at: number) {
    const meta = segmentMetaMap[index]
    const segment = sessionSegments[index]
    if (!segment) return
    const absoluteBase = sessionOffset + segment.indexStart
    const setWholeSegmentSelection = () => {
      const trimmed = trimWhitespaceRange(segment.text, 0, segment.text.length)
      deps.getEditor()?.setSelection(absoluteBase + trimmed.start, absoluteBase + trimmed.end)
    }
    const boundaries = highlightBoundaries(meta, [])
    if (!meta || meta.ranges.length === 0 || boundaries.length === 0) {
      setWholeSegmentSelection()
      return
    }
    const activeBoundary = activeBoundaryAt(boundaries, at)
    if (activeBoundary?.text) {
      const wordStart = activeBoundary.offset
      const wordEnd = wordStart + activeBoundary.text.length
      const trimmed = trimWhitespaceRange(segment.text, wordStart, wordEnd)
      deps.getEditor()?.setSelection(absoluteBase + trimmed.start, absoluteBase + trimmed.end)
      return
    }
    const range = activeHighlightRange(meta.ranges, boundaries, at)
    if (!range) {
      setWholeSegmentSelection()
      return
    }
    const trimmed = trimWhitespaceRange(segment.text, range.start, range.end)
    deps.getEditor()?.setSelection(absoluteBase + trimmed.start, absoluteBase + trimmed.end)
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
    currentSegmentLabel = deps.segmentLabel(sessionSegments[clampedIndex].lang)
    measuredTotal = accumulated
    playedDuration = accumulated
    playbackElapsed = clampedAt
    playbackDuration = segmentDuration
    if (applySelection) {
      updateSelectionForPosition(clampedIndex, clampedAt)
    }
  }

  function syncSelectionStart(range: { from: number; to: number } | null) {
    if (isPlaying) return
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
    const segments =
      sessionSegments.length > 0 && sessionSourceContent === content
        ? sessionSegments
        : splitTtsSegments(content)
    if (segments.length === 0) {
      resetSession()
      return
    }
    const start = locateSegmentStartByCharOffset(segments, range.from)
    const meta = segmentMetaMap[start.index]
    if (!meta) {
      return
    }
    primeSession(segments, 0, range)
    totalSegments = segments.length
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
            const synth = await getCachedSynthesis(segment.text, voice.edge, rate, controller.abort.signal)
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
          const meta: SegmentMeta = {
            index,
            lang: segment.lang,
            text: segment.text,
            ranges: splitHighlightRanges(segment.text),
            boundaries: res.boundaries,
            wordBoundaries: res.wordBoundaries,
            baseOffset: playbackOffset + segment.indexStart,
            duration: res.duration,
            spokenStart: res.spokenStart,
            spokenEnd: res.spokenEnd,
          }
          if (!existingMeta) {
            recordSegment(index, meta)
          } else {
            recordSegment(index, {
              ...existingMeta,
              ...meta,
              boundaries: meta.boundaries.length > 0 ? meta.boundaries : existingMeta.boundaries,
              wordBoundaries:
                (meta.wordBoundaries?.length ?? 0) > 0 ? meta.wordBoundaries : (existingMeta.wordBoundaries ?? []),
              duration: existingMeta.duration ?? meta.duration,
              spokenStart: meta.spokenStart ?? existingMeta.spokenStart,
              spokenEnd: meta.spokenEnd ?? existingMeta.spokenEnd,
            })
          }
        })
        tasks.set(index, task)
        return task
      }

      // Prioritize the segment where playback begins so it is synthesized
      // first; the rest of the whole text synthesizes in the background.
      void launch(startIndex)
      scheduleNext()
      for (let index = startIndex; index < segments.length; index += 1) {
        const segment = segments[index]
        if (controller.cancelled) return
        currentSegmentIndex = index + 1
        totalSegments = segments.length
        currentSegmentLabel = deps.segmentLabel(segment.lang)
        playbackElapsed = index === startIndex ? startAt : 0
        playbackDuration = 0
        const ranges = splitHighlightRanges(segment.text)
        const absoluteBase = playbackOffset + segment.indexStart
        const result = await launch(index)
        if (controller.cancelled) return
        currentVoiceName = result.voiceName
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
        setSegmentDuration(index, playbackDuration)
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
    currentSegmentLabel = ''
    currentVoiceName = ''
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
    get currentSegmentLabel() {
      return currentSegmentLabel
    },
    get currentVoiceName() {
      return currentVoiceName
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
    primeSession,
    recordSegment,
    setSegmentDuration,
    clearSegments,
    resetSession,
  }
}
