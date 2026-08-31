export type UiLocale = 'en' | 'zh-TW' | 'zh-CN'

import { REFERENCE_LANGUAGES } from './tts-reference'

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
  /** @deprecated — Info panel Time column removed (see metadata-panel-time-column-removal) */
  tableTime: string
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
  /** @deprecated — use synthesisTab */
  cacheTab: string
  synthesisTab: string
  /** @deprecated — use cache label inside Synthesis tab (value is now "Cache") */
  synthesisCache: string
  segmentsUnit: string
  cachedSegmentsNone: string
  /** @deprecated — use segmentsUnit */
  documentsUnit: string
  /** @deprecated — use cachedSegmentsNone */
  cachedDocumentsNone: string
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
  expandSentence: string
  collapseSentence: string
  playWord: string
  noWords: string
  tableExpand: string
  tablePlay: string
  tableWord: string
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

export const UI_TEXT: Record<UiLocale, UiText> = {
  en: {
    language: 'Language',
    settings: 'Settings',
    playback: 'Play',
    seek: 'Playback position',
    editorLabel: 'Editor',
    appTitle: 'Text-to-Speech',
    appShortTitle: 'TTS',
    playbackControls: 'Playback controls',
    stop: 'Stop',
    close: 'Close',
    info: 'Info',
    infoCollapse: 'Collapse info',
    synthesisConcurrency: 'Synthesis concurrency',
    synthesized: 'Synthesized',
    noMetadata: 'No playback metadata.',
    playSegment: 'Play sentence',
    segmentHint: 'Click a row to play from that sentence.',
    metadataSearch: 'Search',
    metadataStale: 'Sentence info cleared after edit.',
    metadataNoResults: 'No matching rows.',
    followSentence: 'Follow current sentence',
    metadataExpand: 'Expand panel',
    metadataRestore: 'Restore editor',
    increment: 'Increase',
    decrement: 'Decrease',
    playbackSpeed: 'Speed',
    settingsTitle: 'Settings',
    voicesTab: 'Voices',
    speedTab: 'Speed',
    voiceModel: 'Voice model',
    spokenLanguage: 'Spoken language',
    defaultSpeed: 'Default speed',
    ready: 'Ready to speak.',
    playbackStopped: 'Playback stopped.',
    playbackFinished: 'Playback finished.',
    voiceSwitching: 'Switching voice…',
    tableSentence: 'Sent',
    tableNumber: '#',
    tableTime: 'Time',
    tableOffset: 'Offset',
    tableLang: 'Lang',
    tableText: 'Text',
    tableVoice: 'Voice',
    tableRate: 'Rate',
    tableSize: 'Size',
    tableSaved: 'Saved',
    tableDocument: 'Document',
    documents: 'Documents',
    documentSearch: 'Search documents',
    noSavedDocuments: 'No saved documents.',
    noMatchingDocuments: 'No matching documents.',
    save: 'Save',
    saveDialogTitle: 'Save document',
    documentNameLabel: 'Document name',
    documentNamePlaceholder: 'Untitled',
    documentNameRequired: 'Enter a document name.',
    overwriteTitle: 'Replace document?',
    overwriteMessage: 'A document with this name already exists. Saving will replace it.',
    reset: 'Reset',
    newDocument: 'New document',
    moreActions: 'More actions',
    copy: 'Copy',
    clone: 'Clone',
    upload: 'Upload',
    uploadSuccess: 'File loaded.',
    uploadTooLarge: 'File is too large. The limit is 1 MiB of text.',
    uploadFailed: 'Could not read the file.',
    uploadBinary: 'File contains binary data.',
    edit: 'Edit',
    editText: 'Edit text',
    doubleClickToEdit: 'Double-click to edit',
    delete: 'Delete',
    clear: 'Clear',
    clearAll: 'Clear all',
    view: 'View',
    deleteConfirmTitle: 'Delete document?',
    deleteConfirmMessage: `This document will be permanently deleted.`,
    discardTitle: 'Discard unsaved changes?',
    discardMessage: 'You have unsaved changes that will be lost.',
    discardConfirm: 'Discard',
    stopPlaybackTitle: 'Stop playback?',
    stopPlaybackMessage: 'Playback is in progress. Stop playback to continue?',
    stopPlaybackConfirm: 'Stop',
    voiceNotConfigured: 'No voice is configured for this language.',
    playbackFailed: 'Playback failed.',
    theme: 'Theme',
    themeDark: 'Dark',
    themeLight: 'Light',
    themeEmber: 'Ember',
    themeNebula: 'Nebula',
    themeSky: 'Sky',
    themeSepia: 'Sepia',
    themeForest: 'Forest',
    themeMidnight: 'Midnight',
    themeMint: 'Mint',
    themeLavender: 'Lavender',
    cacheTab: 'Synthesis',
    synthesisTab: 'Synthesis',
    synthesisCache: 'Cache',
    segmentsUnit: 'segments',
    cachedSegmentsNone: 'No cached segments.',
    documentsUnit: 'segments',
    cachedDocumentsNone: 'No cached segments.',
    clearSynthesisCache: 'Clear cache',
    clearAllCacheEntries: 'Clear all cached segments',
    clearSelectedCacheEntries: 'Clear selected cached segments',
    viewSynthesisCache: 'View cached segments',
    synthesisCacheDetailsTitle: 'Synthesis cache',
    cacheSearch: 'Search cached segments',
    noMatchingCacheEntries: 'No matching cached segments.',
    loadingCacheEntries: 'Loading cached segments…',
    cacheEntriesSelected: 'selected',
    selectAllCacheEntries: 'Select all cached segments',
    selectCacheEntry: 'Select cached segment',
    playSelectedCacheEntries: 'Play selected cached segments',
    stopSelectedCachePlayback: 'Stop selected cached segment playback',
    resetPlaybackCache: 'Reset playback, segment info, and cached audio',
    voiceSearch: 'Search languages or voices',
    noMatchingVoices: 'No matching voices.',
    languageSearch: 'Search languages',
    noMatchingLanguages: 'No matching languages.',
    segmentLanguage: 'Segment language',
    expandSentence: 'Expand words',
    collapseSentence: 'Collapse words',
    playWord: 'Play word',
    noWords: 'No word timing.',
    tableExpand: '',
    tablePlay: '',
    tableWord: 'Word',
  },
  'zh-TW': {
    language: '語言',
    settings: '設定',
    playback: '播放',
    seek: '播放位置',
    editorLabel: '編輯器',
    appTitle: '文字轉語音',
    appShortTitle: 'TTS',
    playbackControls: '播放控制',
    stop: '停止',
    close: '關閉',
    info: '資訊',
    infoCollapse: '收合資訊',
    synthesisConcurrency: '並行合成數',
    synthesized: '已合成',
    noMetadata: '尚無播放中繼資料。',
    playSegment: '播放句子',
    segmentHint: '點擊列可從該句子開始播放。',
    metadataSearch: '搜尋',
    metadataStale: '編輯後已清除句子資訊。',
    metadataNoResults: '沒有符合的列。',
    followSentence: '追蹤目前句子',
    metadataExpand: '展開面板',
    metadataRestore: '還原編輯器',
    increment: '增加',
    decrement: '減少',
    playbackSpeed: '速度',
    settingsTitle: '設定',
    voicesTab: '語音',
    speedTab: '速度',
    voiceModel: '語音模型',
    spokenLanguage: '口語語言',
    defaultSpeed: '預設速度',
    ready: '可以開始播放。',
    playbackStopped: '已停止播放。',
    playbackFinished: '播放完成。',
    voiceSwitching: '正在切換語音…',
    tableSentence: '句',
    tableNumber: '#',
    tableTime: '時間',
    tableOffset: '位移',
    tableLang: '語言',
    tableText: '文字',
    tableVoice: '語音',
    tableRate: '速度',
    tableSize: '大小',
    tableSaved: '儲存時間',
    tableDocument: '文件',
    documents: '文件',
    documentSearch: '搜尋文件',
    noSavedDocuments: '尚無已儲存的文件。',
    noMatchingDocuments: '沒有符合的文件。',
    save: '儲存',
    saveDialogTitle: '儲存文件',
    documentNameLabel: '文件名稱',
    documentNamePlaceholder: '未命名',
    documentNameRequired: '請輸入文件名稱。',
    overwriteTitle: '取代文件？',
    overwriteMessage: '已有同名稱的文件，儲存將會取代它。',
    reset: '重設',
    newDocument: '新增文件',
    moreActions: '更多動作',
    copy: '複製',
    clone: '建立副本',
    upload: '上傳',
    uploadSuccess: '已載入檔案。',
    uploadTooLarge: '檔案太大，上限為 1 MiB 文字。',
    uploadFailed: '無法讀取檔案。',
    uploadBinary: '檔案包含二進位資料。',
    edit: '編輯',
    editText: '編輯文字',
    doubleClickToEdit: '按兩下以編輯',
    delete: '刪除',
    clear: '清除',
    clearAll: '全部清除',
    view: '檢視',
    deleteConfirmTitle: '刪除文件？',
    deleteConfirmMessage: '此文件將被永久刪除。',
    discardTitle: '放棄未儲存的變更？',
    discardMessage: '有未儲存的變更，放棄後將會遺失。',
    discardConfirm: '放棄',
    stopPlaybackTitle: '停止播放？',
    stopPlaybackMessage: '正在播放中，是否停止播放並繼續？',
    stopPlaybackConfirm: '停止',
    voiceNotConfigured: '此語言尚未設定語音。',
    playbackFailed: '播放失敗。',
    theme: '主題',
    themeDark: '深色',
    themeLight: '淺色',
    themeEmber: '暮色',
    themeNebula: '星雲',
    themeSky: '天藍',
    themeSepia: '暖色',
    themeForest: '森林',
    themeMidnight: '午夜',
    themeMint: '薄荷',
    themeLavender: '薰衣草',
    cacheTab: '語音合成',
    synthesisTab: '語音合成',
    synthesisCache: '快取',
    segmentsUnit: '個片段',
    cachedSegmentsNone: '沒有已快取的片段。',
    documentsUnit: '個片段',
    cachedDocumentsNone: '沒有已快取的片段。',
    clearSynthesisCache: '清除快取',
    clearAllCacheEntries: '清除全部已快取片段',
    clearSelectedCacheEntries: '清除所選已快取片段',
    viewSynthesisCache: '檢視已快取片段',
    synthesisCacheDetailsTitle: '語音合成快取',
    cacheSearch: '搜尋已快取片段',
    noMatchingCacheEntries: '沒有符合的已快取片段。',
    loadingCacheEntries: '正在載入已快取片段…',
    cacheEntriesSelected: '已選取',
    selectAllCacheEntries: '選取全部已快取片段',
    selectCacheEntry: '選取已快取片段',
    playSelectedCacheEntries: '播放所選已快取片段',
    stopSelectedCachePlayback: '停止播放所選已快取片段',
    resetPlaybackCache: '重設播放、段落資訊與已快取音訊',
    voiceSearch: '搜尋語言或語音',
    noMatchingVoices: '沒有符合的語音。',
    languageSearch: '搜尋語言',
    noMatchingLanguages: '沒有符合的語言。',
    segmentLanguage: '段落語言',
    expandSentence: '展開詞彙',
    collapseSentence: '收合詞彙',
    playWord: '播放詞彙',
    noWords: '沒有詞彙時間資訊。',
    tableExpand: '',
    tablePlay: '',
    tableWord: '詞',
  },
  'zh-CN': {
    language: '语言',
    settings: '设置',
    playback: '播放',
    seek: '播放位置',
    editorLabel: '编辑器',
    appTitle: '文字转语音',
    appShortTitle: 'TTS',
    playbackControls: '播放控制',
    stop: '停止',
    close: '关闭',
    info: '信息',
    infoCollapse: '收起信息',
    synthesisConcurrency: '并行合成数',
    synthesized: '已合成',
    noMetadata: '尚无播放元数据。',
    playSegment: '播放句子',
    segmentHint: '点击行可从该句子开始播放。',
    metadataSearch: '搜索',
    metadataStale: '编辑后已清除句子信息。',
    metadataNoResults: '没有匹配的行。',
    followSentence: '跟随当前句子',
    metadataExpand: '展开面板',
    metadataRestore: '还原编辑器',
    increment: '增加',
    decrement: '减少',
    playbackSpeed: '速度',
    settingsTitle: '设置',
    voicesTab: '语音',
    speedTab: '速度',
    voiceModel: '语音模型',
    spokenLanguage: '口语语言',
    defaultSpeed: '默认速度',
    ready: '可以开始播放。',
    playbackStopped: '已停止播放。',
    playbackFinished: '播放完成。',
    voiceSwitching: '正在切换语音…',
    tableSentence: '句',
    tableNumber: '#',
    tableTime: '时间',
    tableOffset: '偏移',
    tableLang: '语言',
    tableText: '文本',
    tableVoice: '语音',
    tableRate: '速度',
    tableSize: '大小',
    tableSaved: '保存时间',
    tableDocument: '文档',
    documents: '文档',
    documentSearch: '搜索文档',
    noSavedDocuments: '尚无已保存的文档。',
    noMatchingDocuments: '没有匹配的文档。',
    save: '保存',
    saveDialogTitle: '保存文档',
    documentNameLabel: '文档名称',
    documentNamePlaceholder: '未命名',
    documentNameRequired: '请输入文档名称。',
    overwriteTitle: '替换文档？',
    overwriteMessage: '已存在同名文档，保存将替换它。',
    reset: '重置',
    newDocument: '新建文档',
    moreActions: '更多操作',
    copy: '复制',
    clone: '创建副本',
    upload: '上传',
    uploadSuccess: '已加载文件。',
    uploadTooLarge: '文件过大，上限为 1 MiB 文本。',
    uploadFailed: '无法读取文件。',
    uploadBinary: '文件包含二进制数据。',
    edit: '编辑',
    editText: '编辑文字',
    doubleClickToEdit: '双击以编辑',
    delete: '删除',
    clear: '清除',
    clearAll: '全部清除',
    view: '查看',
    deleteConfirmTitle: '删除文档？',
    deleteConfirmMessage: '此文档将被永久删除。',
    discardTitle: '放弃未保存的更改？',
    discardMessage: '有未保存的更改，放弃后将丢失。',
    discardConfirm: '放弃',
    stopPlaybackTitle: '停止播放？',
    stopPlaybackMessage: '正在播放中，是否停止播放并继续？',
    stopPlaybackConfirm: '停止',
    voiceNotConfigured: '此语言尚未设置语音。',
    playbackFailed: '播放失败。',
    theme: '主题',
    themeDark: '深色',
    themeLight: '浅色',
    themeEmber: '暮色',
    themeNebula: '星云',
    themeSky: '天蓝',
    themeSepia: '暖色',
    themeForest: '森林',
    themeMidnight: '午夜',
    themeMint: '薄荷',
    themeLavender: '薰衣草',
    cacheTab: '语音合成',
    synthesisTab: '语音合成',
    synthesisCache: '缓存',
    segmentsUnit: '个片段',
    cachedSegmentsNone: '暂无已缓存的片段。',
    documentsUnit: '个片段',
    cachedDocumentsNone: '暂无已缓存的片段。',
    clearSynthesisCache: '清除缓存',
    clearAllCacheEntries: '清除全部已缓存片段',
    clearSelectedCacheEntries: '清除所选已缓存片段',
    viewSynthesisCache: '查看已缓存片段',
    synthesisCacheDetailsTitle: '语音合成缓存',
    cacheSearch: '搜索已缓存片段',
    noMatchingCacheEntries: '没有匹配的已缓存片段。',
    loadingCacheEntries: '正在加载已缓存片段…',
    cacheEntriesSelected: '已选',
    selectAllCacheEntries: '选择全部已缓存片段',
    selectCacheEntry: '选择已缓存片段',
    playSelectedCacheEntries: '播放所选已缓存片段',
    stopSelectedCachePlayback: '停止播放所选已缓存片段',
    resetPlaybackCache: '重置播放、段落信息与已缓存音频',
    voiceSearch: '搜索语言或语音',
    noMatchingVoices: '没有匹配的语音。',
    languageSearch: '搜索语言',
    noMatchingLanguages: '没有匹配的语言。',
    segmentLanguage: '段落语言',
    expandSentence: '展开词汇',
    collapseSentence: '收起词汇',
    playWord: '播放词汇',
    noWords: '没有词汇时间信息。',
    tableExpand: '',
    tablePlay: '',
    tableWord: '词汇',
  },
}
