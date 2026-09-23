import { browser } from '$app/environment'
import { getContext, hasContext, setContext } from 'svelte'
import { en } from './locales/en'
import { zhCN } from './locales/zh-CN'
import { zhTW } from './locales/zh-TW'

export type Locale = 'en' | 'zh-TW' | 'zh-CN'

// Switcher entries; every locale is labelled in its own language.
export const LOCALES: { code: Locale; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'zh-CN', label: '简体中文' },
]

// Dotted-path key union over the nested source dictionary
// ('editor.toast.copied', 'auth.signOut.label', ...). Call sites keep using the
// same strings; only the dictionary shape changed.
export type MessageKey = DottedKey<typeof en>

type DottedKey<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${DottedKey<T[K]>}`
}[keyof T & string]

// Nested message tree matching the source shape, with plain strings at the
// leaves so a missing translation in any locale is a compile-time error.
type LocaleMessages<T> = {
  [K in keyof T]: T[K] extends string ? string : LocaleMessages<T[K]>
}

const DEFAULT_LOCALE: Locale = 'en'
const STORAGE_KEY: string | null = null

// One translation file per locale. `en` defines the key set and every other
// locale is typed `LocaleMessages<typeof en>`, so a missing key fails the build.
const DICTIONARIES: Record<Locale, LocaleMessages<typeof en>> = {
  en,
  'zh-TW': zhTW,
  'zh-CN': zhCN,
}

// A Symbol context key can never collide with another module's context.
const CONTEXT_KEY = Symbol('i18n')

export interface I18nStore<TKey extends string = MessageKey, TLocale extends string = Locale> {
  readonly locale: TLocale
  setLocale(next: TLocale): void
  t(key: TKey, params?: Record<string, string | number>): string
}

// Dot-path lookup over a nested message tree ('editor.toast.copied'). Returns
// undefined for a missing path or a non-string landing (an intermediate
// subtree), so callers fall back to the default locale, then the key itself.
function lookupMessage(dictionary: unknown, key: string): string | undefined {
  let node: unknown = dictionary
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

// The saved locale, when the browser has one and the storage key is set. Guarded
// with try/catch so private mode or a quota error never breaks the app.
function readStoredLocale<TLocale extends string>(
  dictionaries: Record<TLocale, unknown>,
  defaultLocale: TLocale,
  storageKey: string | null,
): TLocale {
  if (!browser || !storageKey) return defaultLocale
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved !== null && Object.prototype.hasOwnProperty.call(dictionaries, saved)) {
      return saved as TLocale
    }
  } catch {
    // ignore storage errors
  }
  return defaultLocale
}

// One store per app instance, created by the root layout. The locale lives in a
// rune so `t()` re-renders its readers; module scope would share one locale
// across concurrent SSR requests.
export function createI18nStore<TKey extends string = MessageKey, TLocale extends string = Locale>(
  dictionaries: Record<TLocale, Record<string, unknown>>,
  defaultLocale: TLocale,
  storageKey: string | null,
): I18nStore<TKey, TLocale> {
  const initialLocale = readStoredLocale(dictionaries, defaultLocale, storageKey)
  let current = $state<TLocale>(initialLocale)

  if (browser) {
    document.documentElement.lang = initialLocale
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
          // storage unavailable: the in-memory locale still applies this session
        }
      }
      document.documentElement.lang = next
    },
    t(key: TKey, params?: Record<string, string | number>): string {
      const dictionary = dictionaries[current]
      let message: string = lookupMessage(dictionary, key) ?? lookupMessage(dictionaries[defaultLocale], key) ?? key
      if (params) {
        for (const [name, value] of Object.entries(params)) {
          message = message.replaceAll(`{${name}}`, String(value))
        }
      }
      return message
    },
  }
}

// The app-shaped factory, so the layout does not repeat the dictionary map.
export function createAppI18n(): I18nStore {
  return createI18nStore(DICTIONARIES, DEFAULT_LOCALE, STORAGE_KEY)
}

export function setI18nContext(store: I18nStore): I18nStore {
  setContext(CONTEXT_KEY, store)
  return store
}

let defaultStore: I18nStore | null = null

export function getI18nContext(): I18nStore {
  if (hasContext(CONTEXT_KEY)) {
    return getContext<I18nStore>(CONTEXT_KEY)
  }
  // Islands mounted outside the layout tree have no provider; fall back to a
  // default English store so primitives still render. App code under the layout
  // always hits the provider above: warn in dev so a provider-less component
  // fails loudly instead of silently staying English.
  if (import.meta.env.DEV) {
    console.warn('getI18nContext: no i18n provider above; using the default English store')
  }
  if (!defaultStore) {
    defaultStore = createAppI18n()
  }
  return defaultStore
}
