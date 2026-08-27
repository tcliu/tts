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
}

export interface TtsSegment {
  text: string
  lang: string
  indexStart: number
  indexEnd: number
}

export interface HighlightRange {
  start: number
  end: number
  lang: string
}

export interface TtsBoundary {
  offset: number
  at: number
  duration?: number
  text?: string
}

export interface EdgeBoundaryEvent {
  type: 'WordBoundary' | 'SentenceBoundary'
  offset: number
  duration?: number
  text: string
}

export function parseEdgeMetadata(message: string): EdgeBoundaryEvent[] {
  const separator = message.indexOf('\r\n\r\n')
  const jsonPart = separator >= 0 ? message.slice(separator + 4) : message
  let data: {
    Metadata?: {
      Type?: string
      Data?: { Offset?: number; Duration?: number; text?: { Text?: string } }
    }[]
  }
  try {
    data = JSON.parse(jsonPart)
  } catch {
    return []
  }
  if (!Array.isArray(data?.Metadata)) return []
  const events: EdgeBoundaryEvent[] = []
  for (const item of data.Metadata) {
    const type = item?.Type
    const offset = Number(item?.Data?.Offset)
    const duration = Number(item?.Data?.Duration)
    const text = item?.Data?.text?.Text ?? ''
    if ((type === 'WordBoundary' || type === 'SentenceBoundary') && Number.isFinite(offset)) {
      events.push({
        type,
        offset,
        duration: Number.isFinite(duration) ? duration : undefined,
        text,
      })
    }
  }
  return events
}

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

export const SPEED_OPTIONS = SPEEDS.map(value => ({ value: String(value), label: `${value}x` }))

