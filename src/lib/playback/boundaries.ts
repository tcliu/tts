import type { TtsBoundary } from '../tts-reference'

type BoundaryMeta = { wordBoundaries?: TtsBoundary[]; boundaries: TtsBoundary[] }

export function highlightBoundaries(meta: BoundaryMeta | undefined, fallback: TtsBoundary[] = []): TtsBoundary[] {
  if (meta?.wordBoundaries && meta.wordBoundaries.length > 0) {
    return meta.wordBoundaries
  }
  if (meta?.boundaries.length) {
    return meta.boundaries
  }
  return fallback
}

export function activeBoundaryAt(boundaries: TtsBoundary[], at: number): TtsBoundary | null {
  let active: TtsBoundary | null = null
  for (let i = 0; i < boundaries.length; i += 1) {
    if (boundaries[i].at <= at) {
      active = boundaries[i]
      continue
    }
    break
  }
  return active
}

export function locateSegmentStartByCharOffset(
  segments: Array<{ indexEnd: number }>,
  charOffset: number,
): { index: number; charOffset: number } {
  if (segments.length === 0) {
    return { index: 0, charOffset }
  }
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (charOffset <= segment.indexEnd) {
      return { index, charOffset }
    }
  }
  return { index: segments.length - 1, charOffset }
}

export function locateBoundaryStartWithinOrBefore(
  boundaries: TtsBoundary[],
  absoluteBase: number,
  range: { from: number; to: number },
): number {
  let candidateAt: number | null = null
  for (const boundary of boundaries) {
    const absoluteOffset = absoluteBase + boundary.offset
    if (absoluteOffset >= range.from && absoluteOffset < range.to) {
      return boundary.at
    }
    if (absoluteOffset <= range.from) {
      candidateAt = boundary.at
      continue
    }
    break
  }
  return candidateAt ?? 0
}

export function trimWhitespaceRange(text: string, start: number, end: number): { start: number; end: number } {
  let s = start
  let e = end
  while (s < e && /\s/.test(text[s] ?? '')) s += 1
  while (e > s && /\s/.test(text[e - 1] ?? '')) e -= 1
  return { start: s, end: e }
}
