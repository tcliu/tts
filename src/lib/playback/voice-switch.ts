import { SPEEDS } from '../tts-reference'
import { toWrittenLang } from '../tts-reference'
import { UI_TEXT } from '../ui-text'
import { getCachedSynthesis } from '../tts-client'
import { readAudioDuration } from './audio-helpers'
import { buildSegmentMeta } from '../playback/segment-meta'
import { CANONICAL_SYNTHESIS_RATE } from '../tts-cache-key'
import type { SegmentMeta, StatusReason } from './types'
import type { TtsSegment } from '../tts-reference'
import type { TtsVoice } from '../tts-reference'

/**
 * Session state for voice switching.
 */
export interface VoiceSwitchSession {
  getSegments: () => TtsSegment[]
  getMetaMap: () => Record<number, SegmentMeta>
  getOffset: () => number
  getLangOverrides: () => Map<number, string>
  setLangOverrides: (v: Map<number, string>) => void
  getVoiceSelections: () => Map<string, string>
  setVoiceSelections: (v: Map<string, string>) => void
  getSpeed: () => number | null
  setSpeed: (v: number | null) => void
  getTaskGeneration: () => Map<number, number>
}

/**
 * Playback state for voice switching.
 */
export interface VoiceSwitchPlayback {
  getIsPlaying: () => boolean
  getCurrentSegmentIndex: () => number
  getPlaybackEnded: () => boolean
  getCurrentAudio: () => HTMLAudioElement | null
  getPlaybackElapsed: () => number
  setPlaybackElapsed: (v: number) => void
  getResumeIndex: () => number
  getResumeTime: () => number
  setResumeTime: (v: number) => void
  getSwitchGeneration: () => number
  setSwitchGeneration: (v: number) => void
  setSwitching: (v: boolean) => void
  setLastStatusReason: (v: StatusReason) => void
  setStatusMessage: (v: string) => void
  setMetadataAvailable: (v: boolean) => void
}

/**
 * Voice resolution functions.
 */
export interface VoiceResolvers {
  getEffectiveSegmentLang: (index: number) => string
  getResolveEffectiveVoice: (lang: string) => TtsVoice | undefined
  resolveVoiceForSegment: (lang: string) => TtsVoice | undefined
}

/**
 * Operations for voice switching.
 */
export interface VoiceSwitchOps {
  getCacheScopeId: () => string
  getCharOffsetAtPosition: (index: number, at: number) => number
  getResumeTimeForCharOffset: (index: number, offset: number) => number
  stopPlayback: () => void
  setResumePosition: (index: number, at: number, applySelection?: boolean) => void
  runPlayback: (segments: TtsSegment[], offset: number, startIndex: number, startAt: number) => Promise<void>
  recordSegmentMeta: (index: number, meta: SegmentMeta) => void
}

export interface VoiceSwitchDeps {
  session: VoiceSwitchSession
  playback: VoiceSwitchPlayback
  voice: VoiceResolvers
  ops: VoiceSwitchOps
  locale: string
  defaultSpeed: number
}

