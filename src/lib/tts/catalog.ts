import referenceLanguages from '../reference-languages.json'

export interface TtsVoice {
  name: string
  gender: 'Female' | 'Male'
  source: 'edge'
  edge: string
  group?: string
}

export interface TtsLanguage {
  code: string
  name: string
  voices: TtsVoice[]
  aliases?: string[]
}

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3] as const

export const SPEED_OPTIONS = SPEEDS.map(value => ({ value: String(value), label: `${value}x` }))

export const SPEED_STEP = (() => {
  let step = SPEEDS[1] - SPEEDS[0]
  for (let i = 1; i < SPEEDS.length - 1; i += 1) step = Math.min(step, SPEEDS[i + 1] - SPEEDS[i])
  return step
})()

export const REFERENCE_LANGUAGES: TtsLanguage[] = referenceLanguages as TtsLanguage[]

export function defaultVoiceByLanguage(): Record<string, string> {
  return Object.fromEntries(REFERENCE_LANGUAGES.map(language => [language.code, language.voices[0]?.edge ?? '']))
}

export function defaultGroupByLanguage(): Record<string, string> {
  return Object.fromEntries(
    REFERENCE_LANGUAGES.map(language => [language.code, getVoiceGroups(language.code)[0] ?? '']),
  )
}

export function getVoiceGroups(languageCode: string): string[] {
  const language = REFERENCE_LANGUAGES.find(item => item.code === languageCode)
  if (!language) return []
  const groups = Array.from(new Set(language.voices.map(voice => voice.group).filter(Boolean)))
  return groups as string[]
}

export function getVoiceOptions(languageCode: string, group = ''): TtsVoice[] {
  const language = REFERENCE_LANGUAGES.find(item => item.code === languageCode)
  if (!language) return []
  const groups = getVoiceGroups(languageCode)
  if (groups.length === 0) {
    return language.voices
  }
  return language.voices.filter(voice => voice.group === group)
}

export function voiceForSelection(languageCode: string, voiceId: string, group = ''): TtsVoice | undefined {
  const language = REFERENCE_LANGUAGES.find(item => item.code === languageCode)
  if (!language) return undefined
  const options = getVoiceOptions(languageCode, group)
  if (options.length > 0) {
    return options.find(option => option.edge === voiceId) ?? options[0]
  }
  return language.voices.find(option => option.edge === voiceId) ?? language.voices[0]
}

const SPOKEN_TO_WRITTEN: Record<string, string> = Object.fromEntries(
  REFERENCE_LANGUAGES.flatMap(lang => (lang.aliases ?? []).map(alias => [alias, lang.code])),
)
export function toWrittenLang(code: string): string {
  return SPOKEN_TO_WRITTEN[code] ?? code
}

export const SPOKEN_GROUP: Record<string, string> = {
  yue: 'Cantonese',
}
