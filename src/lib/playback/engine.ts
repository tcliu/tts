import { activeHighlightRange } from '../tts-reference'
import { splitHighlightRanges, type TtsSegment } from '../tts/segment'
import { CANONICAL_SYNTHESIS_RATE } from '../tts-cache-key'
import { UI_TEXT } from '../ui-text'
import { segmentLanguageName } from '../ui-text'
import { getCachedSynthesis } from '../tts-client'
import { buildSegmentMeta } from './segment-meta'
import { LocalizedPlaybackError } from './types'
import type { SegmentMeta, PlaybackController } from './types'
import { activeBoundaryAt, highlightBoundaries, trimWhitespaceRange } from './boundaries'
import { readAudioDuration } from './audio-helpers'
import { toWrittenLang } from '../tts-reference'

/**
 * Core playback state accessors.
 * Grouped to reduce the total number of dep functions.
 */
export interface CoreState {
  getSession: () => { segments: TtsSegment[]; offset: number }
  getSegmentMetaMap: () => Record<number, SegmentMeta>
  getTaskGeneration: () => Map<number, number>
  getCurrentController: () => PlaybackController | null
  setCurrentController: (c: PlaybackController | null) => void
}

/**
 * Playback progress state.
 */
export interface ProgressState {
  getIsPlaying: () => boolean
  setIsPlaying: (v: boolean) => void
  getActiveInfoOffset: () => number
  setActiveInfoOffset: (v: number) => void
  getActiveInfoKind: () => string | null
  setActiveInfoKind: (v: 'sentence' | 'word' | null) => void
  getLastStatusReason: () => string
  setLastStatusReason: (v: 'ready' | 'stopped' | 'switching' | 'finished' | 'error') => void
  getCurrentSegmentIndex: () => number
  setCurrentSegmentIndex: (v: number) => void
  getTotalSegments: () => number
  setTotalSegments: (v: number) => void
  getPlaybackElapsed: () => number
  setPlaybackElapsed: (v: number) => void
  getPlaybackDuration: () => number
  setPlaybackDuration: (v: number) => void
  getMeasuredTotal: () => number
  setMeasuredTotal: (v: number) => void
  getPlayedDuration: () => number
  setPlayedDuration: (v: number) => void
  getSynthesizedCount: () => number
  setSynthesizedCount: (v: number) => void
  getMetadataAvailable: () => boolean
  setMetadataAvailable: (v: boolean) => void
}

/**
 * Voice resolution deps.
 */
export interface VoiceDeps {
  getEffectiveSegmentLang: (index: number) => string
  getResolveEffectiveVoice: (lang: string) => { edge: string; name: string } | undefined
  pinVoiceForWrittenLang: (code: string, edge: string) => void
}

/**
 * Highlight computation deps.
 */
export interface HighlightDeps {
  updateHighlightForPosition: (index: number, at: number) => { from: number; to: number } | null
  setSegmentDuration: (index: number, duration: number) => void
  applyPlaybackHighlight: (from: number, to: number) => void
}

/**
 * Lifecycle callbacks for playback run completion.
 */
export interface PlaybackLifecycle {
  finishPlaybackRun: (opts?: {
    resetResume?: boolean
    clearActiveInfo?: boolean
    updateSynthesizedCount?: boolean
  }) => void
  failPlaybackRun: (error: unknown, opts?: {
    clearActiveInfo?: boolean
    clearHighlight?: boolean
  }) => void
}

export interface PlaybackEngineDeps {
  core: CoreState
  progress: ProgressState
  voice: VoiceDeps
  highlight: HighlightDeps
  lifecycle: PlaybackLifecycle
  settings: {
    locale: string
    synthesisConcurrency: number
  }
  getCacheScopeId: () => string
  recordSegment: (index: number, meta: SegmentMeta) => void
  playAudioBlob: (
    controller: PlaybackController,
    blob: Blob,
    onProgress?: (currentTime: number) => void,
    onDuration?: (duration: number) => void,
    startAt?: number,
    spokenStart?: number,
    spokenEnd?: number,
  ) => Promise<void>
}

