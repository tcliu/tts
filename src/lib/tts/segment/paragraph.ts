export function pushParagraph(
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

export function splitParagraphRanges(run: { text: string; lang: string; start: number; end: number }) {
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

const CJK_SENTENCE_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
export function isCjkSentenceText(text: string): boolean {
  return CJK_SENTENCE_RE.test(text)
}

export function splitIntoSentences(text: string) {
  const sentences: string[] = []
  let last = 0
  const isCjk = isCjkSentenceText(text)
  const termRe = isCjk
    ? /(?:[.!?。！？，、,;；:：]+\s*|[—─]{2,}\s*|\s+)/g
    : /[.!?。！？]+\s*/g
  let match: RegExpExecArray | null
  while ((match = termRe.exec(text)) !== null) {
    sentences.push(text.slice(last, match.index + match[0].length))
    last = match.index + match[0].length
  }
  if (last < text.length) sentences.push(text.slice(last))
  return sentences
}

export function hardSplit(text: string, maxLength: number) {
  const parts: string[] = []
  let i = 0
  while (i < text.length) {
    parts.push(text.slice(i, i + maxLength))
    i += maxLength
  }
  return parts
}

export function splitLongText(text: string, maxLength: number) {
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

export function cleanParagraph(paragraph: { text: string; start: number; end: number }, lang: string) {
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
      clean += ' '
      offsets.push(input)
      input += 2
      i += 2
      continue
    }
    if (char === '\n') {
      clean += ' '
      offsets.push(input)
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
