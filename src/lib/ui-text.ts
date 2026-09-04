import { REFERENCE_LANGUAGES } from './tts-reference'

export type UiLocale = 'en' | 'zh-TW' | 'zh-CN'

export interface UiText {
  language: string
  settings: string
  playback: string
  seek: string
  editorLabel: string
  appTitle: string
  appShortTitle: string
  playbackControls: string
  stop: string
  close: string
  info: string
  infoCollapse: string
  synthesisConcurrency: string
  synthesized: string
  noMetadata: string
  playSegment: string
  segmentHint: string
  metadataSearch: string
  metadataStale: string
  metadataNoResults: string
  followSentence: string
  metadataExpand: string
  metadataRestore: string
  increment: string
  decrement: string
  playbackSpeed: string
  settingsTitle: string
  voicesTab: string
  speedTab: string
  voiceModel: string
  spokenLanguage: string
  defaultSpeed: string
  ready: string
  playbackStopped: string
  playbackFinished: string
  voiceSwitching: string
  tableSentence: string
  tableNumber: string
  tableOffset: string
  tableLang: string
  tableText: string
  tableVoice: string
  tableRate: string
  tableSize: string
  tableSaved: string
  tableDocument: string
  documents: string
  documentSearch: string
  noSavedDocuments: string
  noMatchingDocuments: string
  save: string
  saveDialogTitle: string
  documentNameLabel: string
  documentNamePlaceholder: string
  documentNameRequired: string
  overwriteTitle: string
  overwriteMessage: string
  reset: string
  newDocument: string
  moreActions: string
  copy: string
  clone: string
  upload: string
  uploadSuccess: string
  uploadTooLarge: string
  uploadBinary: string
  uploadFailed: string
  edit: string
  editText: string
  doubleClickToEdit: string
  delete: string
  clear: string
  clearAll: string
  view: string
  deleteConfirmTitle: string
  deleteConfirmMessage: string
  discardTitle: string
  discardMessage: string
  discardConfirm: string
  stopPlaybackTitle: string
  stopPlaybackMessage: string
  stopPlaybackConfirm: string
  voiceNotConfigured: string
  playbackFailed: string
  theme: string
  themeDark: string
  themeLight: string
  themeEmber: string
  themeNebula: string
  themeSky: string
  themeSepia: string
  themeForest: string
  themeMidnight: string
  themeMint: string
  themeLavender: string
  synthesisTab: string
  synthesisCache: string
  segmentsUnit: string
  cachedSegmentsNone: string
  clearSynthesisCache: string
  clearAllCacheEntries: string
  clearSelectedCacheEntries: string
  viewSynthesisCache: string
  synthesisCacheDetailsTitle: string
  cacheSearch: string
  noMatchingCacheEntries: string
  loadingCacheEntries: string
  cacheEntriesSelected: string
  selectAllCacheEntries: string
  selectCacheEntry: string
  playSelectedCacheEntries: string
  stopSelectedCachePlayback: string
  resetPlaybackCache: string
  voiceSearch: string
  noMatchingVoices: string
  languageSearch: string
  noMatchingLanguages: string
  segmentLanguage: string
  segmentLocale: string
  segmentGender: string
  localeSearch: string
  noMatchingLocales: string
  expandSentence: string
  collapseSentence: string
  expandAll: string
  collapseAll: string
  playWord: string
  noWords: string
  tableExpand: string
  tablePlay: string
  tableWord: string
  paginationPrevious: string
  paginationNext: string
  paginationPageSize: string
  paginationRows: string
  paginationTotal: string
  paginationPage: string
  tableSortAsc: string
  tableSortDesc: string
  tableResize: string
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
