import { mergeBracketRanges as mergeBracketRangesShared } from '../../bracket-merge'
import { splitTtsRuns, mergeAdjacentRuns, refineEnglishRuns } from './runs'
import type { HighlightRange, TtsBoundary } from './types'

import { isCjkSentenceText } from './paragraph'

export function splitSentenceRanges(text: string) {
  const sentences: { text: string; start: number; end: number }[] = []
  let last = 0
  const isCjk = isCjkSentenceText(text)
  const termRe = isCjk
    ? /(?:[.!?。！？，、,;；:：]+\s*|[—─]{2,}\s*|\s+)/g
    : /(?:[.!?。！？]+\s*|[—─]{2,}\s*)/g
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

export function mergeBracketRanges(ranges: HighlightRange[], text: string): HighlightRange[] {
  return mergeBracketRangesShared(ranges, text) as HighlightRange[]
}

export function splitHighlightRanges(text: string): HighlightRange[] {
  const ranges: HighlightRange[] = []
  for (const sentence of splitSentenceRanges(text)) {
    const rawRuns = mergeAdjacentRuns(splitTtsRuns(sentence.text))
    const runs = refineEnglishRuns(rawRuns)
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
  return mergeBracketRanges(ranges, text)
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
