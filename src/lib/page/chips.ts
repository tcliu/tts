import { REFERENCE_LANGUAGES } from '$lib/tts-reference'
import { segmentLanguageName } from '$lib/ui-text'
import { SPEED_OPTIONS } from '$lib/tts-reference'
import type { UiLocale } from '$lib/ui-text'

export function chipVoiceLabel(voice: { name: string; gender: string; edge: string; group?: string }): string {
  const locale = voice.edge.split('-').slice(0, 2).join('-')
  const base = `${voice.name} · ${voice.gender} · ${locale}`
  return voice.group ? `${base} · ${voice.group}` : base
}

export function buildChipLangOptions(locale: UiLocale): { value: string; label: string }[] {
  return REFERENCE_LANGUAGES.map(lang => ({
    value: lang.code,
    label: `${segmentLanguageName(locale, lang.code)} · ${lang.code}`,
  }))
}

export function buildWrittenLabel(locale: UiLocale, positionLanguageCode: string): string {
  return positionLanguageCode ? segmentLanguageName(locale, positionLanguageCode) : ''
}

export function buildVoiceChipOptions(positionLanguageCode: string): { name: string; gender: string; edge: string; group?: string }[] {
  if (!positionLanguageCode) return []
  const lang = REFERENCE_LANGUAGES.find(item => item.code === positionLanguageCode)
  if (!lang) return []
  return lang.voices
}

export function buildChipVoiceOptions(
  voices: { name: string; gender: string; edge: string; group?: string }[],
): { value: string; label: string }[] {
  return voices.map(voice => ({ value: voice.edge, label: chipVoiceLabel(voice) }))
}

export const speedChipOptions = SPEED_OPTIONS

export function handleSpeedChipSelect(playback: { setPlaybackSpeed: (n: number) => void }, value: string): void {
  const next = Number(value)
  if (!Number.isFinite(next)) return
  playback.setPlaybackSpeed(next)
}

export async function handleLangChipSelect(
  playback: { positionSegmentIndex: number; overrideSegmentLanguage: (idx: number, code: string) => Promise<void> },
  code: string,
): Promise<void> {
  const idx = playback.positionSegmentIndex
  if (idx < 0) return
  try {
    await playback.overrideSegmentLanguage(idx, code)
  } catch (error) {
    console.error(error)
  }
}

export async function handleVoiceChipSelect(
  playback: { positionSegmentIndex: number; overrideSegmentVoice: (idx: number, edge: string) => Promise<void> },
  edge: string,
): Promise<void> {
  const idx = playback.positionSegmentIndex
  if (idx < 0) return
  try {
    await playback.overrideSegmentVoice(idx, edge)
  } catch (error) {
    console.error(error)
  }
}
