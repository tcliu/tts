import { activeBoundaryAt, highlightBoundaries } from '../playback-helpers'
import type { TtsBoundary } from '../tts-reference'
import type { SegmentMeta } from './types'
import type { TtsSegment } from '../tts-reference'

export function locateCaretBoundaryAtOrBefore(
  boundaries: TtsBoundary[],
  absoluteBase: number,
  caretOffset: number,
): number {
  let candidate: number | null = null
  for (const b of boundaries) {
    const abs = absoluteBase + b.offset
    if (abs <= caretOffset) candidate = b.at
    else break
  }
  return candidate ?? 0
}

export function charOffsetAtPosition(
  meta: SegmentMeta | undefined,
  segment: TtsSegment | undefined,
  at: number,
  segmentDuration: number,
): number {
  if (!meta || !segment) return 0
  const boundaries = highlightBoundaries(meta)
  const active = boundaries.length > 0 && at < (boundaries[0]?.at ?? 0) ? boundaries[0] : activeBoundaryAt(boundaries, at)
  if (active?.text) {
    return active.offset
  }
  if (segmentDuration > 0) {
    return Math.min(segment.text.length, Math.round((at / segmentDuration) * segment.text.length))
  }
  return 0
}

export function resumeTimeForCharOffset(
  meta: SegmentMeta | undefined,
  segment: TtsSegment | undefined,
  charOffset: number,
  sessionOffset: number,
  segmentDuration: number,
): number {
  if (!meta || !segment) return 0
  const boundaries = highlightBoundaries(meta)
  if (boundaries.length > 0) {
    const absoluteBase = sessionOffset + segment.indexStart
    return locateCaretBoundaryAtOrBefore(boundaries, absoluteBase, absoluteBase + charOffset)
  }
  if (segmentDuration > 0) {
    return (charOffset / Math.max(1, segment.text.length)) * segmentDuration
  }
  return 0
}
