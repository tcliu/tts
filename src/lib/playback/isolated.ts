import { UI_TEXT } from '../ui-text'
import { segmentLanguageName } from '../ui-text'
import { splitHighlightRanges } from '../tts-reference'
import { trimWhitespaceRange } from '../playback-helpers'
import { highlightBoundaries, activeBoundaryAt } from '../playback-helpers'
import { activeHighlightRange } from '../tts-reference'
import { getCachedSynthesis } from '../tts-client'
import { readAudioDuration } from '../playback-helpers'
import { LocalizedPlaybackError, type SegmentMeta } from './types'

export interface IsolatedDeps {
  getSessionOffset: () => number
  getEffectiveSegmentLang: (index: number) => string
  getResolveEffectiveVoice: (lang: string) => { edge: string; name: string } | undefined
  getEffectiveSpeed: () => number
  getCacheScopeId: () => string
  getLocale: () => string
  getCurrentController: () => { cancelled: boolean; abort: AbortController; cancelAudio?: () => void } | null
  setCurrentController: (c: { cancelled: boolean; abort: AbortController; cancelAudio?: () => void } | null) => void
  getIsPlaying: () => boolean
  setIsPlaying: (v: boolean) => void
  getPlaybackEnded: () => boolean
  setPlaybackEnded: (v: boolean) => void
  getLastStatusReason: () => string
  setLastStatusReason: (v: 'ready' | 'stopped' | 'switching' | 'finished' | 'error') => void
  getActiveInfoOffset: () => number
  setActiveInfoOffset: (v: number) => void
  getActiveInfoKind: () => 'sentence' | 'word' | null
  setActiveInfoKind: (v: 'sentence' | 'word' | null) => void
  getCurrentSegmentIndex: () => number
  setCurrentSegmentIndex: (v: number) => void
  getTotalSegments: () => number
  setTotalSegments: (v: number) => void
  getPlaybackElapsed: () => number
  setPlaybackElapsed: (v: number) => void
  getPlaybackDuration: () => number
  setPlaybackDuration: (v: number) => void
  getSessionSegments: () => { length: number }
  getSegmentMetaMap: () => Record<number, SegmentMeta>
  getSessionResumeSelection: () => { from: number; to: number } | null
  setSessionResumeSelection: (v: { from: number; to: number } | null) => void
  getMetadataAvailable: () => boolean
  setMetadataAvailable: (v: boolean) => void
  getStatusMessage: () => string
  setStatusMessage: (v: string) => void
  getEditor: () => { clearPlaybackHighlight?: () => void } | null
  applyPlaybackHighlight: (from: number, to: number) => void
  playAudioBlob: (
    controller: { cancelled: boolean; abort: AbortController; cancelAudio?: () => void },
    blob: Blob,
    onProgress?: (currentTime: number) => void,
    onDuration?: (duration: number) => void,
    startAt?: number,
    spokenStart?: number,
    spokenEnd?: number,
  ) => Promise<void>
}

