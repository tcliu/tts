import { REFERENCE_LANGUAGES } from '../tts-reference'
import { segmentLanguageName } from '../ui-text'
import type { Locale } from '../i18n.svelte'
import type { SynthesisCacheEntry } from '../tts-client'

export const VOICE_LOOKUP = new Map(
  REFERENCE_LANGUAGES.flatMap(language =>
    language.voices.map(voice => [
      voice.edge,
      {
        languageCode: language.code,
        languageName: language.name,
        voiceName: voice.name,
        gender: voice.gender,
        group: voice.group ?? '',
      },
    ]),
  ),
)

export function voiceMeta(entry: SynthesisCacheEntry) {
  return VOICE_LOOKUP.get(entry.voiceId)
}

export function voiceLabel(entry: SynthesisCacheEntry): string {
  const meta = voiceMeta(entry)
  if (!meta && !entry.voiceId) return '\u2014'
  if (!meta) return entry.voiceId
  const pieces = [meta.voiceName, meta.gender]
  if (meta.group) pieces.push(meta.group)
  return pieces.join(' \u00b7 ')
}

export function languageLabel(entry: SynthesisCacheEntry, locale: Locale): string {
  const code = voiceMeta(entry)?.languageCode
  return code ? `${segmentLanguageName(locale, code)} \u00b7 ${code}` : '\u2014'
}

export function snippet(textValue: string): string {
  const trimmed = textValue.trim()
  if (!trimmed) return '\u2014'
  return trimmed.length > 160 ? `${trimmed.slice(0, 160)}...` : trimmed
}
