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
  baseOffset: number
  duration?: number
}

interface PlaybackController {
  cancelled: boolean
  abort: AbortController
  cancelAudio?: () => void
}

class LocalizedPlaybackError extends Error {}

export interface PlaybackHandle {
  readonly isPlaying: boolean
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
  playFromSegment: (index: number, charOffset?: number) => Promise<void>
  recordSegment: (index: number, record: SegmentMeta) => void
  setSegmentDuration: (index: number, duration: number) => void
  setMetadataAvailability: (value: boolean) => void
  clearSegments: () => void
}

export function formatClock(sec: number): string {
  const total = Math.max(0, Math.floor(sec || 0))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function trimWhitespaceRange(text: string, start: number, end: number): { start: number; end: number } {
  let s = start
  let e = end
  while (s < e && /\s/.test(text[s] ?? '')) s += 1
  while (e > s && /\s/.test(text[e - 1] ?? '')) e -= 1
  return { start: s, end: e }
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
  let currentSegmentLabel = $state('')
  let currentVoiceName = $state('')
  let currentSynthesisRate = $state(1)
  let playbackElapsed = $state(0)
  let playbackDuration = $state(0)
  let statusMessage = $state(UI_TEXT[deps.settings.locale].ready)

  let lastStatusReason = $state<'ready' | 'stopped' | 'finished' | 'error'>('ready')
  let currentController: PlaybackController | null = null
  let currentAudio = $state<HTMLAudioElement | null>(null)
  let currentAudioUrl = ''

  let metadataAvailable = $state(false)

  let segmentMetaMap = $state<Record<number, SegmentMeta>>({})
  let sessionSegments: ReturnType<typeof splitTtsSegments> = []
  let sessionOffset = 0
  let sessionSelectedRange: { from: number; to: number } | null = null

  const totalElapsed = $derived(playedDuration + playbackElapsed)
  const totalDuration = $derived.by(() => {
    let total = 0
    for (const meta of Object.values(segmentMetaMap)) {
      const lastAt = meta.boundaries.length > 0 ? meta.boundaries[meta.boundaries.length - 1].at : 0
      total += meta.duration ?? lastAt
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
    if (!currentController) {
      return
    }
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
    synthesizedCount = 0
    lastStatusReason = 'stopped'
    statusMessage = UI_TEXT[deps.settings.locale].playbackStopped
    metadataAvailable = false
  }

  function playAudioBlob(
    controller: PlaybackController,
    blob: Blob,
    onProgress?: (currentTime: number) => void,
    startAt = 0,
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
      const cancelResolve = () => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        resolve()
      }
      // Invoked by stopPlayback so a paused (never-ended) element still settles
      // the awaited promise and the playback loop can observe cancellation.
      controller.cancelAudio = cancelResolve

      const stopTick = () => {
        if (rafId) {
          cancelAnimationFrame(rafId)
          rafId = 0
        }
      }
      const tick = () => {
        rafId = 0
        if (controller.cancelled || audio.paused || audio.ended) {
          return
        }
        playbackElapsed = audio.currentTime
        onProgress?.(audio.currentTime)
        rafId = requestAnimationFrame(tick)
      }

      audio.onloadedmetadata = () => {
        playbackDuration = Number.isFinite(audio.duration) ? audio.duration : 0
        if (startAt > 0 && Number.isFinite(audio.duration)) {
          audio.currentTime = Math.min(startAt, audio.duration)
        }
      }
      // Fallback progress driver for hidden tabs where rAF is suspended.
      audio.ontimeupdate = () => {
        if (!document.hidden && rafId) {
          return
        }
        if (controller.cancelled) {
          return
        }
        playbackElapsed = audio.currentTime
        onProgress?.(audio.currentTime)
      }
      audio.onended = () => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        resolve()
      }
      audio.onerror = () => {
        if (settled) {
          return
        }
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
        if (settled) {
          return
        }
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
  ) {
    const controller: PlaybackController = { cancelled: false, abort: new AbortController() }
    currentController = controller
    isPlaying = true
    lastStatusReason = 'ready'

    try {
      const concurrency = deps.settings.synthesisConcurrency
      synthesizedCount = Object.keys(segmentMetaMap).length
      playedDuration = 0
      for (let i = 0; i < startIndex; i += 1) {
        const prior = segmentMetaMap[i]
        playedDuration += prior?.duration ?? (prior?.boundaries.length ? prior.boundaries[prior.boundaries.length - 1].at : 0)
      }
      const tasks = new Map<number, Promise<{ blob: Blob; boundaries: TtsBoundary[]; rate: number; voiceName: string }>>()
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
            const synth = await getCachedSynthesis(segment.text, voice.edge, rate, controller.abort.signal)
            return { blob: synth.blob, boundaries: synth.boundaries, rate, voiceName: voice.name }
          } finally {
            release()
          }
        })()
        task.then((res) => {
          if (controller.cancelled) {
            return
          }
          recordSegment(index, {
            index,
            lang: segment.lang,
            text: segment.text,
            ranges: splitHighlightRanges(segment.text),
            boundaries: res.boundaries,
            baseOffset: playbackOffset + segment.indexStart,
          })
        })
        tasks.set(index, task)
        return task
      }

      scheduleNext()
      for (let index = startIndex; index < segments.length; index += 1) {
        const segment = segments[index]
        if (controller.cancelled) {
          return
        }
        currentSegmentIndex = index + 1
        totalSegments = segments.length
        currentSegmentLabel = deps.segmentLabel(segment.lang)
        playbackElapsed = 0
        playbackDuration = 0
        const ranges = splitHighlightRanges(segment.text)
        const absoluteBase = playbackOffset + segment.indexStart
        const result = await launch(index)
        if (controller.cancelled) {
          return
        }
        currentVoiceName = result.voiceName
        currentSynthesisRate = result.rate
        metadataAvailable = result.boundaries.length > 0

        const applyHighlight = (currentTime: number) => {
          const range = activeHighlightRange(ranges, result.boundaries, currentTime)
          if (range) {
            const trimmed = trimWhitespaceRange(segment.text, range.start, range.end)
            deps.getEditor()?.setSelection(absoluteBase + trimmed.start, absoluteBase + trimmed.end)
          }
        }

        const selectWholeSegment = () => {
          const trimmed = trimWhitespaceRange(segment.text, 0, segment.text.length)
          deps.getEditor()?.setSelection(absoluteBase + trimmed.start, absoluteBase + trimmed.end)
        }

        const segAt = index === startIndex ? startAt : 0
        if (segAt > 0 && ranges.length > 0 && result.boundaries.length > 0) {
          const range = activeHighlightRange(ranges, result.boundaries, segAt)
          if (range) {
            const trimmed = trimWhitespaceRange(segment.text, range.start, range.end)
            deps.getEditor()?.setSelection(absoluteBase + trimmed.start, absoluteBase + trimmed.end)
          } else {
            selectWholeSegment()
          }
        } else if (ranges.length === 0 || result.boundaries.length === 0) {
          selectWholeSegment()
        } else {
          applyHighlight(0)
        }

        await playAudioBlob(
          controller,
          result.blob,
          ranges.length > 0 && result.boundaries.length > 0 ? applyHighlight : undefined,
          segAt,
        )
        playedDuration += Math.max(0, playbackDuration - segAt)
        setSegmentDuration(index, playbackDuration)
      }

      if (controller.cancelled) {
        return
      }
      currentController = null
      isPlaying = false
      lastStatusReason = 'finished'
      metadataAvailable = false
      synthesizedCount = totalSegments
      if (sessionSelectedRange) {
        deps.getEditor()?.setSelection(sessionSelectedRange.from, sessionSelectedRange.to)
      } else {
        deps.getEditor()?.clearSelection()
      }
      statusMessage = UI_TEXT[deps.settings.locale].playbackFinished
    } catch (error) {
      if (controller.cancelled) {
        return
      }
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

  async function startPlayback() {
    const editor = deps.getEditor()
    if (!deps.settings.canPlay || !editor || isPlaying) {
      return
    }

    const selectedRange = editor.getSelectionRange()
    const content = deps.settings.content
    const playbackText = selectedRange ? content.slice(selectedRange.from, selectedRange.to) : content
    const playbackOffset = selectedRange?.from ?? 0
    const segments = splitTtsSegments(playbackText)
    if (segments.length === 0) {
      return
    }

    sessionSegments = segments
    sessionOffset = playbackOffset
    sessionSelectedRange = selectedRange
    clearSegments()
    deps.prepareForPlayback()
    await runPlayback(segments, playbackOffset, 0)
  }

  async function playFromSegment(index: number, charOffset?: number) {
    if (sessionSegments.length === 0) {
      return
    }
    stopPlayback()
    let startAt = 0
    if (charOffset != null) {
      const meta = segmentMetaMap[index]
      const boundary = meta?.boundaries.find(b => meta.baseOffset + b.offset === charOffset)
      if (boundary) {
        startAt = boundary.at
      }
    }
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
    playFromSegment,
    recordSegment,
    setSegmentDuration,
    clearSegments,
  }
}
