import { toWrittenLang } from '../tts-reference'
import { splitTtsSegments } from '../tts-reference'
import { getCachedSynthesis, peekCachedSynthesis } from '../tts-client'
import { CANONICAL_SYNTHESIS_RATE, canonicalRate } from '../tts-cache-key'
import { UI_TEXT, segmentLanguageName } from '../ui-text'
import { hasNonEmptySelection, trimmedContentRange, type ReusableScopedSegment } from './selection-scope'
import { buildSegmentMeta } from './segment-meta'
import { LocalizedPlaybackError, type PlaybackController, type SegmentMeta } from './types'
import { highlightBoundaries, trimWhitespaceRange } from './boundaries'
import { readAudioDuration } from './audio-helpers'

export interface ScopedDeps {
  getContent: () => string
  getLocale: () => string
  getCacheScopeId: () => string
  getEffectiveSpeed: () => number
  getSession: () => import('./session').PlaybackSession
  getSegmentMetaMap: () => Record<number, SegmentMeta>
  getCurrentController: () => PlaybackController | null
  setCurrentController: (c: PlaybackController | null) => void
  getIsPlaying: () => boolean
  setIsPlaying: (v: boolean) => void
  getPlaybackEnded: () => boolean
  setPlaybackEnded: (v: boolean) => void
  getLastStatusReason: () => string
  setLastStatusReason: (v: 'ready' | 'stopped' | 'switching' | 'finished' | 'error') => void
  getActiveInfoOffset: () => number
  setActiveInfoOffset: (v: number) => void
  getActiveInfoKind: () => string | null
  setActiveInfoKind: (v: 'sentence' | 'word' | null) => void
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
  getMetadataAvailable: () => boolean
  setMetadataAvailable: (v: boolean) => void
  getStatusMessage: () => string
  setStatusMessage: (v: string) => void
  getEditor: () => { clearPlaybackHighlight?: () => void; getSelectionRange?: () => { from: number; to: number } | null; getSelectionText?: () => string } | null
  buildReusableScopedSegments: (scoped: { from: number; to: number }, content: string) => ReusableScopedSegment[] | null
  resolveEffectiveVoice: (lang: string) => { edge: string; name: string } | undefined
  resolveScopedPlaybackLang: (scopedText: string, content: string) => string
  applyScopedSession: (input: { segments: ReturnType<typeof splitTtsSegments>; range: { from: number; to: number }; content: string; resumeSelection: { from: number; to: number } }) => void
  clearSegments: () => void
  recordSegmentMeta: (index: number, meta: SegmentMeta) => void
  recordSegment: (index: number, meta: SegmentMeta) => void
  setSegmentDuration: (index: number, duration: number) => void
  pinVoicesForSegments: (segments: { lang: string }[]) => void
  pinVoiceForWrittenLang: (code: string, edge: string) => void
  segmentDurationAt: (index: number) => number
  updateHighlightForPosition: (index: number, at: number) => { from: number; to: number } | null
  applyPlaybackHighlight: (from: number, to: number) => void
  finishPlaybackRun: (opts?: { resetResume?: boolean; clearActiveInfo?: boolean; updateSynthesizedCount?: boolean }) => void
  failPlaybackRun: (error: unknown, opts?: { clearActiveInfo?: boolean; clearHighlight?: boolean }) => void
  runPlayback: (segments: ReturnType<typeof splitTtsSegments>, offset: number, startIndex: number, startAt: number, startCharOffset?: number) => Promise<void>
  stopPlayback: () => void
  sessionMatchesEditor: (editor: { getSelectionRange: () => { from: number; to: number } | null }, content: string) => boolean
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

export function createScopedPlayback(deps: ScopedDeps) {
  function recordReusableScopedMeta(reusable: ReusableScopedSegment[]): void {
    for (let i = 0; i < reusable.length; i += 1) {
      const segment = reusable[i]
      deps.recordSegmentMeta(
        i,
        buildSegmentMeta(
          i,
          deps.getSession().segments[i],
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

  function finalizeScopedWarmup(reusable: ReusableScopedSegment[] | null, lang: string | null): void {
    deps.setMetadataAvailable(true)
    deps.setCurrentSegmentIndex(1)
    deps.setPlaybackElapsed(0)
    deps.setPlaybackDuration(deps.segmentDurationAt(0))
    deps.getEditor()?.clearPlaybackHighlight?.()
    if (reusable) deps.pinVoicesForSegments(reusable)
    else if (lang) deps.pinVoiceForWrittenLang(toWrittenLang(lang), deps.resolveEffectiveVoice(lang)?.edge ?? '')
  }

  function warmSelectionScope(range: { from: number; to: number }): boolean {
    const content = deps.getContent()
    const scoped = trimmedContentRange(range, content)
    if (!scoped) return false
    const reusable = deps.buildReusableScopedSegments(scoped, content)
    if (reusable) {
      const newSegments = reusable.map(segment => ({
        text: segment.text,
        lang: segment.lang,
        indexStart: segment.indexStart,
        indexEnd: segment.indexEnd,
      }))
      deps.applyScopedSession({ segments: newSegments, range, content, resumeSelection: { from: scoped.from, to: scoped.to } })
      deps.getEditor()?.clearPlaybackHighlight?.()
      deps.clearSegments()
      recordReusableScopedMeta(reusable)
      if (Object.keys(deps.getSegmentMetaMap()).length === 0) return false
      finalizeScopedWarmup(reusable, null)
      return true
    }
    const lang = deps.resolveScopedPlaybackLang(scoped.text, content)
    const voice = deps.resolveEffectiveVoice(lang)
    if (!voice?.edge) return false
    const cached = peekCachedSynthesis(scoped.text, voice.edge)
    if (!cached) return false
    deps.applyScopedSession({
      segments: [{ text: scoped.text, lang, indexStart: scoped.from, indexEnd: scoped.to - 1 }],
      range,
      content,
      resumeSelection: { from: scoped.from, to: scoped.to },
    })
    deps.getEditor()?.clearPlaybackHighlight?.()
    deps.clearSegments()
    deps.recordSegmentMeta(
      0,
      buildSegmentMeta(
        0,
        deps.getSession().segments[0],
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

  async function playSelectedText(range: { from: number; to: number }): Promise<void> {
    const content = deps.getContent()
    const scoped = trimmedContentRange(range, content)
    if (!scoped) return
    const editor = deps.getEditor()
    const session = deps.getSession()
    if (editor && deps.sessionMatchesEditor(editor as { getSelectionRange: () => { from: number; to: number } | null }, content) && session.selectionScoped) {
      if (session.segments.length === 1) {
        deps.setPlaybackEnded(false)
        await deps.runPlayback(session.segments, session.offset, session.resumeIndex, session.resumeTime)
        return
      }
      const reusableForReuse = deps.buildReusableScopedSegments(scoped, content)
      if (
        reusableForReuse &&
        session.segments.length === reusableForReuse.length &&
        session.segments.every((seg, idx) => seg.text === reusableForReuse[idx].text)
      ) {
        deps.setPlaybackEnded(false)
        await deps.runPlayback(session.segments, session.offset, session.resumeIndex, session.resumeTime)
        return
      }
    }
    const lang = deps.resolveScopedPlaybackLang(scoped.text, content)
    const voice = deps.resolveEffectiveVoice(lang)
    if (!voice?.edge) {
      throw new LocalizedPlaybackError(`${UI_TEXT[deps.getLocale() as keyof typeof UI_TEXT].voiceNotConfigured} (${segmentLanguageName(deps.getLocale() as keyof typeof UI_TEXT, lang)})`)
    }
    const reusable = deps.buildReusableScopedSegments(scoped, content)
    if (reusable) {
      deps.setPlaybackEnded(false)
      deps.stopPlayback()
      deps.setActiveInfoOffset(-1)
      deps.setActiveInfoKind(null)
      const newSegments = reusable.map(segment => ({
        text: segment.text,
        lang: segment.lang,
        indexStart: segment.indexStart,
        indexEnd: segment.indexEnd,
      }))
      deps.applyScopedSession({ segments: newSegments, range, content, resumeSelection: { from: scoped.from, to: scoped.to } })
      deps.clearSegments()
      for (let i = 0; i < reusable.length; i += 1) {
        const segment = reusable[i]
        deps.recordSegmentMeta(
          i,
          buildSegmentMeta(
            i,
            deps.getSession().segments[i],
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
      if (Object.keys(deps.getSegmentMetaMap()).length === 0) {
        // Fallback to single-segment synthesis if slicing produced nothing.
      } else {
        deps.setMetadataAvailable(true)
        deps.setCurrentSegmentIndex(1)
        deps.setPlaybackElapsed(0)
        deps.setPlaybackDuration(deps.segmentDurationAt(0))
        deps.pinVoicesForSegments(reusable)
        deps.updateHighlightForPosition(0, 0)
        const controller: PlaybackController = { cancelled: false, abort: new AbortController() }
        deps.setCurrentController(controller)
        deps.setIsPlaying(true)
        deps.setLastStatusReason('ready')
        try {
          deps.setMeasuredTotal(0)
          deps.setPlayedDuration(0)
          for (let idx = 0; idx < reusable.length; idx += 1) {
            if (controller.cancelled) return
            const segment = reusable[idx]
            const segVoice = deps.resolveEffectiveVoice(segment.lang)
            if (!segVoice?.edge) {
              throw new LocalizedPlaybackError(`${UI_TEXT[deps.getLocale() as keyof typeof UI_TEXT].voiceNotConfigured} (${segmentLanguageName(deps.getLocale() as keyof typeof UI_TEXT, segment.lang)})`)
            }
            const cached = peekCachedSynthesis(segment.source.text, segVoice.edge)
            if (!cached) throw new Error('Scoped playback lost its source cache entry')
            const meta = deps.getSegmentMetaMap()[idx]
            if (!meta) continue
            deps.setCurrentSegmentIndex(idx + 1)
            deps.setPlaybackDuration(deps.segmentDurationAt(idx))
            deps.setPlaybackElapsed(0)
            const segHighlights = highlightBoundaries(meta)
            if (segHighlights.length > 0) deps.updateHighlightForPosition(idx, 0)
            else {
              const trimmed = trimWhitespaceRange(segment.text, 0, segment.text.length)
              deps.applyPlaybackHighlight(segment.indexStart + trimmed.start, segment.indexStart + trimmed.end)
            }
            const slicedStartOrig = segment.sourceStartAt
            const slicedEndOrig = segment.sourceEndAt
            await deps.playAudioBlob(
              controller,
              cached.blob,
              currentTime => {
                const rel = currentTime - slicedStartOrig
                deps.updateHighlightForPosition(idx, rel)
              },
              d => deps.setSegmentDuration(idx, d),
              0,
              slicedStartOrig,
              slicedEndOrig,
            )
            if (controller.cancelled) return
            deps.setMeasuredTotal(deps.getMeasuredTotal() + deps.segmentDurationAt(idx))
            deps.setPlayedDuration(deps.getMeasuredTotal())
          }
          deps.finishPlaybackRun({ clearActiveInfo: false })
        } catch (error) {
          if (controller.cancelled) return
          deps.failPlaybackRun(error, { clearActiveInfo: false, clearHighlight: true })
        }
        return
      }
    }
    deps.setPlaybackEnded(false)
    deps.stopPlayback()
    deps.setActiveInfoOffset(-1)
    deps.setActiveInfoKind(null)
    deps.applyScopedSession({
      segments: [{ text: scoped.text, lang, indexStart: scoped.from, indexEnd: scoped.to - 1 }],
      range,
      content,
      resumeSelection: { from: scoped.from, to: scoped.to },
    })
    deps.clearSegments()
    const controller: PlaybackController = { cancelled: false, abort: new AbortController() }
    deps.setCurrentController(controller)
    deps.setIsPlaying(true)
    deps.setLastStatusReason('ready')
    deps.setCurrentSegmentIndex(1)
    deps.setPlaybackElapsed(0)
    deps.setPlaybackDuration(0)
    try {
      const synth = await getCachedSynthesis(scoped.text, voice.edge, deps.getEffectiveSpeed(), controller.abort.signal, deps.getCacheScopeId())
      if (controller.cancelled) return
      const duration = await readAudioDuration(synth.blob, controller.abort.signal)
      if (controller.cancelled) return
      deps.setMetadataAvailable(synth.boundaries.length > 0 || (synth.wordBoundaries?.length ?? 0) > 0)
      deps.setPlaybackDuration(duration)
      const scopedMeta = buildSegmentMeta(
        0,
        deps.getSession().segments[0],
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
      deps.recordSegmentMeta(0, scopedMeta)
      deps.pinVoiceForWrittenLang(toWrittenLang(lang), voice.edge)
      const scopedHighlights = highlightBoundaries(scopedMeta, scopedMeta.wordBoundaries ?? scopedMeta.boundaries)
      const applyHighlight = (currentTime: number) => {
        const relativeAt = currentTime - (synth.spokenStart ?? 0)
        deps.updateHighlightForPosition(0, relativeAt)
      }
      if (scopedHighlights.length > 0) deps.updateHighlightForPosition(0, 0)
      else deps.applyPlaybackHighlight(scoped.from, scoped.to)
      await deps.playAudioBlob(
        controller,
        synth.blob,
        applyHighlight,
        d => {
          deps.setPlaybackDuration(d)
          deps.setSegmentDuration(0, d)
        },
        0,
        synth.spokenStart ?? 0,
        synth.spokenEnd,
      )
      if (controller.cancelled) return
      deps.finishPlaybackRun({ clearActiveInfo: false })
    } catch (error) {
      if (controller.cancelled) return
      deps.failPlaybackRun(error, { clearActiveInfo: false, clearHighlight: true })
    }
  }

  return { warmSelectionScope, playSelectedText }
}