export const REFERENCE_LANGUAGES: TtsLanguage[] = [
  {
    code: 'en',
    name: 'English',
    voices: [
      { name: 'Sonia', gender: 'Female', source: 'edge', edge: 'en-GB-SoniaNeural', group: 'British' },
      { name: 'Ryan', gender: 'Male', source: 'edge', edge: 'en-GB-RyanNeural', group: 'British' },
      { name: 'Libby', gender: 'Female', source: 'edge', edge: 'en-GB-LibbyNeural', group: 'British' },
      { name: 'Maisie', gender: 'Female', source: 'edge', edge: 'en-GB-MaisieNeural', group: 'British' },
      { name: 'Alfie', gender: 'Male', source: 'edge', edge: 'en-GB-AlfieNeural', group: 'British' },
      { name: 'Aria', gender: 'Female', source: 'edge', edge: 'en-US-AriaNeural', group: 'American' },
      { name: 'Jenny', gender: 'Female', source: 'edge', edge: 'en-US-JennyNeural', group: 'American' },
      { name: 'Guy', gender: 'Male', source: 'edge', edge: 'en-US-GuyNeural', group: 'American' },
      { name: 'Michelle', gender: 'Female', source: 'edge', edge: 'en-US-MichelleNeural', group: 'American' },
      { name: 'Ana', gender: 'Female', source: 'edge', edge: 'en-US-AnaNeural', group: 'American' },
      { name: 'Natasha', gender: 'Female', source: 'edge', edge: 'en-AU-NatashaNeural', group: 'Australian' },
      { name: 'William', gender: 'Male', source: 'edge', edge: 'en-AU-WilliamNeural', group: 'Australian' },
      { name: 'Clara', gender: 'Female', source: 'edge', edge: 'en-CA-ClaraNeural', group: 'Canadian' },
      { name: 'Liam', gender: 'Male', source: 'edge', edge: 'en-CA-LiamNeural', group: 'Canadian' },
      { name: 'Neerja', gender: 'Female', source: 'edge', edge: 'en-IN-NeerjaNeural', group: 'Indian' },
      { name: 'Prabhat', gender: 'Male', source: 'edge', edge: 'en-IN-PrabhatNeural', group: 'Indian' },
    ],
  },
  {
    code: 'zh',
    name: 'Chinese',
    voices: [
      { name: 'Xiaoxiao', gender: 'Female', source: 'edge', edge: 'zh-CN-XiaoxiaoNeural', group: 'Mandarin' },
      { name: 'Xiaoyi', gender: 'Female', source: 'edge', edge: 'zh-CN-XiaoyiNeural', group: 'Mandarin' },
      { name: 'Yunxi', gender: 'Male', source: 'edge', edge: 'zh-CN-YunxiNeural', group: 'Mandarin' },
      { name: 'Yunyang', gender: 'Male', source: 'edge', edge: 'zh-CN-YunyangNeural', group: 'Mandarin' },
      { name: 'HiuGaai', gender: 'Female', source: 'edge', edge: 'zh-HK-HiuGaaiNeural', group: 'Cantonese' },
      { name: 'WanLung', gender: 'Male', source: 'edge', edge: 'zh-HK-WanLungNeural', group: 'Cantonese' },
      { name: 'HsiaoChen', gender: 'Female', source: 'edge', edge: 'zh-TW-HsiaoChenNeural', group: 'Taiwan' },
      { name: 'HsiaoYu', gender: 'Female', source: 'edge', edge: 'zh-TW-HsiaoYuNeural', group: 'Taiwan' },
      { name: 'YunJhe', gender: 'Male', source: 'edge', edge: 'zh-TW-YunJheNeural', group: 'Taiwan' },
    ],
  },
  {
    code: 'ja',
    name: 'Japanese',
    voices: [
      { name: 'Nanami', gender: 'Female', source: 'edge', edge: 'ja-JP-NanamiNeural' },
      { name: 'Keita', gender: 'Male', source: 'edge', edge: 'ja-JP-KeitaNeural' },
    ],
  },
  {
    code: 'ko',
    name: 'Korean',
    voices: [
      { name: 'SunHi', gender: 'Female', source: 'edge', edge: 'ko-KR-SunHiNeural' },
      { name: 'InJoon', gender: 'Male', source: 'edge', edge: 'ko-KR-InJoonNeural' },
    ],
  },
  {
    code: 'es',
    name: 'Spanish',
    voices: [
      { name: 'Elvira', gender: 'Female', source: 'edge', edge: 'es-ES-ElviraNeural', group: 'Spain' },
      { name: 'Alvaro', gender: 'Male', source: 'edge', edge: 'es-ES-AlvaroNeural', group: 'Spain' },
      { name: 'Dalia', gender: 'Female', source: 'edge', edge: 'es-MX-DaliaNeural', group: 'Mexico' },
      { name: 'Jorge', gender: 'Male', source: 'edge', edge: 'es-MX-JorgeNeural', group: 'Mexico' },
    ],
  },
  {
    code: 'fr',
    name: 'French',
    voices: [
      { name: 'Denise', gender: 'Female', source: 'edge', edge: 'fr-FR-DeniseNeural', group: 'France' },
      { name: 'Henri', gender: 'Male', source: 'edge', edge: 'fr-FR-HenriNeural', group: 'France' },
      { name: 'Vivienne', gender: 'Female', source: 'edge', edge: 'fr-FR-VivienneNeural', group: 'France' },
      { name: 'Sylvie', gender: 'Female', source: 'edge', edge: 'fr-CA-SylvieNeural', group: 'Canada' },
      { name: 'Jean', gender: 'Male', source: 'edge', edge: 'fr-CA-JeanNeural', group: 'Canada' },
      { name: 'Charline', gender: 'Female', source: 'edge', edge: 'fr-BE-CharlineNeural', group: 'Belgium' },
      { name: 'Gerard', gender: 'Male', source: 'edge', edge: 'fr-BE-GerardNeural', group: 'Belgium' },
    ],
  },
  {
    code: 'ru',
    name: 'Russian',
    voices: [
      { name: 'Svetlana', gender: 'Female', source: 'edge', edge: 'ru-RU-SvetlanaNeural' },
      { name: 'Dmitry', gender: 'Male', source: 'edge', edge: 'ru-RU-DmitryNeural' },
      { name: 'Dariya', gender: 'Female', source: 'edge', edge: 'ru-RU-DariyaNeural' },
    ],
  },
]

const MAX_SEGMENT_LENGTH = 500
const HANGUL_RE = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\ud7b0-\ud7ff]/
const SEGMENT_CJK_RE = /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u3040-\u30ff\u0400-\u052f]/

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
  const options = getVoiceOptions(languageCode, group)
  return options.find(option => option.edge === voiceId) ?? options[0]
}

function detectTtsLanguage(text: string) {
  if (/[\u3040-\u30ff]/.test(text)) return 'ja'
  if (/[嘅咗唔啲佢嗰哋畀]/.test(text)) return 'yue'
  if (HANGUL_RE.test(text)) return 'ko'
  if (/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/.test(text)) return 'zh'
  if (/[\u0400-\u052f]/.test(text)) return 'ru'
  if (/[ñÑ¿¡]/.test(text)) return 'es'
  if (/[çÇœŒæÆàÀèÈêÊîÎôÔûÛùÙâÂ]/.test(text)) return 'fr'
  return 'en'
}

function minimumLength(lang: string) {
  return lang === 'en' ? 4 : 2
}

