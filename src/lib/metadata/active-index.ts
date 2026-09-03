import { mergeBracketBoundaries, shouldUseRangeRows } from '../bracket-merge'
import { getSegmentDuration, syntheticRangeAt } from '../playback/timing'
import type { SegmentMeta } from '../playback/types'

export function activeBoundaryIndexFor(
  meta: SegmentMeta | undefined,
  activeInfoOffset: number,
  playbackElapsed: number,
): number {
  if (!meta) return -1
  if (shouldUseRangeRows(meta)) {
    const segDuration = getSegmentDuration(meta)
    if (activeInfoOffset >= 0) {
      const pinnedRangeIndex = meta.ranges.findIndex((range, index) => {
        const start = meta.baseOffset + range.start
        const next = meta.ranges[index + 1]
        const end = next ? meta.baseOffset + next.start : meta.baseOffset + meta.text.length
        return activeInfoOffset >= start && activeInfoOffset < end
      })
      if (pinnedRangeIndex >= 0) return pinnedRangeIndex
    }
    let idx = -1
    for (let i = 0; i < meta.ranges.length; i += 1) {
      if (syntheticRangeAt(meta.ranges[i], meta.text.length, segDuration) <= playbackElapsed) idx = i
      else break
    }
    return idx
  }
  const boundaries = mergeBracketBoundaries(meta.boundaries)
  if (activeInfoOffset >= 0) {
    const pinnedBoundaryIndex = boundaries.findIndex((boundary, index) => {
      const start = meta.baseOffset + boundary.offset
      const next = boundaries[index + 1]
      const end = next ? meta.baseOffset + next.offset : meta.baseOffset + meta.text.length
      return activeInfoOffset >= start && activeInfoOffset < end
    })
    if (pinnedBoundaryIndex >= 0) return pinnedBoundaryIndex
  }
  const spokenStart = meta.spokenStart ?? 0
  let idx = -1
  for (let i = 0; i < boundaries.length; i += 1) {
    if (boundaries[i].at - spokenStart <= playbackElapsed) idx = i
    else break
  }
  return idx
}

export function activeWordBoundaryFor(
  meta: SegmentMeta | undefined,
  activeInfoOffset: number,
  activeInfoKind: string | null,
  playbackElapsed: number,
): SegmentMeta['wordBoundaries'] extends (infer U)[] | undefined ? U | null : never {
  if (!meta?.wordBoundaries || meta.wordBoundaries.length === 0) return null as never
  if (activeInfoKind === 'word' && activeInfoOffset >= 0) {
    return (meta.wordBoundaries.find(word => meta.baseOffset + word.offset === activeInfoOffset) ?? null) as never
  }
  const spokenStart = meta.spokenStart ?? 0
  let active: (typeof meta.wordBoundaries)[number] | null = null
  for (const wb of meta.wordBoundaries) {
    if (wb.at - spokenStart <= playbackElapsed) active = wb
    else break
  }
  return active as never
}
