import { toWrittenLang } from '../tts-reference'
import { splitTtsSegments } from '../tts-reference'
import { getCachedSynthesis, peekCachedSynthesis } from '../tts-client'
import { CANONICAL_SYNTHESIS_RATE, canonicalRate } from '../tts-cache-key'
import { segmentLanguageName } from '../ui-text'
import type { I18nStore } from '../i18n.svelte'
import { hasNonEmptySelection, trimmedContentRange, type ReusableScopedSegment } from './selection-scope'
import { buildSegmentMeta } from './segment-meta'
import { LocalizedPlaybackError, type PlaybackController, type SegmentMeta } from './types'
import { highlightBoundaries, trimWhitespaceRange } from './boundaries'
import { readAudioDuration } from './audio-helpers'

/**
 * Content and locale access.
 */
export interface ContentDeps {
  getContent: () => string
  i18n: I18nStore
  getCacheScopeId: () => string
  getEffectiveSpeed: () => number
}

/**
 * Session state access.
 */
export interface SessionDeps {
  getSession: () => import('./session').PlaybackSession
  getSegmentMetaMap: () => Record<number, SegmentMeta>
  getCurrentController: () => PlaybackController | null
  setCurrentController: (c: PlaybackController | null) => void
}

/**
 * Playback control state.
 */
export interface PlaybackControlDeps {
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
}

/**
 * Editor interaction deps.
 */
export interface EditorScopedDeps {
  getEditor: () => {
    clearPlaybackHighlight?: () => void
    getSelectionRange?: () => { from: number; to: number } | null
    getSelectionText?: () => string
  } | null
  buildReusableScopedSegments: (scoped: { from: number; to: number }, content: string) => ReusableScopedSegment[] | null
  resolveEffectiveVoice: (lang: string) => { edge: string; name: string } | undefined
  resolveScopedPlaybackLang: (scopedText: string, content: string) => string
  applyScopedSession: (input: {
    segments: ReturnType<typeof splitTtsSegments>
    range: { from: number; to: number }
    content: string
    resumeSelection: { from: number; to: number }
  }) => void
  sessionMatchesEditor: (editor: { getSelectionRange: () => { from: number; to: number } | null }, content: string) => boolean
}

/**
 * Segment operations.
 */
export interface SegmentOps {
  clearSegments: () => void
  recordSegmentMeta: (index: number, meta: SegmentMeta) => void
  recordSegment: (index: number, meta: SegmentMeta) => void
  setSegmentDuration: (index: number, duration: number) => void
  pinVoicesForSegments: (segments: { lang: string }[]) => void
  pinVoiceForWrittenLang: (code: string, edge: string) => void
  segmentDurationAt: (index: number) => number
  updateHighlightForPosition: (index: number, at: number) => { from: number; to: number } | null
  applyPlaybackHighlight: (from: number, to: number) => void
}

/**
 * Playback lifecycle callbacks.
 */
