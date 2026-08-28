import { SPEEDS, defaultGroupByLanguage, defaultVoiceByLanguage, voiceForSelection } from './tts-reference'
import { UI_TEXT, type UiLocale } from './ui-text'

const STORAGE_KEY = 'tts:web-settings'
const SAVE_DEBOUNCE_MS = 300
const MIN_CONCURRENCY = 1
const MAX_CONCURRENCY = 8

export type UiTheme = 'dark' | 'light' | 'ember' | 'sepia' | 'nebula' | 'sky' | 'forest' | 'midnight' | 'mint' | 'lavender'

export interface SettingsHandle {
  readonly locale: UiLocale
  setLocale: (locale: UiLocale) => void
  content: string
  readonly speed: number
  setSpeed: (speed: number) => void
  readonly synthesisConcurrency: number
  setSynthesisConcurrency: (value: number) => void
  readonly theme: UiTheme
  setTheme: (theme: UiTheme) => void
  readonly voiceSelections: Record<string, string>
  readonly groupSelections: Record<string, string>
  readonly canPlay: boolean
  resolveVoiceForSegment: (segmentLang: string) => ReturnType<typeof voiceForSelection>
  selectGroup: (languageCode: string, group: string) => void
  selectVoice: (languageCode: string, voiceId: string) => void
  hydrate: () => () => void
}

export function useSettings(): SettingsHandle {
  let storageReady = $state(false)
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let pendingSave: Record<string, unknown> | null = null

  let locale = $state<UiLocale>('en')
  let content = $state('')
  let speed = $state<number>(1)
  let synthesisConcurrency = $state<number>(4)
  let voiceSelections = $state<Record<string, string>>(defaultVoiceByLanguage())
  let groupSelections = $state<Record<string, string>>(defaultGroupByLanguage())
  let theme = $state<UiTheme>('dark')

  const canPlay = $derived(content.trim().length > 0)

  function flushSettingsSave() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (!storageReady || typeof localStorage === 'undefined' || !pendingSave) {
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pendingSave))
    pendingSave = null
  }

  $effect(() => {
    if (!storageReady || typeof localStorage === 'undefined') {
      return
    }
    pendingSave = {
      locale,
      content,
      speed,
      synthesisConcurrency,
      voiceSelections,
      groupSelections,
      theme,
    }
    if (saveTimer) {
      clearTimeout(saveTimer)
    }
    saveTimer = setTimeout(flushSettingsSave, SAVE_DEBOUNCE_MS)
  })

  $effect(() => {
    if (typeof document === 'undefined') {
      return
    }
    document.documentElement.lang = locale
  })

  $effect(() => {
    if (typeof document === 'undefined') {
      return
    }
    // Dark is the default palette and needs no attribute; every other theme
    // opts in via data-theme, matching the pre-paint script in app.html.
    if (theme === 'dark') {
      delete document.documentElement.dataset.theme
    } else {
      document.documentElement.dataset.theme = theme
    }
  })

  let hydrateRan = false

  function hydrate(): () => void {
    if (hydrateRan) return () => {}
    hydrateRan = true
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as {
            locale?: UiLocale
            content?: string
            speed?: number
            voiceSelections?: Record<string, string>
            groupSelections?: Record<string, string>
            synthesisConcurrency?: number
            theme?: UiTheme
          }
          if (parsed.locale === 'en' || parsed.locale === 'zh-TW' || parsed.locale === 'zh-CN') {
            locale = parsed.locale
          }
          content = parsed.content ?? content
          speed = SPEEDS.includes((parsed.speed ?? 1) as (typeof SPEEDS)[number]) ? (parsed.speed ?? 1) : 1
          voiceSelections = { ...voiceSelections, ...(parsed.voiceSelections ?? {}) }
          groupSelections = { ...groupSelections, ...(parsed.groupSelections ?? {}) }
          if (
            parsed.theme === 'light' ||
            parsed.theme === 'ember' ||
            parsed.theme === 'sepia' ||
            parsed.theme === 'nebula' ||
            parsed.theme === 'sky' ||
            parsed.theme === 'forest' ||
            parsed.theme === 'midnight' ||
            parsed.theme === 'mint' ||
            parsed.theme === 'lavender'
          ) {
            theme = parsed.theme
          }
          synthesisConcurrency =
            typeof parsed.synthesisConcurrency === 'number' &&
            parsed.synthesisConcurrency >= MIN_CONCURRENCY &&
            parsed.synthesisConcurrency <= MAX_CONCURRENCY
              ? parsed.synthesisConcurrency
              : 4
        } catch {
          // Ignore invalid local storage data.
        }
      }
    }
    storageReady = true
    window.addEventListener('pagehide', flushSettingsSave)
    return () => window.removeEventListener('pagehide', flushSettingsSave)
  }

  function resolveVoiceForSegment(segmentLang: string) {
    const languageCode = segmentLang === 'yue' ? 'zh' : segmentLang
    const group = segmentLang === 'yue' ? 'Cantonese' : groupSelections[languageCode] ?? ''
    return voiceForSelection(languageCode, voiceSelections[languageCode], group)
  }

  function selectGroup(languageCode: string, group: string) {
    groupSelections = { ...groupSelections, [languageCode]: group }
    const nextVoice = voiceForSelection(languageCode, voiceSelections[languageCode], group)
    if (nextVoice) {
      voiceSelections = { ...voiceSelections, [languageCode]: nextVoice.edge }
    }
  }

  function selectVoice(languageCode: string, voiceId: string) {
    voiceSelections = { ...voiceSelections, [languageCode]: voiceId }
  }

  return {
    get locale() {
      return locale
    },
    setLocale(next) {
      locale = next
    },
    get content() {
      return content
    },
    set content(value) {
      content = value
    },
    get speed() {
      return speed
    },
    setSpeed(next) {
      speed = next
    },
    get synthesisConcurrency() {
      return synthesisConcurrency
    },
    setSynthesisConcurrency(next) {
      synthesisConcurrency = next
    },
    get theme() {
      return theme
    },
    setTheme(next) {
      theme = next
    },
    get voiceSelections() {
      return voiceSelections
    },
    get groupSelections() {
      return groupSelections
    },
    get canPlay() {
      return canPlay
    },
    resolveVoiceForSegment,
    selectGroup,
    selectVoice,
    hydrate,
  }
}
