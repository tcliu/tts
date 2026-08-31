export const OPEN_BRACKET_ONLY_RE = /^[【「『（\(\[〈《“‘]+$/
export const CLOSE_BRACKET_ONLY_RE = /^[】」』）\)\]〉》”’]+$/

export interface HighlightRangeLike {
  start: number
  end: number
  lang: string
}

export function mergeBracketRanges<R extends HighlightRangeLike>(ranges: R[], text: string): R[] {
  const merged: R[] = []
  for (let i = 0; i < ranges.length; i += 1) {
    const range = ranges[i]
    const raw = text.slice(range.start, range.end)
    const trimmed = raw.trim()
    const isOpen = trimmed !== '' && OPEN_BRACKET_ONLY_RE.test(trimmed)
    const isClose = trimmed !== '' && CLOSE_BRACKET_ONLY_RE.test(trimmed)
    if (isOpen && i + 1 < ranges.length) {
      const next = ranges[i + 1]
      merged.push({ start: range.start, end: next.end, lang: next.lang } as R)
      i += 1
    } else if (isClose && merged.length > 0) {
      const prev = merged[merged.length - 1]
      // mutate last entry's end to include closing bracket
      ;(prev as { end: number }).end = range.end
    } else {
      merged.push({ ...range })
    }
  }
  return merged
}

export interface BoundaryLike {
  offset: number
  at: number
  duration?: number
  text?: string
}

export function mergeBracketBoundaries<B extends BoundaryLike>(boundaries: B[]): B[] {
  if (boundaries.length === 0) return boundaries
  const merged: B[] = []
  for (let i = 0; i < boundaries.length; i += 1) {
    const cur = boundaries[i]
    const trimmed = (cur.text ?? '').trim()
    const isOpen = trimmed !== '' && OPEN_BRACKET_ONLY_RE.test(trimmed)
    const isClose = trimmed !== '' && CLOSE_BRACKET_ONLY_RE.test(trimmed)
    if (isOpen && i + 1 < boundaries.length) {
      const next = boundaries[i + 1]
      merged.push({
        offset: cur.offset,
        at: cur.at,
        duration: cur.duration,
        text: `${cur.text ?? ''}${next.text ?? ''}`,
      } as B)
      i += 1
    } else if (isClose && merged.length > 0) {
      const prev = merged[merged.length - 1] as BoundaryLike
      prev.text = `${prev.text ?? ''}${cur.text ?? ''}`
    } else {
      merged.push({ ...cur })
    }
  }
  return merged
}

export function shouldUseRangeRows(meta: { ranges: HighlightRangeLike[]; boundaries: BoundaryLike[] }): boolean {
  if (!meta || meta.ranges.length === 0) return false
  const sentenceRangeStarts: number[] = []
  for (let i = 1; i < meta.ranges.length; i += 1) {
    if (meta.ranges[i - 1]?.lang === meta.ranges[i]?.lang) {
      sentenceRangeStarts.push(meta.ranges[i].start)
    }
  }
  if (sentenceRangeStarts.length === 0) return false
  const mergedBoundaries = mergeBracketBoundaries(meta.boundaries)
  if (mergedBoundaries.length === 0) return true
  const boundaryStarts = new Set(mergedBoundaries.map(b => b.offset))
  return sentenceRangeStarts.some(start => !boundaryStarts.has(start))
}
