import { describe, expect, it } from 'vitest'
import { activeHighlightRange, parseEdgeMetadata, splitHighlightRanges, splitTtsSegments, toWrittenLang } from './tts-reference'

describe('toWrittenLang', () => {
  it('collapses spoken aliases onto their written language', () => {
    expect(toWrittenLang('yue')).toBe('zh')
  })

  it('passes written language codes through unchanged', () => {
    expect(toWrittenLang('en')).toBe('en')
    expect(toWrittenLang('ja')).toBe('ja')
    expect(toWrittenLang('cmn')).toBe('cmn')
    expect(toWrittenLang('')).toBe('')
  })
})

describe('splitTtsSegments', () => {
  it('splits mixed english and chinese text into separate language segments', () => {
    expect(splitTtsSegments('Hello你好世界')).toEqual([
      { text: 'Hello', lang: 'en', indexStart: 0, indexEnd: 4 },
      { text: '你好世界', lang: 'zh', indexStart: 5, indexEnd: 8 },
    ])
  })

  it('keeps japanese text in one segment', () => {
    expect(splitTtsSegments('こんにちは世界')).toEqual([
      { text: 'こんにちは世界', lang: 'ja', indexStart: 0, indexEnd: 6 },
    ])
  })

  it('splits paragraphs on blank lines and trims segment boundaries', () => {
    expect(splitTtsSegments('Hello world\n\n你好')).toEqual([
      { text: 'Hello world', lang: 'en', indexStart: 0, indexEnd: 10 },
      { text: '你好', lang: 'zh', indexStart: 13, indexEnd: 14 },
    ])
  })

  it('keeps single newlines inside a chinese segment as sentence-separating spaces', () => {
    expect(splitTtsSegments('這擁抱極美好\n愛有千斤重')).toEqual([
      { text: '這擁抱極美好 愛有千斤重', lang: 'zh', indexStart: 0, indexEnd: 11 },
    ])
  })
})

describe('splitHighlightRanges', () => {
  it('keeps a single-language sentence as one range', () => {
    expect(splitHighlightRanges('Hello world')).toEqual([{ start: 0, end: 11, lang: 'en' }])
  })

  it('splits a multi-language sentence into one part per language', () => {
    expect(splitHighlightRanges('Hello你好world')).toEqual([
      { start: 0, end: 5, lang: 'en' },
      { start: 5, end: 7, lang: 'zh' },
      { start: 7, end: 12, lang: 'en' },
    ])
  })

  it('produces one range per sentence for same-language text', () => {
    expect(splitHighlightRanges('First. Second.')).toEqual([
      { start: 0, end: 7, lang: 'en' },
      { start: 7, end: 14, lang: 'en' },
    ])
  })

  it('splits long-dash-separated clauses into separate ranges', () => {
    expect(splitHighlightRanges('政府宣佈即將重建彩虹邨──這條超過60年的名牌屋邨')).toEqual([
      { start: 0, end: 13, lang: 'zh' },
      { start: 13, end: 25, lang: 'zh' },
    ])
  })

  it('splits space-separated chinese sentences into one range per line', () => {
    expect(splitHighlightRanges('塔尖仍舊記得 這擁抱極美好')).toEqual([
      { start: 0, end: 7, lang: 'zh' },
      { start: 7, end: 13, lang: 'zh' },
    ])
  })

  it('splits comma-separated chinese clauses into separate ranges', () => {
    expect(splitHighlightRanges('你好，世界')).toEqual([
      { start: 0, end: 3, lang: 'zh' },
      { start: 3, end: 5, lang: 'zh' },
    ])
  })

  it('keeps an english comma clause as one range', () => {
    expect(splitHighlightRanges('Hello, world')).toEqual([{ start: 0, end: 12, lang: 'en' }])
  })

  it('merges a leading bracket-only range into the following range', () => {
    expect(splitHighlightRanges('【Now')).toEqual([{ start: 0, end: 4, lang: 'en' }])
  })

  it('merges a trailing bracket-only range into the preceding range', () => {
    expect(splitHighlightRanges('分流做好。 」')).toEqual([{ start: 0, end: 7, lang: 'zh' }])
  })
})

describe('detectTtsLanguage via segments', () => {
  it('splits a chinese name followed by an english name into zh and en segments', () => {
    expect(splitTtsSegments('跨境私家車車主Ronny：')).toEqual([
      { text: '跨境私家車車主', lang: 'zh', indexStart: 0, indexEnd: 6 },
      { text: 'Ronny：', lang: 'en', indexStart: 7, indexEnd: 12 },
    ])
  })

  it('keeps short accented foreign words out of the ascii-name shortcut', () => {
    // The shortcut must only fire when the non-ASCII chars are CJK punctuation;
    // "café" keeps reaching the foreign scorer (franc → vi), not 'en'.
    expect(splitTtsSegments('café')).toEqual([{ text: 'café', lang: 'vi', indexStart: 0, indexEnd: 3 }])
  })
})

describe('parseEdgeMetadata', () => {
  it('parses word and sentence boundaries from audio.metadata', () => {
    const message =
      'Path:audio.metadata\r\nContent-Type:application/json\r\n\r\n' +
      '{"Metadata":[' +
      '{"Type":"WordBoundary","Data":{"Offset":1000000,"Duration":3750000,"text":{"Text":"Hello","Length":5}}},' +
      '{"Type":"SentenceBoundary","Data":{"Offset":18000000,"Duration":15875000,"text":{"Text":"second.","Length":7}}}' +
      ']}'
    expect(parseEdgeMetadata(message)).toEqual([
      { type: 'WordBoundary', offset: 1000000, duration: 3750000, text: 'Hello' },
      { type: 'SentenceBoundary', offset: 18000000, duration: 15875000, text: 'second.' },
    ])
  })

  it('returns an empty array for non-metadata messages', () => {
    expect(parseEdgeMetadata('Path:turn.end\r\n\r\n{}')).toEqual([])
  })
})

describe('activeHighlightRange', () => {
  const ranges = [
    { start: 0, end: 6, lang: 'en' },
    { start: 6, end: 8, lang: 'zh' },
    { start: 8, end: 13, lang: 'en' },
  ]
  const boundaries = [
    { offset: 0, at: 0 },
    { offset: 6, at: 0.3 },
    { offset: 8, at: 0.6 },
  ]

  it('selects the first range before any boundary time', () => {
    expect(activeHighlightRange(ranges, boundaries, 0)).toEqual(ranges[0])
  })

  it('selects the range containing the latest passed boundary offset', () => {
    expect(activeHighlightRange(ranges, boundaries, 0.4)).toEqual(ranges[1])
    expect(activeHighlightRange(ranges, boundaries, 0.9)).toEqual(ranges[2])
  })

  it('returns null when ranges or boundaries are empty', () => {
    expect(activeHighlightRange([], boundaries, 0)).toBeNull()
    expect(activeHighlightRange(ranges, [], 0)).toBeNull()
  })
})