export function createIsolatedPlayer(deps: IsolatedDeps) {
  async function playIsolatedFragment(
    kind: 'sentence' | 'word',
    segmentIndex: number,
    charOffset: number,
    meta: SegmentMeta,
    segment: { text: string; indexStart: number },
  ): Promise<boolean> {
    const absoluteBase = deps.getSessionOffset() + segment.indexStart
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
        const fallbackRange =
          meta.ranges.find(r => wordBoundary.offset >= r.start && wordBoundary.offset < r.end) ?? meta.ranges[meta.ranges.length - 1]
        if (fallbackRange) {
          setIsolatedSelection(fallbackRange.start, fallbackRange.end)
        }
      }
    } else {
      const range = meta.ranges.find(r => meta.baseOffset + r.start === charOffset)
      if (range && setIsolatedSelection(range.start, range.end)) {
        // isolated slice built from the row's own range
      } else {
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

    const lang = deps.getEffectiveSegmentLang(segmentIndex)
    const voice = deps.getResolveEffectiveVoice(lang)
    if (!voice?.edge) {
      throw new LocalizedPlaybackError(
        `${UI_TEXT[deps.getLocale() as keyof typeof UI_TEXT].voiceNotConfigured} (${segmentLanguageName(deps.getLocale() as keyof typeof UI_TEXT, lang)})`,
      )
    }

    const controller: { cancelled: boolean; abort: AbortController; cancelAudio?: () => void } = { cancelled: false, abort: new AbortController() }
    deps.setCurrentController(controller)
    deps.setIsPlaying(true)
    deps.setPlaybackEnded(false)
    deps.setLastStatusReason('ready')
    deps.setActiveInfoOffset(charOffset)
    deps.setActiveInfoKind(kind)
    deps.setCurrentSegmentIndex(segmentIndex + 1)
    deps.setTotalSegments(deps.getSessionSegments().length)
    deps.setPlaybackElapsed(0)
    deps.setPlaybackDuration(0)

    if (selFrom >= 0 && selTo >= 0 && selFrom !== selTo) {
      deps.applyPlaybackHighlight(selFrom, selTo)
    }

    try {
      const docId = deps.getCacheScopeId()
      const synth = await getCachedSynthesis(fragmentText, voice.edge, deps.getEffectiveSpeed(), controller.abort.signal, docId)
      if (controller.cancelled) return true
      const duration = await readAudioDuration(synth.blob, controller.abort.signal)
      if (controller.cancelled) return true
      deps.setMetadataAvailable((synth.boundaries.length > 0 || (synth.wordBoundaries?.length ?? 0) > 0))
      deps.setPlaybackDuration(duration)
      const spokenStart = synth.spokenStart ?? 0
      const spokenEnd = kind === 'word' ? undefined : synth.spokenEnd
      const fragmentRanges = splitHighlightRanges(fragmentText)
      const isolatedHighlights = highlightBoundaries(
        { wordBoundaries: synth.wordBoundaries, boundaries: synth.boundaries } as SegmentMeta,
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
            deps.applyPlaybackHighlight(selFrom + trimmed.start, selFrom + trimmed.end)
          }
          return
        }
        const activeRange = activeHighlightRange(fragmentRanges, isolatedHighlights, relativeAt)
        if (activeRange) {
          const trimmed = trimWhitespaceRange(fragmentText, activeRange.start, activeRange.end)
          if (trimmed.end > trimmed.start) {
            deps.applyPlaybackHighlight(selFrom + trimmed.start, selFrom + trimmed.end)
          }
          return
        }
        const fallbackTrimmed = trimWhitespaceRange(fragmentText, 0, fragmentText.length)
        if (fallbackTrimmed.end > fallbackTrimmed.start) {
          deps.applyPlaybackHighlight(selFrom + fallbackTrimmed.start, selFrom + fallbackTrimmed.end)
        }
      }
      await deps.playAudioBlob(
        controller,
        synth.blob,
        isolatedHighlights.length > 0 ? applyIsolatedHighlight : undefined,
        d => {
          deps.setPlaybackDuration(d)
        },
        0,
        spokenStart,
        spokenEnd,
      )
      if (controller.cancelled) return true
      deps.setCurrentController(null)
      deps.setIsPlaying(false)
      deps.setActiveInfoOffset(-1)
      deps.setActiveInfoKind(null)
      deps.setLastStatusReason('finished')
      deps.setStatusMessage(UI_TEXT[deps.getLocale() as keyof typeof UI_TEXT].playbackFinished)
      deps.setPlaybackElapsed(0)
      if (selFrom >= 0 && selTo >= 0) {
        deps.setSessionResumeSelection({ from: selFrom, to: selTo })
      }
      deps.getEditor()?.clearPlaybackHighlight?.()
      return true
    } catch (error) {
      if (controller.cancelled) return true
      deps.setCurrentController(null)
      deps.setIsPlaying(false)
      deps.setActiveInfoOffset(-1)
      deps.setActiveInfoKind(null)
      deps.setLastStatusReason('error')
      deps.setMetadataAvailable(false)
      deps.getEditor()?.clearPlaybackHighlight?.()
      console.error(error)
      deps.setStatusMessage(
        error instanceof LocalizedPlaybackError ? error.message : UI_TEXT[deps.getLocale() as keyof typeof UI_TEXT].playbackFailed,
      )
      return true
    }
  }

  return { playIsolatedFragment }
}