function splitTtsRuns(text: string) {
  const runs: { text: string; lang: string; start: number; end: number }[] = []
  let pendingWhitespace = ''
  let currentText = ''
  let currentCjk: boolean | null = null

  const flush = (endIndex: number) => {
    if (!currentText) return
    const start = endIndex - pendingWhitespace.length - currentText.length
    const lang = detectTtsLanguage(currentText)
    runs.push({ text: pendingWhitespace + currentText, lang, start, end: endIndex })
    pendingWhitespace = ''
    currentText = ''
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (/^\s$/.test(char)) {
      flush(i)
      pendingWhitespace += char
      continue
    }
    if (/\d/.test(char) && currentCjk !== null) {
      currentText += char
      continue
    }
    if (currentCjk && /[—─]/.test(char)) {
      currentText += char
      continue
    }
    if (currentCjk && (char === ',' || char === '.') && i + 1 < text.length && /\d/.test(text[i + 1])) {
      currentText += char
      continue
    }
    const cjk = SEGMENT_CJK_RE.test(char)
    if (currentCjk === null || currentCjk === cjk) {
      currentCjk = cjk
      currentText += char
    } else {
      flush(i)
      currentCjk = cjk
      currentText = char
    }
  }
  flush(text.length)
  if (pendingWhitespace && runs.length > 0) {
    runs[runs.length - 1].text += pendingWhitespace
    runs[runs.length - 1].end = text.length
  }
  return runs
}

function mergeAdjacentRuns(runs: { text: string; lang: string; start: number; end: number }[]) {
  const merged: { text: string; lang: string; start: number; end: number }[] = []
  for (const run of runs) {
    const last = merged[merged.length - 1]
    if (last && last.lang === run.lang) {
      last.text += run.text
      last.end = run.end
    } else {
      merged.push({ ...run })
    }
  }
  return merged
}

function foldShortRuns(runs: { text: string; lang: string; start: number; end: number }[]) {
  const folded = [...runs]
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < folded.length; i += 1) {
      const run = folded[i]
      if (run.text.trim().length >= minimumLength(run.lang)) continue
      const prev = i > 0 ? folded[i - 1] : null
      const next = i < folded.length - 1 ? folded[i + 1] : null
      if (!prev && !next) continue
      const target = !next || (prev && prev.text.length >= next.text.length) ? i - 1 : i + 1
      if (target === i + 1) {
        folded[target].text = folded[i].text + folded[target].text
        folded[target].start = folded[i].start
      } else {
        folded[target].text += folded[i].text
        folded[target].end = folded[i].end
      }
      folded.splice(i, 1)
      changed = true
      break
    }
  }
  return mergeAdjacentRuns(folded)
}

