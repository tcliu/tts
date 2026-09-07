import { REFERENCE_LANGUAGES } from './tts-reference'

export type UiLocale = 'en' | 'zh-TW' | 'zh-CN'

export interface UiText {
  auth: {
    login: string
    account: string
    accountOptions: string
    usernameOrEmail: string
    username: string
    email: string
    password: string
    rememberMe: string
    continue: string
    goToEditor: string
    fillBoth: string
    fillAll: string
    usernameTaken: string
    usernameReserved: string
    passwordTooShort: string
    signIn: { failed: string }
    createAccount: { title: string; failed: string }
    signOut: { label: string; failed: string }
  }
  app: {
    language: string
    settings: string
    settingsTitle: string
    appTitle: string
    appShortTitle: string
  }
  playback: {
    label: string
    controls: string
    speed: string
    seek: string
    ready: string
    switching: string
    stopped: string
    finished: string
    failed: string
    followSentence: string
  }
  editor: {
    label: string
    edit: string
    editText: string
    doubleClickToEdit: string
  }
  info: {
    label: string
    collapse: string
  }
  metadata: {
    search: string
    stale: string
    noResults: string
    expand: string
    restore: string
    noMetadata: string
    playSegment: string
    segmentHint: string
  }
  sentences: {
    expand: string
    collapse: string
    expandAll: string
    collapseAll: string
    playWord: string
    noWords: string
  }
  voices: {
    search: string
    noMatching: string
    model: string
    tab: string
    notConfigured: string
    segmentLanguage: string
    segmentLocale: string
    segmentGender: string
    spokenLanguage: string
  }
  languages: {
    search: string
    noMatching: string
    localeSearch: string
    noMatchingLocales: string
  }
  settings: {
    speedTab: string
    defaultSpeed: string
    concurrency: string
  }
  documents: {
    label: string
    search: string
    noSavedDocuments: string
    noMatchingDocuments: string
    syncFailed: string
    sessionExpired: string
    save: string
    newDocument: string
    moreActions: string
    copy: string
    clone: string
    reset: string
    delete: string
    namePlaceholder: string
  }
  dialogs: {
    overwriteTitle: string
    overwriteMessage: string
    deleteConfirmTitle: string
    deleteConfirmMessage: string
    discardTitle: string
    discardMessage: string
    discardConfirm: string
    stopPlaybackTitle: string
    stopPlaybackMessage: string
    stopPlaybackConfirm: string
  }
  upload: {
    label: string
    success: string
    tooLarge: string
    failed: string
    binary: string
  }
  cache: {
    tab: string
    label: string
    units: string
    none: string
    clear: string
    clearSelected: string
    clearAll: string
    clearAllEntries: string
    view: string
    viewTitle: string
    detailsTitle: string
    search: string
    noMatching: string
    selected: string
    selectAll: string
    select: string
    playSelected: string
    stopPlayback: string
    reset: string
  }
  table: {
    sentence: string
    number: string
    offset: string
    lang: string
    text: string
    voice: string
    size: string
    saved: string
    play: string
    word: string
    sortAsc: string
    sortDesc: string
    resize: string
  }
  pagination: {
    previous: string
    next: string
    pageSize: string
    page: string
  }
  theme: {
    label: string
    dark: string
    light: string
    ember: string
    nebula: string
    sky: string
    sepia: string
    forest: string
    midnight: string
    mint: string
    lavender: string
  }
  adminTitle: string
  adminSignOut: string
  adminBackToEditor: string
  adminSections: string
  adminPropertiesActions: string
  adminTabProperties: string
  adminTabSynthesisCache: string
  adminSourceFile: string
  adminSourceEnvironment: string
  adminSourceDefault: string
  adminEnv: string
  adminRevertToDefault: string
  adminApply: string
  adminReload: string
  adminReset: string
  adminRetry: string
  adminServerCache: string
  adminServerCacheEmpty: string
  adminClearAllServerCache: string
  adminPropRateLimitMaxLabel: string
  adminPropRateLimitMaxDesc: string
  adminPropMaxTextLengthLabel: string
  adminPropMaxTextLengthDesc: string
  adminPropCacheTtlLabel: string
  adminPropCacheTtlDesc: string
  adminPropCacheMaxEntriesLabel: string
  adminPropCacheMaxEntriesDesc: string
  adminPropCacheMaxBytesLabel: string
  adminPropCacheMaxBytesDesc: string
  adminPropEdgeTtsTimeoutLabel: string
  adminPropEdgeTtsTimeoutDesc: string
  adminPropPasswordMinLengthLabel: string
  adminPropPasswordMinLengthDesc: string
  adminErrorGeneric: string
  adminErrorBadRequest: string
  adminErrorRateLimited: string
  adminErrorInvalidProperty: string
  adminErrorTimeout: string
  adminPropNotInteger: string
  adminPropOutOfRange: string
  adminPasswordShow: string
  adminPasswordHide: string
  stop: string
  close: string
  increment: string
  decrement: string
  noOptions: string
}

export const UI_LANGUAGE_OPTIONS: { value: UiLocale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'zh-CN', label: '简体中文' },
]

export const LANGUAGE_DISPLAY_NAMES: Record<UiLocale, Record<string, string>> = {
  en: { en: 'English', zh: 'Chinese', yue: 'Cantonese', ja: 'Japanese', ko: 'Korean', es: 'Spanish', fr: 'French', ru: 'Russian' },
  'zh-TW': { en: '英文', zh: '中文', yue: '粵語', ja: '日文', ko: '韓文', es: '西班牙文', fr: '法文', ru: '俄文' },
  'zh-CN': { en: '英文', zh: '中文', yue: '粤语', ja: '日文', ko: '韩文', es: '西班牙文', fr: '法文', ru: '俄文' },
}

export function segmentLanguageName(locale: UiLocale, lang: string): string {
  return LANGUAGE_DISPLAY_NAMES[locale]?.[lang] ?? REFERENCE_LANGUAGES.find(item => item.code === lang)?.name ?? lang
}

export { UI_TEXT } from './locales'
