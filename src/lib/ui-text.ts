import { REFERENCE_LANGUAGES } from './tts-reference'
import type { Locale } from './i18n.svelte'

export const LANGUAGE_DISPLAY_NAMES: Record<Locale, Record<string, string>> = {
  en: { en: 'English', zh: 'Chinese', yue: 'Cantonese', ja: 'Japanese', ko: 'Korean', es: 'Spanish', fr: 'French', ru: 'Russian' },
  'zh-TW': { en: '英文', zh: '中文', yue: '粵語', ja: '日文', ko: '韓文', es: '西班牙文', fr: '法文', ru: '俄文' },
  'zh-CN': { en: '英文', zh: '中文', yue: '粤语', ja: '日文', ko: '韩文', es: '西班牙文', fr: '法文', ru: '俄文' },
}

export function segmentLanguageName(locale: Locale, lang: string): string {
  return LANGUAGE_DISPLAY_NAMES[locale]?.[lang] ?? REFERENCE_LANGUAGES.find(item => item.code === lang)?.name ?? lang
}
