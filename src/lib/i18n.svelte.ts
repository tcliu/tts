import { browser } from '$app/environment'
import { getContext, hasContext, setContext } from 'svelte'
import { en } from './locales/en'
import { zhCN } from './locales/zh-CN'
import { zhTW } from './locales/zh-TW'

export type Locale = 'en' | 'zh-TW' | 'zh-CN'

export type MessageKey = keyof typeof en

const DEFAULT_LOCALE: Locale = 'en'

const dictionaries: Record<Locale, Record<MessageKey, string>> = {
  en,
  'zh-TW': zhTW,
  'zh-CN': zhCN,
}

export interface I18nStore<TKey extends string = string, TLocale extends string = string> {
  readonly locale: TLocale
  setLocale(next: TLocale): void
  t(key: TKey, params?: Record<string, string | number>): string
}

export const I18N_CONTEXT_KEY = 'i18n'

export function createI18nStore<TKey extends string, TLocale extends string>(
  dictionaries: Record<TLocale, Record<TKey, string>>,
  defaultLocale: TLocale,
  storageKey: string | null,
): I18nStore<TKey, TLocale> {
  let current = $state<TLocale>(defaultLocale)

  if (browser) {
    try {
      const saved = storageKey ? localStorage.getItem(storageKey) : null
      if (saved !== null && Object.prototype.hasOwnProperty.call(dictionaries, saved)) {
        current = saved as TLocale
      }
    } catch {
      // ignore storage errors
    }
    // svelte-ignore state_referenced_locally -- intentional one-time read of the initial locale
    document.documentElement.lang = current
  }

  return {
    get locale() {
      return current
    },
    setLocale(next: TLocale) {
      current = next
      if (!browser) return
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, next)
        } catch {
          // ignore storage errors
        }
      }
      document.documentElement.lang = next
    },
    t(key: TKey, params?: Record<string, string | number>): string {
      const dictionary = dictionaries[current]
      let message: string = dictionary[key] ?? dictionaries[defaultLocale][key] ?? key
      if (params) {
        for (const [name, value] of Object.entries(params)) {
          message = message.replaceAll(`{${name}}`, String(value))
        }
      }
      return message
    },
  }
}

export type TtsI18n = I18nStore<MessageKey, Locale>

export function createTtsI18n(): TtsI18n {
  return createI18nStore(dictionaries, DEFAULT_LOCALE, null)
}

export function setI18nContext(store: TtsI18n): TtsI18n {
  setContext(I18N_CONTEXT_KEY, store)
  return store
}

let defaultStore: TtsI18n | null = null

export function getI18nContext(): TtsI18n {
  if (hasContext(I18N_CONTEXT_KEY)) {
    return getContext<TtsI18n>(I18N_CONTEXT_KEY)
  }
  // per-test provider; app code always runs under the layout store. Warn in
  // dev so a provider-less component in app code fails loudly instead of
  // silently rendering English.
  if (import.meta.env.DEV) {
    console.warn('getI18nContext: no i18n provider above; using the default English store')
  }
  if (!defaultStore) {
    defaultStore = createTtsI18n()
  }
  return defaultStore
}
