import { activeBoundaryAt, highlightBoundaries, trimWhitespaceRange } from './boundaries'
import { activeHighlightRange } from '../tts-reference'
import type { SegmentMeta } from './types'
import type { TtsSegment } from '../tts-reference'

export interface HighlightRangeResult {
  from: number
  to: number
}

export function getHighlightRangeForPosition(
  meta: SegmentMeta | undefined,
  segment: TtsSegment | undefined,
  at: number,
  absoluteBase: number,
): HighlightRangeResult | null {
  if (!segment) return null
  const setWholeSegmentSelection = (): HighlightRangeResult => {
    const trimmed = trimWhitespaceRange(segment.text, 0, segment.text.length)
    return { from: absoluteBase + trimmed.start, to: absoluteBase + trimmed.end }
  }
  const boundaries = highlightBoundaries(meta)
  if (!meta || meta.ranges.length === 0 || boundaries.length === 0) {
    return setWholeSegmentSelection()
  }
  const activeBoundary = at < (boundaries[0]?.at ?? 0) ? boundaries[0] : activeBoundaryAt(boundaries, at)
  if (activeBoundary?.text) {
    const wordStart = activeBoundary.offset
    const wordEnd = wordStart + activeBoundary.text.length
    const trimmed = trimWhitespaceRange(segment.text, wordStart, wordEnd)
    return { from: absoluteBase + trimmed.start, to: absoluteBase + trimmed.end }
  }
  const range = activeHighlightRange(meta.ranges, boundaries, at)
  if (!range) {
    return setWholeSegmentSelection()
  }
  const trimmed = trimWhitespaceRange(segment.text, range.start, range.end)
  return { from: absoluteBase + trimmed.start, to: absoluteBase + trimmed.end }
}