export function createPlaybackEngine(deps: PlaybackEngineDeps) {
  const { core, progress, voice, highlight, lifecycle } = deps

  function segmentDurationAt(index: number): number {
    const meta = core.getSegmentMetaMap()[index]
    if (!meta) return 0
    if (meta.spokenEnd != null && meta.spokenStart != null) {
      return Math.max(0, meta.spokenEnd - meta.spokenStart)
    }
    return meta.duration ?? 0
  }

  async function runPlayback(
    segments: TtsSegment[],
    playbackOffset: number,
    startIndex: number,
    startAt = 0,
    startCharOffset?: number,
  ): Promise<void> {
    const controller: PlaybackController = { cancelled: false, abort: new AbortController() }
    core.setCurrentController(controller)
    progress.setIsPlaying(true)
    progress.setActiveInfoOffset(-1)
    progress.setActiveInfoKind(null)
    progress.setLastStatusReason('ready')
    progress.setMeasuredTotal(0)
    progress.setPlayedDuration(0)
    for (let i = 0; i < startIndex; i += 1) {
      const prior = segmentDurationAt(i)
      progress.setMeasuredTotal(progress.getMeasuredTotal() + prior)
      progress.setPlayedDuration(progress.getPlayedDuration() + prior)
    }
    let wasCancelled = false

    try {
      const concurrency = deps.settings.synthesisConcurrency
      progress.setSynthesizedCount(Object.keys(core.getSegmentMetaMap()).length)
      const tasks = new Map<
        number,
        Promise<{
          blob: Blob
          boundaries: import('../tts-reference').TtsBoundary[]
          wordBoundaries: import('../tts-reference').TtsBoundary[]
          rate: number
          voiceName: string
          voiceEdge: string
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
        scheduleNext()
      }
      const launch = (index: number) => {
        const existing = tasks.get(index)
        if (existing) return existing
        const segment = segments[index]
        const generationAtQueue = core.getTaskGeneration().get(index) ?? 0
        const task = (async () => {
          await acquire()
          const effectiveLang = voice.getEffectiveSegmentLang(index)
          const voiceResolved = voice.getResolveEffectiveVoice(effectiveLang)
          const rate = CANONICAL_SYNTHESIS_RATE
          const generation = core.getTaskGeneration().get(index) ?? generationAtQueue
          try {
            if (!voiceResolved?.edge) {
              throw new LocalizedPlaybackError(
                `${UI_TEXT[deps.settings.locale as keyof typeof UI_TEXT].voiceNotConfigured} (${segmentLanguageName(deps.settings.locale as keyof typeof UI_TEXT, effectiveLang)})`,
              )
            }
            const synth = await getCachedSynthesis(segment.text, voiceResolved.edge, rate, controller.abort.signal, deps.getCacheScopeId())
            const duration = await readAudioDuration(synth.blob, controller.abort.signal)
            return {
              blob: synth.blob,
              boundaries: synth.boundaries,
              wordBoundaries: synth.wordBoundaries ?? [],
              rate,
              voiceName: voiceResolved.name,
              voiceEdge: voiceResolved.edge,
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
        task.then(res => {
          if (controller.cancelled) return
          if ((core.getTaskGeneration().get(index) ?? 0) !== res.generation) return
          const metaMap = core.getSegmentMetaMap()
          const existingMeta = metaMap[index]
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
            deps.recordSegment(index, base)
          } else {
            deps.recordSegment(index, {
              ...existingMeta,
              ...base,
              boundaries: base.boundaries.length > 0 ? base.boundaries : existingMeta.boundaries,
              wordBoundaries: (base.wordBoundaries?.length ?? 0) > 0 ? base.wordBoundaries : (existingMeta.wordBoundaries ?? []),
              duration: base.duration ?? existingMeta.duration,
              spokenStart: base.spokenStart ?? existingMeta.spokenStart,
              spokenEnd: base.spokenEnd ?? existingMeta.spokenEnd,
            })
          }
          voice.pinVoiceForWrittenLang(toWrittenLang(res.effectiveLang), res.voiceEdge)
        })
        tasks.set(index, task)
        return task
      }

      void launch(startIndex)
      scheduleNext()
      for (let index = startIndex; index < segments.length; index += 1) {
        const segment = segments[index]
        if (controller.cancelled) return
        progress.setCurrentSegmentIndex(index + 1)
        progress.setTotalSegments(segments.length)
        progress.setPlaybackElapsed(index === startIndex ? startAt : 0)
        progress.setPlaybackDuration(0)
        const ranges = splitHighlightRanges(segment.text)
        const absoluteBase = playbackOffset + segment.indexStart
        let result = await launch(index)
        while (!controller.cancelled && result.generation !== (core.getTaskGeneration().get(index) ?? 0)) {
          tasks.delete(index)
          result = await launch(index)
        }
        if (controller.cancelled) return
        progress.setMetadataAvailable(result.boundaries.length > 0 || result.wordBoundaries.length > 0)
        progress.setPlaybackDuration(result.duration)

        const segmentMeta = core.getSegmentMetaMap()[index]
        const highlightMarks = highlightBoundaries(segmentMeta, result.wordBoundaries.length > 0 ? result.wordBoundaries : result.boundaries)

        const applyHighlight = (currentTime: number) => {
          highlight.updateHighlightForPosition(index, currentTime)
        }
        const selectWholeSegment = () => {
          const trimmed = trimWhitespaceRange(segment.text, 0, segment.text.length)
          highlight.applyPlaybackHighlight(absoluteBase + trimmed.start, absoluteBase + trimmed.end)
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
          progress.setPlaybackElapsed(segAt)
          if (segAt > 0) {
            const range = activeHighlightRange(ranges, highlightMarks, segAt)
            if (range) {
              const trimmed = trimWhitespaceRange(segment.text, range.start, range.end)
              highlight.applyPlaybackHighlight(absoluteBase + trimmed.start, absoluteBase + trimmed.end)
            }
          }
        }

        const spokenStart = segmentMeta?.spokenStart ?? 0
        const spokenEnd = segmentMeta?.spokenEnd
        await deps.playAudioBlob(
          controller,
          result.blob,
          ranges.length > 0 && highlightMarks.length > 0 ? applyHighlight : undefined,
          duration => {
            highlight.setSegmentDuration(index, duration)
          },
          segAt,
          spokenStart,
          spokenEnd,
        )
        if (controller.cancelled) {
          wasCancelled = true
        } else {
          progress.setMeasuredTotal(progress.getMeasuredTotal() + progress.getPlaybackDuration())
          progress.setPlayedDuration(progress.getMeasuredTotal())
        }
      }

      if (wasCancelled) return
      lifecycle.finishPlaybackRun({ resetResume: true, clearActiveInfo: true, updateSynthesizedCount: true })
    } catch (error) {
      if (controller.cancelled) return
      lifecycle.failPlaybackRun(error, { clearActiveInfo: true, clearHighlight: false })
    }
  }

  return { runPlayback }
}
