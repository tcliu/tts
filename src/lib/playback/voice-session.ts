import { REFERENCE_LANGUAGES, toWrittenLang } from '../tts-reference'
import type { TtsVoice } from '../tts-reference'
import type { PlaybackSession } from './session'

export function effectiveSegmentLang(session: PlaybackSession, index: number): string {
  if (index < 0 || index >= session.segments.length) return ''
  return session.langOverrides.get(index) ?? session.segments[index]?.lang ?? ''
}

export function resolveEffectiveVoiceForWrittenLang(
  session: PlaybackSession,
  languageCode: string,
  fallback: (code: string) => TtsVoice | undefined,
): TtsVoice | undefined {
  const overrideEdge = session.voiceSelections.get(languageCode)
  if (overrideEdge) {
    const voice = REFERENCE_LANGUAGES.find(item => item.code === languageCode)?.voices.find(item => item.edge === overrideEdge)
    if (voice) return voice
  }
  return fallback(languageCode)
}

export function resolveEffectiveVoice(
  session: PlaybackSession,
  segmentLang: string,
  fallback: (code: string) => TtsVoice | undefined,
): TtsVoice | undefined {
  return resolveEffectiveVoiceForWrittenLang(session, toWrittenLang(segmentLang), fallback)
}

export function pinVoiceForWrittenLang(session: PlaybackSession, languageCode: string, edge: string): void {
  if (!edge) return
  if (session.voiceSelections.has(languageCode)) return
  const next = new Map(session.voiceSelections)
  next.set(languageCode, edge)
  session.voiceSelections = next
}

export function pinVoicesForSegments(
  session: PlaybackSession,
  segments: { lang: string }[],
  fallback: (code: string) => TtsVoice | undefined,
): void {
  for (const segment of segments) {
    const written = toWrittenLang(segment.lang)
    if (session.voiceSelections.has(written)) continue
    const edge = resolveEffectiveVoice(session, segment.lang, fallback)?.edge
    if (edge) pinVoiceForWrittenLang(session, written, edge)
  }
}