export function createVoiceSwitch(deps: VoiceSwitchDeps) {
  const { session, playback, voice, ops } = deps
  let voiceSwitchChain: Promise<void> = Promise.resolve()

  async function resynthesizeSegment(index: number, voiceEdge: string): Promise<void> {
    const segments = session.getSegments()
    if (index < 0 || index >= segments.length) return
    const segment = segments[index]
    if (!segment) return
    const taskGeneration = session.getTaskGeneration()
    taskGeneration.set(index, (taskGeneration.get(index) ?? 0) + 1)
    const effectiveLang = voice.getEffectiveSegmentLang(index)
    const effective = { ...segment, lang: effectiveLang }
    const rate = CANONICAL_SYNTHESIS_RATE
    const docId = ops.getCacheScopeId()
    const synth = await getCachedSynthesis(segment.text, voiceEdge, rate, undefined, docId)
    const abort = new AbortController()
    const duration = await readAudioDuration(synth.blob, abort.signal)
    const baseOffset = session.getOffset() + segment.indexStart
    const meta = buildSegmentMeta(
      index,
      effective,
      {
        boundaries: synth.boundaries,
        wordBoundaries: synth.wordBoundaries,
        duration,
        spokenStart: synth.spokenStart,
        spokenEnd: synth.spokenEnd,
        rate,
      },
      baseOffset,
    )
    ops.recordSegmentMeta(index, meta)
    // Pin the voice for this language so the chip stays sticky after synthesis
    // (default before synthesis, sticky after). Manual picks overwrite via
    // recordSessionVoiceOverride; this only fills the gap.
    const written = toWrittenLang(effectiveLang)
    if (voiceEdge && !session.getVoiceSelections().has(written)) {
      const next = new Map(session.getVoiceSelections())
      next.set(written, voiceEdge)
      session.setVoiceSelections(next)
    }
  }

  async function overrideSegmentLanguage(index: number, lang: string): Promise<void> {
    const segments = session.getSegments()
    if (index < 0 || index >= segments.length) return
    const effectiveVoice = voice.resolveVoiceForSegment(lang)
    const edge = effectiveVoice?.edge
    if (!edge) return
    const next = new Map(session.getLangOverrides())
    next.set(index, lang)
    session.setLangOverrides(next)
    // Gate Play/seek while the new language synthesizes, mirroring the
    // voice path. Errors propagate as before; the flag always resets.
    playback.setSwitching(true)
    try {
      await resynthesizeSegment(index, edge)
    } finally {
      playback.setSwitching(false)
    }
  }

  function recordSessionVoiceOverride(languageCode: string, voiceEdge: string) {
    const next = new Map(session.getVoiceSelections())
    next.set(languageCode, voiceEdge)
    session.setVoiceSelections(next)
  }

  function setPlaybackSpeed(speed: number) {
    if (!SPEEDS.includes(speed as (typeof SPEEDS)[number])) return
    if (speed === deps.defaultSpeed) {
      session.setSpeed(null)
    } else {
      session.setSpeed(speed)
    }
  }

  async function overrideSegmentVoice(index: number, voiceEdge: string): Promise<void> {
    const segments = session.getSegments()
    if (index < 0 || index >= segments.length) return
    if (voice.getResolveEffectiveVoice(voice.getEffectiveSegmentLang(index))?.edge === voiceEdge) return
    const run = voiceSwitchChain.then(() => applyVoiceOverride(index, voiceEdge))
    voiceSwitchChain = run.catch(() => {})
    await run
  }

  async function applyVoiceOverride(index: number, voiceEdge: string): Promise<void> {
    const segments = session.getSegments()
    if (index < 0 || index >= segments.length) return
    if (playback.getIsPlaying()) {
      await switchVoiceDuringPlayback(Math.max(0, playback.getCurrentSegmentIndex() - 1), voiceEdge)
      return
    }
    const remapResume = index === playback.getResumeIndex() && playback.getResumeTime() > 0
    const resumeCharOffset = remapResume ? ops.getCharOffsetAtPosition(index, playback.getResumeTime()) : null
    // Optimistic: the chip label derives from the effective voice, so record
    // first and the UI flips instantly while synthesis runs in the background.
    const langKey = toWrittenLang(voice.getEffectiveSegmentLang(index))
    const prevEdge = session.getVoiceSelections().get(langKey)
    recordSessionVoiceOverride(langKey, voiceEdge)
    playback.setSwitching(true)
    try {
      await resynthesizeSegment(index, voiceEdge)
    } catch (error) {
      // Roll back so a failed switch keeps the previous voice (and label).
      const next = new Map(session.getVoiceSelections())
      if (prevEdge === undefined) next.delete(langKey)
      else next.set(langKey, prevEdge)
      session.setVoiceSelections(next)
      console.error(error)
      playback.setLastStatusReason('error')
      playback.setMetadataAvailable(false)
      playback.setStatusMessage(UI_TEXT[deps.locale as keyof typeof UI_TEXT].playback.failed)
      return
    } finally {
      playback.setSwitching(false)
    }
    if (resumeCharOffset != null) {
      const remapped = ops.getResumeTimeForCharOffset(index, resumeCharOffset)
      playback.setResumeTime(remapped)
      playback.setPlaybackElapsed(remapped)
    }
  }

  async function switchVoiceDuringPlayback(playIndex: number, voiceEdge: string) {
    playback.setSwitching(true)
    let generation = -1
    try {
      const segments = session.getSegments()
      const segment = segments[playIndex]
      if (!segment) return
      const languageCode = toWrittenLang(voice.getEffectiveSegmentLang(playIndex))
      const audio = playback.getCurrentAudio()
      const metaMap = session.getMetaMap()
      const at = audio
        ? Math.max(0, audio.currentTime - (metaMap[playIndex]?.spokenStart ?? 0))
        : playback.getPlaybackElapsed()
      const charOffset = ops.getCharOffsetAtPosition(playIndex, at)
      ops.stopPlayback()
      recordSessionVoiceOverride(languageCode, voiceEdge)
      if (playback.getPlaybackEnded()) {
        return
      }
      playback.setLastStatusReason('switching')
      playback.setStatusMessage(UI_TEXT[deps.locale as keyof typeof UI_TEXT].playback.switching)
      generation = playback.getSwitchGeneration() + 1
      playback.setSwitchGeneration(generation)
      await resynthesizeSegment(playIndex, voiceEdge)
      if (generation !== playback.getSwitchGeneration()) {
        return
      }
      const targetAt = ops.getResumeTimeForCharOffset(playIndex, charOffset)
      ops.setResumePosition(playIndex, targetAt, true)
      void ops.runPlayback(session.getSegments(), session.getOffset(), playIndex, targetAt)
    } catch (error) {
      console.error(error)
      if (generation === playback.getSwitchGeneration()) {
        playback.setLastStatusReason('error')
        playback.setMetadataAvailable(false)
        playback.setStatusMessage(UI_TEXT[deps.locale as keyof typeof UI_TEXT].playback.failed)
      }
    } finally {
      playback.setSwitching(false)
    }
  }

  return {
    resynthesizeSegment,
    overrideSegmentLanguage,
    overrideSegmentVoice,
    recordSessionVoiceOverride,
    setPlaybackSpeed,
    // exposed for testing / wiring
    _voiceSwitchChain: () => voiceSwitchChain,
  }
}
