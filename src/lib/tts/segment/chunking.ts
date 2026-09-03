import { splitTtsRuns, mergeAdjacentRuns, foldShortRuns, mergeBracketedCjkPrefixes, refineEnglishRuns } from './runs'
import { splitParagraphRanges, cleanParagraph, splitLongText } from './paragraph'
import { MAX_SEGMENT_LENGTH } from '../detect'
import type { TtsSegment } from './types'

export function splitTtsSegments(text: string, maxSegmentLength = MAX_SEGMENT_LENGTH): TtsSegment[] {
  const rawRuns = mergeBracketedCjkPrefixes(foldShortRuns(mergeAdjacentRuns(splitTtsRuns(text))))
  const runs = refineEnglishRuns(rawRuns)
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
