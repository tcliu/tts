import { SPEEDS } from '../tts-reference'
import { toWrittenLang } from '../tts-reference'
import { UI_TEXT } from '../ui-text'
import { getCachedSynthesis } from '../tts-client'
import { readAudioDuration } from './audio-helpers'
import { buildSegmentMeta } from '../playback/segment-meta'
import { CANONICAL_SYNTHESIS_RATE } from '../tts-cache-key'
import type { SegmentMeta } from './types'
import type { TtsSegment } from '../tts-reference'
import type { TtsVoice } from '../tts-reference'

export interface VoiceSwitchDeps {
  getSessionSegments: () => TtsSegment[]
  getSegmentMetaMap: () => Record<number, SegmentMeta>
  getSessionOffset: () => number
  getIsPlaying: () => boolean
  getCurrentSegmentIndex: () => number
  getPlaybackEnded: () => boolean
  getCurrentAudio: () => HTMLAudioElement | null
  getPlaybackElapsed: () => number
  setPlaybackElapsed: (v: number) => void
  getResumeSegmentIndex: () => number
  getResumeSegmentTime: () => number
  setResumeSegmentTime: (v: number) => void
  getVoiceSwitchGeneration: () => number
  setVoiceSwitchGeneration: (v: number) => void
  setVoiceSwitching: (v: boolean) => void
  setLastStatusReason: (v: 'ready' | 'stopped' | 'switching' | 'finished' | 'error') => void
  setStatusMessage: (v: string) => void
  setMetadataAvailable: (v: boolean) => void
  getSegmentLangOverrides: () => Map<number, string>
  setSegmentLangOverrides: (v: Map<number, string>) => void
  getSessionVoiceSelections: () => Map<string, string>
  setSessionVoiceSelections: (v: Map<string, string>) => void
  getSessionSpeed: () => number | null
  setSessionSpeed: (v: number | null) => void
  getTaskGeneration: () => Map<number, number>
  getSettings: () => { resolveVoiceForSegment: (lang: string) => TtsVoice | undefined; speed: number; locale: string }
  getCacheScopeId: () => string
  getEffectiveSegmentLang: (index: number) => string
  getResolveEffectiveVoice: (lang: string) => TtsVoice | undefined
  getCharOffsetAtPosition: (index: number, at: number) => number
  getResumeTimeForCharOffset: (index: number, offset: number) => number
  stopPlayback: () => void
  setResumePosition: (index: number, at: number, applySelection?: boolean) => void
  runPlayback: (segments: TtsSegment[], offset: number, startIndex: number, startAt: number) => Promise<void>
  recordSegmentMeta: (index: number, meta: SegmentMeta) => void
  getLocale: () => string
}