export interface ScopedLifecycle {
  finishPlaybackRun: (opts?: {
    resetResume?: boolean
    clearActiveInfo?: boolean
    updateSynthesizedCount?: boolean
  }) => void
  failPlaybackRun: (error: unknown, opts?: {
    clearActiveInfo?: boolean
    clearHighlight?: boolean
  }) => void
  runPlayback: (
    segments: ReturnType<typeof splitTtsSegments>,
    offset: number,
    startIndex: number,
    startAt: number,
    startCharOffset?: number,
  ) => Promise<void>
  stopPlayback: () => void
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

export interface ScopedDeps {
  content: ContentDeps
  session: SessionDeps
  control: PlaybackControlDeps
  editor: EditorScopedDeps
  segment: SegmentOps
  lifecycle: ScopedLifecycle
}

export function createScopedPlayback(deps: ScopedDeps) {
  const { content, session, control, editor, segment, lifecycle } = deps

  function recordReusableScopedMeta(reusable: ReusableScopedSegment[]): void {
    for (let i = 0; i < reusable.length; i += 1) {
      const seg = reusable[i]
      segment.recordSegmentMeta(
        i,
        buildSegmentMeta(
          i,
          session.getSession().segments[i],
          {
            boundaries: seg.boundaries,
            wordBoundaries: seg.wordBoundaries,
            spokenStart: 0,
            spokenEnd: Math.max(0, seg.sourceEndAt - seg.sourceStartAt),
            rate: CANONICAL_SYNTHESIS_RATE,
          },
          seg.indexStart,
        ),
      )
    }
  }

  function finalizeScopedWarmup(reusable: ReusableScopedSegment[] | null, lang: string | null): void {
    control.setMetadataAvailable(true)
    control.setCurrentSegmentIndex(1)
    control.setPlaybackElapsed(0)
    control.setPlaybackDuration(segment.segmentDurationAt(0))
    editor.getEditor()?.clearPlaybackHighlight?.()
    if (reusable) segment.pinVoicesForSegments(reusable)
    else if (lang) segment.pinVoiceForWrittenLang(toWrittenLang(lang), editor.resolveEffectiveVoice(lang)?.edge ?? '')
  }

  function warmSelectionScope(range: { from: number; to: number }): boolean {
    const text = content.getContent()
    const scoped = trimmedContentRange(range, text)
    if (!scoped) return false
    const reusable = editor.buildReusableScopedSegments(scoped, text)
    if (reusable) {
      const newSegments = reusable.map(s => ({
        text: s.text,
        lang: s.lang,
        indexStart: s.indexStart,
        indexEnd: s.indexEnd,
      }))
      editor.applyScopedSession({
        segments: newSegments,
        range,
        content: text,
        resumeSelection: { from: scoped.from, to: scoped.to },
      })
      editor.getEditor()?.clearPlaybackHighlight?.()
      segment.clearSegments()
      recordReusableScopedMeta(reusable)
      if (Object.keys(session.getSegmentMetaMap()).length === 0) return false
      finalizeScopedWarmup(reusable, null)
      return true
    }
    const lang = editor.resolveScopedPlaybackLang(scoped.text, text)
    const voice = editor.resolveEffectiveVoice(lang)
    if (!voice?.edge) return false
    const cached = peekCachedSynthesis(scoped.text, voice.edge)
    if (!cached) return false
    editor.applyScopedSession({
      segments: [{ text: scoped.text, lang, indexStart: scoped.from, indexEnd: scoped.to - 1 }],
      range,
      content: text,
      resumeSelection: { from: scoped.from, to: scoped.to },
    })
    editor.getEditor()?.clearPlaybackHighlight?.()
    segment.clearSegments()
    segment.recordSegmentMeta(
      0,
      buildSegmentMeta(
        0,
        session.getSession().segments[0],
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
    const text = content.getContent()
    const scoped = trimmedContentRange(range, text)
    if (!scoped) return
    const editorRef = editor.getEditor()
    const sess = session.getSession()
    if (
      editorRef &&
      editor.sessionMatchesEditor(editorRef as { getSelectionRange: () => { from: number; to: number } | null }, text) &&
      sess.selectionScoped
    ) {
      if (sess.segments.length === 1) {
        control.setPlaybackEnded(false)
        await lifecycle.runPlayback(sess.segments, sess.offset, sess.resumeIndex, sess.resumeTime)
        return
      }
      const reusableForReuse = editor.buildReusableScopedSegments(scoped, text)
      if (
        reusableForReuse &&
        sess.segments.length === reusableForReuse.length &&
        sess.segments.every((seg, idx) => seg.text === reusableForReuse[idx].text)
      ) {
        control.setPlaybackEnded(false)
        await lifecycle.runPlayback(sess.segments, sess.offset, sess.resumeIndex, sess.resumeTime)
        return
      }
    }
    const lang = editor.resolveScopedPlaybackLang(scoped.text, text)
    const voice = editor.resolveEffectiveVoice(lang)
    if (!voice?.edge) {
      throw new LocalizedPlaybackError(
        `${content.i18n.t('voices.notConfigured')} (${segmentLanguageName(content.i18n.locale, lang)})`,
      )
    }
    const reusable = editor.buildReusableScopedSegments(scoped, text)
    if (reusable) {
      control.setPlaybackEnded(false)
      lifecycle.stopPlayback()
      control.setActiveInfoOffset(-1)
      control.setActiveInfoKind(null)
      const newSegments = reusable.map(s => ({
        text: s.text,
        lang: s.lang,
        indexStart: s.indexStart,
        indexEnd: s.indexEnd,
      }))
      editor.applyScopedSession({
        segments: newSegments,
        range,
        content: text,
        resumeSelection: { from: scoped.from, to: scoped.to },
      })
      segment.clearSegments()
      for (let i = 0; i < reusable.length; i += 1) {
        const seg = reusable[i]
        segment.recordSegmentMeta(
          i,
          buildSegmentMeta(
            i,
            session.getSession().segments[i],
            {
              boundaries: seg.boundaries,
              wordBoundaries: seg.wordBoundaries,
              spokenStart: 0,
              spokenEnd: Math.max(0, seg.sourceEndAt - seg.sourceStartAt),
              rate: CANONICAL_SYNTHESIS_RATE,
            },
            seg.indexStart,
          ),
        )
      }
      if (Object.keys(session.getSegmentMetaMap()).length === 0) {
        // Fallback to single-segment synthesis if slicing produced nothing.
      } else {
        control.setMetadataAvailable(true)
        control.setCurrentSegmentIndex(1)
        control.setPlaybackElapsed(0)
        control.setPlaybackDuration(segment.segmentDurationAt(0))
        segment.pinVoicesForSegments(reusable)
        segment.updateHighlightForPosition(0, 0)
        const controller: PlaybackController = { cancelled: false, abort: new AbortController() }
        session.setCurrentController(controller)
        control.setIsPlaying(true)
        control.setLastStatusReason('ready')
        try {
          control.setMeasuredTotal(0)
          control.setPlayedDuration(0)
          for (let idx = 0; idx < reusable.length; idx += 1) {
            if (controller.cancelled) return
            const seg = reusable[idx]
            const segVoice = editor.resolveEffectiveVoice(seg.lang)
            if (!segVoice?.edge) {
              throw new LocalizedPlaybackError(
                `${content.i18n.t('voices.notConfigured')} (${segmentLanguageName(content.i18n.locale, seg.lang)})`,
              )
            }
            const cached = peekCachedSynthesis(seg.source.text, segVoice.edge)
            if (!cached) throw new Error('Scoped playback lost its source cache entry')
            const meta = session.getSegmentMetaMap()[idx]
            if (!meta) continue
            control.setCurrentSegmentIndex(idx + 1)
            control.setPlaybackDuration(segment.segmentDurationAt(idx))
            control.setPlaybackElapsed(0)
            const segHighlights = highlightBoundaries(meta)
            if (segHighlights.length > 0) segment.updateHighlightForPosition(idx, 0)
            else {
              const trimmed = trimWhitespaceRange(seg.text, 0, seg.text.length)
              segment.applyPlaybackHighlight(seg.indexStart + trimmed.start, seg.indexStart + trimmed.end)
            }
            const slicedStartOrig = seg.sourceStartAt
            const slicedEndOrig = seg.sourceEndAt
            await lifecycle.playAudioBlob(
              controller,
              cached.blob,
              currentTime => {
                const rel = currentTime - slicedStartOrig
                segment.updateHighlightForPosition(idx, rel)
              },
              d => segment.setSegmentDuration(idx, d),
              0,
              slicedStartOrig,
              slicedEndOrig,
            )
            if (controller.cancelled) return
            control.setMeasuredTotal(control.getMeasuredTotal() + segment.segmentDurationAt(idx))
            control.setPlayedDuration(control.getMeasuredTotal())
          }
          lifecycle.finishPlaybackRun({ clearActiveInfo: false })
        } catch (error) {
          if (controller.cancelled) return
          lifecycle.failPlaybackRun(error, { clearActiveInfo: false, clearHighlight: true })
        }
        return
      }
    }
    control.setPlaybackEnded(false)
    lifecycle.stopPlayback()
    control.setActiveInfoOffset(-1)
    control.setActiveInfoKind(null)
    editor.applyScopedSession({
      segments: [{ text: scoped.text, lang, indexStart: scoped.from, indexEnd: scoped.to - 1 }],
      range,
      content: text,
      resumeSelection: { from: scoped.from, to: scoped.to },
    })
    segment.clearSegments()
    const controller: PlaybackController = { cancelled: false, abort: new AbortController() }
    session.setCurrentController(controller)
    control.setIsPlaying(true)
    control.setLastStatusReason('ready')
    control.setCurrentSegmentIndex(1)
    control.setPlaybackElapsed(0)
    control.setPlaybackDuration(0)
    try {
      const synth = await getCachedSynthesis(scoped.text, voice.edge, content.getEffectiveSpeed(), controller.abort.signal, content.getCacheScopeId())
      if (controller.cancelled) return
      const duration = await readAudioDuration(synth.blob, controller.abort.signal)
      if (controller.cancelled) return
      control.setMetadataAvailable(synth.boundaries.length > 0 || (synth.wordBoundaries?.length ?? 0) > 0)
      control.setPlaybackDuration(duration)
      const scopedMeta = buildSegmentMeta(
        0,
        session.getSession().segments[0],
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
      segment.recordSegmentMeta(0, scopedMeta)
      segment.pinVoiceForWrittenLang(toWrittenLang(lang), voice.edge)
      const scopedHighlights = highlightBoundaries(scopedMeta, scopedMeta.wordBoundaries ?? scopedMeta.boundaries)
      const applyHighlight = (currentTime: number) => {
        const relativeAt = currentTime - (synth.spokenStart ?? 0)
        segment.updateHighlightForPosition(0, relativeAt)
      }
      if (scopedHighlights.length > 0) segment.updateHighlightForPosition(0, 0)
      else segment.applyPlaybackHighlight(scoped.from, scoped.to)
      await lifecycle.playAudioBlob(
        controller,
        synth.blob,
        applyHighlight,
        d => {
          control.setPlaybackDuration(d)
          segment.setSegmentDuration(0, d)
        },
        0,
        synth.spokenStart ?? 0,
        synth.spokenEnd,
      )
      if (controller.cancelled) return
      lifecycle.finishPlaybackRun({ clearActiveInfo: false })
    } catch (error) {
      if (controller.cancelled) return
      lifecycle.failPlaybackRun(error, { clearActiveInfo: false, clearHighlight: true })
    }
  }

  return { warmSelectionScope, playSelectedText }
}
