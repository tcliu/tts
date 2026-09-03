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

export interface PlaybackEngineDeps {
  getSegmentDurationAt: (index: number) => number
  getEffectiveSegmentLang: (index: number) => string
  getResolveEffectiveVoice: (lang: string) => { edge: string; name: string } | undefined
  pinVoiceForWrittenLang: (code: string, edge: string) => void
  getSegmentMetaMap: () => Record<number, SegmentMeta>
  recordSegment: (index: number, meta: SegmentMeta) => void
  getTaskGeneration: () => Map<number, number>
  getSettings: () => { locale: string; synthesisConcurrency: number }
  getCacheScopeId: () => string
  getCurrentController: () => PlaybackController | null
  setCurrentController: (c: PlaybackController | null) => void
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
  updateHighlightForPosition: (index: number, at: number) => { from: number; to: number } | null
  setSegmentDuration: (index: number, duration: number) => void
  applyPlaybackHighlight: (from: number, to: number) => void
  finishPlaybackRun: (opts?: { resetResume?: boolean; clearActiveInfo?: boolean; updateSynthesizedCount?: boolean }) => void
  failPlaybackRun: (error: unknown, opts?: { clearActiveInfo?: boolean; clearHighlight?: boolean }) => void
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
  async function runPlayback(
    segments: TtsSegment[],
    playbackOffset: number,
    startIndex: number,
    startAt = 0,
    startCharOffset?: number,
  ): Promise<void> {
    const controller: PlaybackController = { cancelled: false, abort: new AbortController() }
    deps.setCurrentController(controller)
    deps.setIsPlaying(true)
    deps.setActiveInfoOffset(-1)
    deps.setActiveInfoKind(null)
    deps.setLastStatusReason('ready')
    deps.setMeasuredTotal(0)
    deps.setPlayedDuration(0)
    for (let i = 0; i < startIndex; i += 1) {
      const prior = deps.getSegmentDurationAt(i)
      deps.setMeasuredTotal(deps.getMeasuredTotal() + prior)
      deps.setPlayedDuration(deps.getPlayedDuration() + prior)
    }
    let wasCancelled = false

    try {
      const concurrency = deps.getSettings().synthesisConcurrency
      deps.setSynthesizedCount(Object.keys(deps.getSegmentMetaMap()).length)
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
        const generationAtQueue = deps.getTaskGeneration().get(index) ?? 0
        const task = (async () => {
          await acquire()
          const effectiveLang = deps.getEffectiveSegmentLang(index)
          const voice = deps.getResolveEffectiveVoice(effectiveLang)
          const rate = CANONICAL_SYNTHESIS_RATE
          const generation = deps.getTaskGeneration().get(index) ?? generationAtQueue
          try {
            if (!voice?.edge) {
              throw new LocalizedPlaybackError(
                `${UI_TEXT[deps.getSettings().locale as keyof typeof UI_TEXT].voiceNotConfigured} (${segmentLanguageName(deps.getSettings().locale as keyof typeof UI_TEXT, effectiveLang)})`,
              )
            }
            const synth = await getCachedSynthesis(segment.text, voice.edge, rate, controller.abort.signal, deps.getCacheScopeId())
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
        task.then(res => {
          if (controller.cancelled) return
          if ((deps.getTaskGeneration().get(index) ?? 0) !== res.generation) return
          const existingMeta = deps.getSegmentMetaMap()[index]
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
          deps.pinVoiceForWrittenLang(toWrittenLang(res.effectiveLang), res.voiceEdge)
        })
        tasks.set(index, task)
        return task
      }

      void launch(startIndex)
      scheduleNext()
      for (let index = startIndex; index < segments.length; index += 1) {
        const segment = segments[index]
        if (controller.cancelled) return
        deps.setCurrentSegmentIndex(index + 1)
        deps.setTotalSegments(segments.length)
        deps.setPlaybackElapsed(index === startIndex ? startAt : 0)
        deps.setPlaybackDuration(0)
        const ranges = splitHighlightRanges(segment.text)
        const absoluteBase = playbackOffset + segment.indexStart
        let result = await launch(index)
        while (!controller.cancelled && result.generation !== (deps.getTaskGeneration().get(index) ?? 0)) {
          tasks.delete(index)
          result = await launch(index)
        }
        if (controller.cancelled) return
        deps.setMetadataAvailable(result.boundaries.length > 0 || result.wordBoundaries.length > 0)
        deps.setPlaybackDuration(result.duration)

        const segmentMeta = deps.getSegmentMetaMap()[index]
        const highlightMarks = highlightBoundaries(segmentMeta, result.wordBoundaries.length > 0 ? result.wordBoundaries : result.boundaries)

        const applyHighlight = (currentTime: number) => {
          deps.updateHighlightForPosition(index, currentTime)
        }
        const selectWholeSegment = () => {
          const trimmed = trimWhitespaceRange(segment.text, 0, segment.text.length)
          deps.applyPlaybackHighlight(absoluteBase + trimmed.start, absoluteBase + trimmed.end)
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
          deps.setPlaybackElapsed(segAt)
          if (segAt > 0) {
            const range = activeHighlightRange(ranges, highlightMarks, segAt)
            if (range) {
              const trimmed = trimWhitespaceRange(segment.text, range.start, range.end)
              deps.applyPlaybackHighlight(absoluteBase + trimmed.start, absoluteBase + trimmed.end)
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
            deps.setSegmentDuration(index, duration)
          },
          segAt,
          spokenStart,
          spokenEnd,
        )
        if (controller.cancelled) {
          wasCancelled = true
        } else {
          deps.setMeasuredTotal(deps.getMeasuredTotal() + deps.getPlaybackDuration())
          deps.setPlayedDuration(deps.getMeasuredTotal())
        }
      }

      if (wasCancelled) return
      deps.finishPlaybackRun({ resetResume: true, clearActiveInfo: true, updateSynthesizedCount: true })
    } catch (error) {
      if (controller.cancelled) return
      deps.failPlaybackRun(error, { clearActiveInfo: true, clearHighlight: false })
    }
  }

  return { runPlayback }
}
