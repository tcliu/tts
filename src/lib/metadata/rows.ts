import { mergeBracketBoundaries, shouldUseRangeRows } from '../bracket-merge'
import { getSegmentDuration, syntheticRangeAt } from '../playback/timing'
import type { SegmentMeta } from '../playback/types'

export interface MetadataWord {
  segmentIndex: number
  sentenceIndex: number
  wordIndex: number
  at: number
  offset: number
  offsetInSegment: number
  atInSegment: number
  text: string
  duration?: number
  active: boolean
}

export interface MetadataRow {
  segmentIndex: number
  sentenceIndex: number
  at: number
  offset: number
  lang: string
  text: string
  boundaryIndex: number
  active: boolean
  words: MetadataWord[]
  hasWords: boolean
}

export function buildSortedRows(segmentMetaMap: Record<number, SegmentMeta>): MetadataRow[] {
  const result: MetadataRow[] = []
  const cumulativeBySegment = new Map<number, number>()
  let cumulative = 0
  const indices = Object.keys(segmentMetaMap).map(Number).sort((a, b) => a - b)
  for (const i of indices) {
    const meta = segmentMetaMap[i]
    if (!meta) continue
    cumulativeBySegment.set(meta.index, cumulative)
    const segDuration = getSegmentDuration(meta)
    if (shouldUseRangeRows(meta)) {
      meta.ranges.forEach((range, boundaryIndex) => {
        const raw = meta.text.slice(range.start, range.end)
        const text = raw.trim() !== '' ? raw.trim() : raw
        result.push({
          segmentIndex: meta.index,
          sentenceIndex: 0,
          at: cumulative + syntheticRangeAt(range, meta.text.length, segDuration),
          offset: meta.baseOffset + range.start,
          lang: range.lang ?? meta.lang,
          text,
          boundaryIndex,
          active: false,
          words: [],
          hasWords: false,
        })
      })
    } else if (meta.boundaries.length === 0) {
      result.push({
        segmentIndex: meta.index,
        sentenceIndex: 0,
        at: cumulative,
        offset: meta.baseOffset,
        lang: meta.lang,
        text: meta.text,
        boundaryIndex: 0,
        active: false,
        words: [],
        hasWords: false,
      })
    } else {
      const mergedBoundaries = mergeBracketBoundaries(meta.boundaries)
      mergedBoundaries.forEach((boundary, boundaryIndex) => {
        const range =
          meta.ranges.find(r => boundary.offset >= r.start && boundary.offset < r.end) ?? meta.ranges[meta.ranges.length - 1]
        const text = boundary.text ?? (range ? meta.text.slice(range.start, range.end) : '')
        result.push({
          segmentIndex: meta.index,
          sentenceIndex: 0,
          at: cumulative + boundary.at,
          offset: meta.baseOffset + boundary.offset,
          lang: meta.lang,
          text,
          boundaryIndex,
          active: false,
          words: [],
          hasWords: false,
        })
      })
    }
    cumulative += segDuration
  }
  result.sort((a, b) => a.segmentIndex - b.segmentIndex || a.at - b.at)
  for (let i = 0; i < result.length; i += 1) {
    result[i].sentenceIndex = i
  }
  const grouped = new Map<number, MetadataRow[]>()
  for (const row of result) {
    const list = grouped.get(row.segmentIndex) ?? []
    list.push(row)
    grouped.set(row.segmentIndex, list)
  }
  for (const [segmentIndex, rows] of grouped) {
    const meta = segmentMetaMap[segmentIndex]
    if (!meta?.wordBoundaries || meta.wordBoundaries.length === 0) continue
    const sortedWords = [...meta.wordBoundaries].sort((a, b) => a.at - b.at)
    const cumulativeStart = cumulativeBySegment.get(segmentIndex) ?? 0
    for (let idx = 0; idx < rows.length; idx += 1) {
      const row = rows[idx]
      const sentenceStartRel = row.offset - meta.baseOffset
      const next = rows[idx + 1]
      const sentenceEndRel = next ? next.offset - meta.baseOffset : meta.text.length
      const filtered = sortedWords.filter(
        wb => wb.offset >= sentenceStartRel && wb.offset < sentenceEndRel,
      )
      const words: MetadataWord[] = filtered.map((wb, wordIdx) => ({
        segmentIndex: meta.index,
        sentenceIndex: row.sentenceIndex,
        wordIndex: wordIdx,
        at: cumulativeStart + wb.at,
        atInSegment: wb.at,
        offset: meta.baseOffset + wb.offset,
        offsetInSegment: wb.offset,
        text: wb.text ?? '',
        duration: wb.duration,
        active: false,
      }))
      row.words = words
      row.hasWords = words.length > 0
    }
  }
  return result
}