function mergeBracketedCjkPrefixes(runs: { text: string; lang: string; start: number; end: number }[]) {
  const merged = [...runs]
  for (let i = 0; i < merged.length - 1; i += 1) {
    const current = merged[i]
    const next = merged[i + 1]
    if (current.lang === 'en' && next.lang !== 'en' && /^[\[(<{\u300c\u300e\u3010][\d\s]+$/.test(current.text.trimStart())) {
      next.text = current.text + next.text
      next.start = current.start
      merged.splice(i, 1)
      i -= 1
    }
  }
  return merged
}

function pushParagraph(
  run: { text: string; lang: string; start: number; end: number },
  startOffset: number,
  endOffset: number,
  out: { text: string; start: number; end: number }[],
) {
  const part = run.text.slice(startOffset, endOffset)
  const trimmed = part.trim()
  if (!trimmed) return
  const leading = part.length - part.trimStart().length
  const start = run.start + startOffset + leading
  out.push({ text: trimmed, start, end: start + trimmed.length })
}

function splitParagraphRanges(run: { text: string; lang: string; start: number; end: number }) {
  const out: { text: string; start: number; end: number }[] = []
  let last = 0
  const blankRe = /\n\s*\n/g
  let match: RegExpExecArray | null
  while ((match = blankRe.exec(run.text)) !== null) {
    pushParagraph(run, last, match.index, out)
    last = match.index + match[0].length
  }
  pushParagraph(run, last, run.text.length, out)
  return out
}

function splitIntoSentences(text: string) {
  const sentences: string[] = []
  let last = 0
  const termRe = /[.!?。！？]+\s*/g
  let match: RegExpExecArray | null
  while ((match = termRe.exec(text)) !== null) {
    sentences.push(text.slice(last, match.index + match[0].length))
    last = match.index + match[0].length
  }
  if (last < text.length) sentences.push(text.slice(last))
  return sentences
}

function hardSplit(text: string, maxLength: number) {
  const parts: string[] = []
  let i = 0
  while (i < text.length) {
    parts.push(text.slice(i, i + maxLength))
    i += maxLength
  }
  return parts
}

function splitLongText(text: string, maxLength: number) {
  const sentences = splitIntoSentences(text)
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (sentence.length > maxLength) {
      if (current) {
        chunks.push(current)
        current = ''
      }
      chunks.push(...hardSplit(sentence, maxLength))
      continue
    }
    if (current && current.length + sentence.length > maxLength) {
      chunks.push(current)
      current = sentence
    } else {
      current += sentence
    }
  }
  if (current) chunks.push(current)
  return chunks.filter(chunk => chunk.trim() !== '')
}

function cleanParagraph(paragraph: { text: string; start: number; end: number }, lang: string) {
  if (lang === 'en') {
    const offsets: number[] = []
    for (let i = 0; i < paragraph.text.length; i += 1) offsets.push(paragraph.start + i)
    return { text: paragraph.text, offsets }
  }
  const offsets: number[] = []
  let clean = ''
  let input = paragraph.start
  let i = 0
  while (i < paragraph.text.length) {
    const char = paragraph.text[i]
    if (char === '\r' && paragraph.text[i + 1] === '\n') {
      input += 2
      i += 2
      continue
    }
    if (char === '\n') {
      input += 1
      i += 1
      continue
    }
    clean += char
    offsets.push(input)
    input += 1
    i += 1
  }
  return { text: clean, offsets }
}

export function splitTtsSegments(text: string, maxSegmentLength = MAX_SEGMENT_LENGTH): TtsSegment[] {
  const runs = mergeBracketedCjkPrefixes(foldShortRuns(mergeAdjacentRuns(splitTtsRuns(text))))
  const segments: TtsSegment[] = []
  for (const run of runs) {
    for (const paragraph of splitParagraphRanges(run)) {
      const { text: clean, offsets } = cleanParagraph(paragraph, run.lang)
      if (clean.length === 0) continue
      if (clean.length <= maxSegmentLength) {
        segments.push({
          text: clean,
          lang: run.lang,
          indexStart: offsets[0],
          indexEnd: offsets[offsets.length - 1],
        })
        continue
      }
      const chunks = splitLongText(clean, maxSegmentLength)
      let searchFrom = 0
      for (const chunk of chunks) {
        const chunkStart = clean.indexOf(chunk, searchFrom)
        searchFrom = chunkStart + chunk.length
        const trimmed = chunk.trim()
        if (!trimmed) continue
        const trimmedStart = clean.indexOf(trimmed, chunkStart)
        const trimmedEnd = trimmedStart + trimmed.length
        segments.push({
          text: trimmed,
          lang: run.lang,
          indexStart: offsets[trimmedStart],
          indexEnd: offsets[trimmedEnd - 1],
        })
      }
    }
  }
  return segments
}

function splitSentenceRanges(text: string) {
  const sentences: { text: string; start: number; end: number }[] = []
  let last = 0
  const termRe = /(?:[.!?。！？]+\s*|[—─]{2,}\s*)/g
  let match: RegExpExecArray | null
  while ((match = termRe.exec(text)) !== null) {
    const end = match.index + match[0].length
    sentences.push({ text: text.slice(last, end), start: last, end })
    last = end
  }
  if (last < text.length) {
    sentences.push({ text: text.slice(last), start: last, end: text.length })
  }
  return sentences
}

export function splitHighlightRanges(text: string): HighlightRange[] {
  const ranges: HighlightRange[] = []
  for (const sentence of splitSentenceRanges(text)) {
    const runs = mergeAdjacentRuns(splitTtsRuns(sentence.text))
    let prev: HighlightRange | null = null
    for (const run of runs) {
      const start = sentence.start + run.start
      const end = sentence.start + run.end
      if (prev && prev.lang === run.lang && prev.end === start) {
        prev.end = end
      } else {
        prev = { start, end, lang: run.lang }
        ranges.push(prev)
      }
    }
  }
  return ranges
}

export function activeHighlightRange(
  ranges: HighlightRange[],
  boundaries: TtsBoundary[],
  time: number,
): HighlightRange | null {
  if (ranges.length === 0 || boundaries.length === 0) return null
  let offset = 0
  for (let i = 0; i < boundaries.length; i += 1) {
    if (boundaries[i].at <= time) offset = boundaries[i].offset
    else break
  }
  for (const range of ranges) {
    if (offset >= range.start && offset < range.end) return range
  }
  if (offset < ranges[0].start) return ranges[0]
  return ranges[ranges.length - 1]
}
