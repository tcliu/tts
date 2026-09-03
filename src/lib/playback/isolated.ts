import { UI_TEXT } from '../ui-text'
import { segmentLanguageName } from '../ui-text'
import { splitHighlightRanges } from '../tts-reference'
import { trimWhitespaceRange, highlightBoundaries, activeBoundaryAt } from './boundaries'
import { activeHighlightRange } from '../tts-reference'
import { getCachedSynthesis } from '../tts-client'
import { readAudioDuration } from './audio-helpers'
import { LocalizedPlaybackError, type SegmentMeta, type PlaybackController, type StatusReason } from './types'

/**
 * Mutable playback state setters for isolated playback.
 */
export interface IsolatedState {
  setController: (c: PlaybackController | null) => void
  setIsPlaying: (v: boolean) => void
  setPlaybackEnded: (v: boolean) => void
  setLastStatusReason: (v: StatusReason) => void
  setActiveInfoOffset: (v: number) => void
  setActiveInfoKind: (v: 'sentence' | 'word' | null) => void
  setCurrentSegmentIndex: (v: number) => void
  setTotalSegments: (v: number) => void
  setPlaybackElapsed: (v: number) => void
  setPlaybackDuration: (v: number) => void
  setMetadataAvailable: (v: boolean) => void
  setStatusMessage: (v: string) => void
  setResumeSelection: (v: { from: number; to: number } | null) => void
}

/**
 * Context for isolated playback (read-only values).
 */
export interface IsolatedContext {
  get sessionOffset(): number
  get effectiveSpeed(): number
  get cacheScopeId(): string
  get locale(): string
  get sessionSegmentsLength(): number
}

/**
 * Audio and highlight operations.
 */
export interface IsolatedAudio {
  playAudioBlob: (
    controller: PlaybackController,
    blob: Blob,
    onProgress?: (currentTime: number) => void,
    onDuration?: (duration: number) => void,
    startAt?: number,
    spokenStart?: number,
    spokenEnd?: number,
  ) => Promise<void>
  applyPlaybackHighlight: (from: number, to: number) => void
  clearPlaybackHighlight: () => void
}

/**
 * Voice resolution for isolated playback.
 */
export interface IsolatedVoice {
  getEffectiveSegmentLang: (index: number) => string
  getResolveEffectiveVoice: (lang: string) => { edge: string; name: string } | undefined
}

export interface IsolatedDeps {
  state: IsolatedState
  context: IsolatedContext
  audio: IsolatedAudio
  voice: IsolatedVoice
}

export function createIsolatedPlayer(deps: IsolatedDeps) {
  const { state, context, audio, voice } = deps

  async function playIsolatedFragment(
    kind: 'sentence' | 'word',
    segmentIndex: number,
    charOffset: number,
    meta: SegmentMeta,
    segment: { text: string; indexStart: number },
  ): Promise<boolean> {
    const absoluteBase = context.sessionOffset + segment.indexStart
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

    const lang = voice.getEffectiveSegmentLang(segmentIndex)
    const resolvedVoice = voice.getResolveEffectiveVoice(lang)
    if (!resolvedVoice?.edge) {
      throw new LocalizedPlaybackError(
        `${UI_TEXT[context.locale as keyof typeof UI_TEXT].voiceNotConfigured} (${segmentLanguageName(context.locale as keyof typeof UI_TEXT, lang)})`,
      )
    }

    const controller: PlaybackController = { cancelled: false, abort: new AbortController() }
    state.setController(controller)
    state.setIsPlaying(true)
    state.setPlaybackEnded(false)
    state.setLastStatusReason('ready')
    state.setActiveInfoOffset(charOffset)
    state.setActiveInfoKind(kind)
    state.setCurrentSegmentIndex(segmentIndex + 1)
    state.setTotalSegments(context.sessionSegmentsLength)
    state.setPlaybackElapsed(0)
    state.setPlaybackDuration(0)

    if (selFrom >= 0 && selTo >= 0 && selFrom !== selTo) {
      audio.applyPlaybackHighlight(selFrom, selTo)
    }

    try {
      const synth = await getCachedSynthesis(fragmentText, resolvedVoice.edge, context.effectiveSpeed, controller.abort.signal, context.cacheScopeId)
      if (controller.cancelled) return true
      const duration = await readAudioDuration(synth.blob, controller.abort.signal)
      if (controller.cancelled) return true
      state.setMetadataAvailable((synth.boundaries.length > 0 || (synth.wordBoundaries?.length ?? 0) > 0))
      state.setPlaybackDuration(duration)
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
            audio.applyPlaybackHighlight(selFrom + trimmed.start, selFrom + trimmed.end)
          }
          return
        }
        const activeRange = activeHighlightRange(fragmentRanges, isolatedHighlights, relativeAt)
        if (activeRange) {
          const trimmed = trimWhitespaceRange(fragmentText, activeRange.start, activeRange.end)
          if (trimmed.end > trimmed.start) {
            audio.applyPlaybackHighlight(selFrom + trimmed.start, selFrom + trimmed.end)
          }
          return
        }
        const fallbackTrimmed = trimWhitespaceRange(fragmentText, 0, fragmentText.length)
        if (fallbackTrimmed.end > fallbackTrimmed.start) {
          audio.applyPlaybackHighlight(selFrom + fallbackTrimmed.start, selFrom + fallbackTrimmed.end)
        }
      }
      await audio.playAudioBlob(
        controller,
        synth.blob,
        isolatedHighlights.length > 0 ? applyIsolatedHighlight : undefined,
        d => state.setPlaybackDuration(d),
        0,
        spokenStart,
        spokenEnd,
      )
      if (controller.cancelled) return true
      state.setController(null)
      state.setIsPlaying(false)
      state.setActiveInfoOffset(-1)
      state.setActiveInfoKind(null)
      state.setLastStatusReason('finished')
      state.setStatusMessage(UI_TEXT[context.locale as keyof typeof UI_TEXT].playbackFinished)
      state.setPlaybackElapsed(0)
      if (selFrom >= 0 && selTo >= 0) {
        state.setResumeSelection({ from: selFrom, to: selTo })
      }
      audio.clearPlaybackHighlight()
      return true
    } catch (error) {
      if (controller.cancelled) return true
      state.setController(null)
      state.setIsPlaying(false)
      state.setActiveInfoOffset(-1)
      state.setActiveInfoKind(null)
      state.setLastStatusReason('error')
      state.setMetadataAvailable(false)
      audio.clearPlaybackHighlight()
      console.error(error)
      state.setStatusMessage(
        error instanceof LocalizedPlaybackError ? error.message : UI_TEXT[context.locale as keyof typeof UI_TEXT].playbackFailed,
      )
      return true
    }
  }

  return { playIsolatedFragment }
}
