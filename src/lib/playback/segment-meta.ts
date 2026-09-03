import { splitHighlightRanges } from '../tts-reference'
import type { TtsBoundary } from '../tts-reference'
import type { TtsSegment } from '../tts-reference'
import type { SegmentMeta } from './types'
import { CANONICAL_SYNTHESIS_RATE } from '../tts-cache-key'

export function buildSegmentMeta(
  index: number,
  segment: TtsSegment,
  fields: {
    boundaries: TtsBoundary[]
    wordBoundaries?: TtsBoundary[]
    duration?: number
    spokenStart?: number
    spokenEnd?: number
    rate?: number
  },
  baseOffset: number,
): SegmentMeta {
  return {
    index,
    lang: segment.lang,
    text: segment.text,
    ranges: splitHighlightRanges(segment.text),
    boundaries: fields.boundaries,
    wordBoundaries: fields.wordBoundaries ?? [],
    baseOffset,
    duration: fields.duration,
    spokenStart: fields.spokenStart,
    spokenEnd: fields.spokenEnd,
    rate: fields.rate ?? CANONICAL_SYNTHESIS_RATE,
  }
}
