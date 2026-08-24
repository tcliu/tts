export type UiLocale = 'en' | 'zh-TW' | 'zh-CN'

export interface UiText {
  language: string
  settings: string
  playback: string
  stop: string
  playbackRunning: string
  info: string
  synthesisConcurrency: string
  synthesized: string
  noMetadata: string
  playSegment: string
  segmentHint: string
  metadataSearch: string
  metadataRefreshing: string
  metadataStale: string
  metadataNoResults: string
  followSentence: string
  increment: string
  decrement: string
  playbackSpeed: string
  settingsTitle: string
  voicesTab: string
  speedTab: string
  voiceModel: string
  spokenLanguage: string
  defaultSpeed: string
  languageMenuLabel: string
  ready: string
  playbackStopped: string
  playbackFinished: string
  browserSpeechUnavailable: string
  tableSeg: string
  tableTime: string
  tableOffset: string
  tableLang: string
  tableText: string
}

export const UI_LANGUAGE_OPTIONS: { value: UiLocale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'zh-CN', label: '简体中文' },
]

export const UI_TEXT: Record<UiLocale, UiText> = {
  en: {
    language: 'Language',
    settings: 'Settings',
    playback: 'Play',
    stop: 'Stop',
    playbackRunning: 'Speaking',
    info: 'Info',
    synthesisConcurrency: 'Synthesis concurrency',
    synthesized: 'Synthesized',
    noMetadata: 'No playback metadata.',
    playSegment: 'Play segment',
    segmentHint: 'Click a row to play from that segment.',
    metadataSearch: 'Search',
    metadataRefreshing: 'Updating segment info…',
    metadataStale: 'Segment info cleared after edit.',
    metadataNoResults: 'No matching rows.',
    followSentence: 'Follow current sentence',
    increment: 'Increase',
    decrement: 'Decrease',
    playbackSpeed: 'Speed',
    settingsTitle: 'Settings',
    voicesTab: 'Voices',
    speedTab: 'Speed',
    voiceModel: 'Voice model',
    spokenLanguage: 'Spoken language',
    defaultSpeed: 'Default speed',
    languageMenuLabel: 'Interface language',
    ready: 'Ready to speak.',
    playbackStopped: 'Playback stopped.',
    playbackFinished: 'Playback finished.',
    browserSpeechUnavailable: 'This browser does not support speech playback.',
    tableSeg: 'Seg',
    tableTime: 'Time',
    tableOffset: 'Offset',
    tableLang: 'Lang',
    tableText: 'Text',
  },
  'zh-TW': {
    language: '語言',
    settings: '設定',
    playback: '播放',
    stop: '停止',
    playbackRunning: '播放中',
    info: '資訊',
    synthesisConcurrency: '並行合成數',
    synthesized: '已合成',
    noMetadata: '尚無播放中繼資料。',
    playSegment: '播放段落',
    segmentHint: '點擊列可從該段落開始播放。',
    metadataSearch: '搜尋',
    metadataRefreshing: '更新段落資訊中…',
    metadataStale: '編輯後已清除段落資訊。',
    metadataNoResults: '沒有符合的列。',
    followSentence: '追蹤目前句子',
    increment: '增加',
    decrement: '減少',
    playbackSpeed: '速度',
    settingsTitle: '設定',
    voicesTab: '語音',
    speedTab: '速度',
    voiceModel: '語音模型',
    spokenLanguage: '口語語言',
    defaultSpeed: '預設速度',
    languageMenuLabel: '介面語言',
    ready: '可以開始播放。',
    playbackStopped: '已停止播放。',
    playbackFinished: '播放完成。',
    browserSpeechUnavailable: '這個瀏覽器不支援語音播放。',
    tableSeg: '段',
    tableTime: '時間',
    tableOffset: '位移',
    tableLang: '語言',
    tableText: '文字',
  },
  'zh-CN': {
    language: '语言',
    settings: '设置',
    playback: '播放',
    stop: '停止',
    playbackRunning: '播放中',
    info: '信息',
    synthesisConcurrency: '并行合成数',
    synthesized: '已合成',
    noMetadata: '尚无播放元数据。',
    playSegment: '播放段落',
    segmentHint: '点击行可从该段落开始播放。',
    metadataSearch: '搜索',
    metadataRefreshing: '正在更新段落信息…',
    metadataStale: '编辑后已清除段落信息。',
    metadataNoResults: '没有匹配的行。',
    followSentence: '跟随当前句子',
    increment: '增加',
    decrement: '减少',
    playbackSpeed: '速度',
    settingsTitle: '设置',
    voicesTab: '语音',
    speedTab: '速度',
    voiceModel: '语音模型',
    spokenLanguage: '口语语言',
    defaultSpeed: '默认速度',
    languageMenuLabel: '界面语言',
    ready: '可以开始播放。',
    playbackStopped: '已停止播放。',
    playbackFinished: '播放完成。',
    browserSpeechUnavailable: '这个浏览器不支持语音播放。',
    tableSeg: '段',
    tableTime: '时间',
    tableOffset: '位移',
    tableLang: '语言',
    tableText: '文字',
  },
}
