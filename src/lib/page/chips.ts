import { REFERENCE_LANGUAGES, SPEED_OPTIONS } from '../tts-reference'
import { segmentLanguageName } from '../ui-text'
import type { Locale } from '../i18n.svelte'

function voiceLocale(edge: string): string {
  return edge.split('-').slice(0, 2).join('-')
}

export function chipVoiceLabel(voice: { name: string; gender: string; edge: string; group?: string }): string {
  const locale = voiceLocale(voice.edge)
  const base = `${voice.name} · ${voice.gender} · ${locale}`
  return voice.group ? `${base} · ${voice.group}` : base
}

export function buildChipLangOptions(locale: Locale): { value: string; label: string }[] {
  return REFERENCE_LANGUAGES.map(lang => ({
    value: lang.code,
    label: `${segmentLanguageName(locale, lang.code)} · ${lang.code}`,
  }))
}

export function buildWrittenLabel(locale: Locale, positionLanguageCode: string): string {
  return positionLanguageCode ? segmentLanguageName(locale, positionLanguageCode) : ''
}

export function buildVoiceChipOptions(
  positionLanguageCode: string,
  locale = '',
): { name: string; gender: string; edge: string; group?: string }[] {
  if (!positionLanguageCode) return []
  const lang = REFERENCE_LANGUAGES.find(item => item.code === positionLanguageCode)
  if (!lang) return []
  if (!locale) return lang.voices
  return lang.voices.filter(voice => voiceLocale(voice.edge) === locale)
}

export function buildChipVoiceOptions(
  voices: { name: string; gender: string; edge: string; group?: string }[],
): { value: string; label: string }[] {
  return voices.map(voice => ({ value: voice.edge, label: chipVoiceLabel(voice) }))
}

export function buildChipLocaleOptions(positionLanguageCode: string): { value: string; label: string }[] {
  if (!positionLanguageCode) return []
  const lang = REFERENCE_LANGUAGES.find(item => item.code === positionLanguageCode)
  if (!lang) return []
  const locales = Array.from(new Set(lang.voices.map(voice => voiceLocale(voice.edge))))
  return locales.map(locale => ({ value: locale, label: locale }))
}

export function buildChipGenderOptions(
  positionLanguageCode: string,
  locale: string,
): { value: string; label: string }[] {
  if (!positionLanguageCode) return []
  const lang = REFERENCE_LANGUAGES.find(item => item.code === positionLanguageCode)
  if (!lang) return []
  const genders = Array.from(
    new Set(lang.voices.filter(voice => voiceLocale(voice.edge) === locale).map(voice => voice.gender)),
  )
  return genders.map(gender => ({ value: gender, label: gender }))
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

async function applyVoiceOverride(
  playback: { positionSegmentIndex: number; overrideSegmentVoice: (idx: number, edge: string) => Promise<void> },
  edge: string | undefined,
): Promise<void> {
  const idx = playback.positionSegmentIndex
  if (idx < 0 || !edge) return
  try {
    await playback.overrideSegmentVoice(idx, edge)
  } catch (error) {
    console.error(error)
  }
}

// First match follows reference-languages.json order; reordering the JSON
// changes which voice a locale/gender pick resolves to.
function resolveEdgeForLocale(positionLanguageCode: string, locale: string): string | undefined {
  const lang = REFERENCE_LANGUAGES.find(item => item.code === positionLanguageCode)
  return lang?.voices.find(voice => voiceLocale(voice.edge) === locale)?.edge
}

function resolveEdgeForGender(
  positionLanguageCode: string,
  positionVoiceEdge: string,
  gender: string,
): string | undefined {
  const lang = REFERENCE_LANGUAGES.find(item => item.code === positionLanguageCode)
  const locale = voiceLocale(positionVoiceEdge)
  return lang?.voices.find(voice => voiceLocale(voice.edge) === locale && voice.gender === gender)?.edge
}

export async function handleVoiceChipSelect(
  playback: { positionSegmentIndex: number; overrideSegmentVoice: (idx: number, edge: string) => Promise<void> },
  edge: string,
): Promise<void> {
  await applyVoiceOverride(playback, edge)
}

export async function handleLocaleChipSelect(
  playback: {
    positionSegmentIndex: number
    positionLanguageCode: string
    overrideSegmentVoice: (idx: number, edge: string) => Promise<void>
  },
  locale: string,
): Promise<void> {
  await applyVoiceOverride(playback, resolveEdgeForLocale(playback.positionLanguageCode, locale))
}

export async function handleGenderChipSelect(
  playback: {
    positionSegmentIndex: number
    positionLanguageCode: string
    positionVoiceEdge: string
    overrideSegmentVoice: (idx: number, edge: string) => Promise<void>
  },
  gender: string,
): Promise<void> {
  await applyVoiceOverride(
    playback,
    resolveEdgeForGender(playback.positionLanguageCode, playback.positionVoiceEdge, gender),
  )
}