export function createVoiceSwitch(deps: VoiceSwitchDeps) {
  let voiceSwitchChain: Promise<void> = Promise.resolve()

  async function resynthesizeSegment(index: number, voiceEdge: string): Promise<void> {
    const sessionSegments = deps.getSessionSegments()
    if (index < 0 || index >= sessionSegments.length) return
    const segment = sessionSegments[index]
    if (!segment) return
    const taskGeneration = deps.getTaskGeneration()
    taskGeneration.set(index, (taskGeneration.get(index) ?? 0) + 1)
    const effectiveLang = deps.getEffectiveSegmentLang(index)
    const effective = { ...segment, lang: effectiveLang }
    const rate = CANONICAL_SYNTHESIS_RATE
    const docId = deps.getCacheScopeId()
    const synth = await getCachedSynthesis(segment.text, voiceEdge, rate, undefined, docId)
    const abort = new AbortController()
    const duration = await readAudioDuration(synth.blob, abort.signal)
    const baseOffset = deps.getSessionOffset() + segment.indexStart
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
    deps.recordSegmentMeta(index, meta)
    // Pin the voice for this language so the chip stays sticky after synthesis
    // (default before synthesis, sticky after). Manual picks overwrite via
    // recordSessionVoiceOverride; this only fills the gap.
    const written = toWrittenLang(effectiveLang)
    if (voiceEdge && !deps.getSessionVoiceSelections().has(written)) {
      const next = new Map(deps.getSessionVoiceSelections())
      next.set(written, voiceEdge)
      deps.setSessionVoiceSelections(next)
    }
  }

  async function overrideSegmentLanguage(index: number, lang: string): Promise<void> {
    const sessionSegments = deps.getSessionSegments()
    if (index < 0 || index >= sessionSegments.length) return
    const effectiveVoice = deps.getSettings().resolveVoiceForSegment(lang)
    const edge = effectiveVoice?.edge
    if (!edge) return
    const next = new Map(deps.getSegmentLangOverrides())
    next.set(index, lang)
    deps.setSegmentLangOverrides(next)
    await resynthesizeSegment(index, edge)
  }

  function recordSessionVoiceOverride(languageCode: string, voiceEdge: string) {
    const next = new Map(deps.getSessionVoiceSelections())
    next.set(languageCode, voiceEdge)
    deps.setSessionVoiceSelections(next)
  }

  function setPlaybackSpeed(speed: number) {
    if (!SPEEDS.includes(speed as (typeof SPEEDS)[number])) return
    if (speed === deps.getSettings().speed) {
      deps.setSessionSpeed(null)
    } else {
      deps.setSessionSpeed(speed)
    }
  }

  async function overrideSegmentVoice(index: number, voiceEdge: string): Promise<void> {
    const sessionSegments = deps.getSessionSegments()
    if (index < 0 || index >= sessionSegments.length) return
    if (deps.getResolveEffectiveVoice(deps.getEffectiveSegmentLang(index))?.edge === voiceEdge) return
    const run = voiceSwitchChain.then(() => applyVoiceOverride(index, voiceEdge))
    voiceSwitchChain = run.catch(() => {})
    await run
  }

  async function applyVoiceOverride(index: number, voiceEdge: string): Promise<void> {
    const sessionSegments = deps.getSessionSegments()
    if (index < 0 || index >= sessionSegments.length) return
    if (deps.getIsPlaying()) {
      await switchVoiceDuringPlayback(Math.max(0, deps.getCurrentSegmentIndex() - 1), voiceEdge)
      return
    }
    const remapResume = index === deps.getResumeSegmentIndex() && deps.getResumeSegmentTime() > 0
    const resumeCharOffset = remapResume ? deps.getCharOffsetAtPosition(index, deps.getResumeSegmentTime()) : null
    try {
      await resynthesizeSegment(index, voiceEdge)
    } catch (error) {
      console.error(error)
      deps.setLastStatusReason('error')
      deps.setMetadataAvailable(false)
      deps.setStatusMessage(UI_TEXT[deps.getLocale() as keyof typeof UI_TEXT].playbackFailed)
      return
    }
    recordSessionVoiceOverride(toWrittenLang(deps.getEffectiveSegmentLang(index)), voiceEdge)
    if (resumeCharOffset != null) {
      const remapped = deps.getResumeTimeForCharOffset(index, resumeCharOffset)
      deps.setResumeSegmentTime(remapped)
      deps.setPlaybackElapsed(remapped)
    }
  }

  async function switchVoiceDuringPlayback(playIndex: number, voiceEdge: string) {
    deps.setVoiceSwitching(true)
    let generation = -1
    try {
      const sessionSegments = deps.getSessionSegments()
      const segment = sessionSegments[playIndex]
      if (!segment) return
      const languageCode = toWrittenLang(deps.getEffectiveSegmentLang(playIndex))
      const audio = deps.getCurrentAudio()
      const segmentMetaMap = deps.getSegmentMetaMap()
      const at = audio
        ? Math.max(0, audio.currentTime - (segmentMetaMap[playIndex]?.spokenStart ?? 0))
        : deps.getPlaybackElapsed()
      const charOffset = deps.getCharOffsetAtPosition(playIndex, at)
      deps.stopPlayback()
      recordSessionVoiceOverride(languageCode, voiceEdge)
      if (deps.getPlaybackEnded()) {
        return
      }
      deps.setLastStatusReason('switching')
      deps.setStatusMessage(UI_TEXT[deps.getLocale() as keyof typeof UI_TEXT].voiceSwitching)
      generation = deps.getVoiceSwitchGeneration() + 1
      deps.setVoiceSwitchGeneration(generation)
      await resynthesizeSegment(playIndex, voiceEdge)
      if (generation !== deps.getVoiceSwitchGeneration()) {
        return
      }
      const targetAt = deps.getResumeTimeForCharOffset(playIndex, charOffset)
      deps.setResumePosition(playIndex, targetAt, true)
      void deps.runPlayback(deps.getSessionSegments(), deps.getSessionOffset(), playIndex, targetAt)
    } catch (error) {
      console.error(error)
      if (generation === deps.getVoiceSwitchGeneration()) {
        deps.setLastStatusReason('error')
        deps.setMetadataAvailable(false)
        deps.setStatusMessage(UI_TEXT[deps.getLocale() as keyof typeof UI_TEXT].playbackFailed)
      }
    } finally {
      deps.setVoiceSwitching(false)
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
