import { splitTtsSegments } from '../tts-reference'
import type { TtsBoundary } from '../tts-reference'
import { trimWhitespaceRange } from '../playback-helpers'

export function hasNonEmptySelection(range: { from: number; to: number } | null | undefined): boolean {
  return !!range && range.to > range.from
}

export function clampRangeToContent(
  range: { from: number; to: number },
  content: string,
): { from: number; to: number } | null {
  const from = Math.max(0, Math.min(range.from, content.length))
  const to = Math.max(from, Math.min(range.to, content.length))
  return to > from ? { from, to } : null
}

export function trimmedContentRange(
  range: { from: number; to: number },
  content: string,
): { from: number; to: number; text: string } | null {
  const clamped = clampRangeToContent(range, content)
  if (!clamped) return null
  const raw = content.slice(clamped.from, clamped.to)
  const trimmed = trimWhitespaceRange(raw, 0, raw.length)
  const text = raw.slice(trimmed.start, trimmed.end)
  if (!text) return null
  return {
    from: clamped.from + trimmed.start,
    to: clamped.from + trimmed.end,
    text,
  }
}

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9]/.test(ch)
}

export function getCoveringSegments(
  scoped: { from: number; to: number },
  segments: ReturnType<typeof splitTtsSegments>,
): ReturnType<typeof splitTtsSegments> {
  return segments.filter(seg => seg.indexStart < scoped.to && seg.indexEnd >= scoped.from)
}

export interface ReusableScopedSegment {
  source: ReturnType<typeof splitTtsSegments>[number]
  text: string
  lang: string
  indexStart: number
  indexEnd: number
  sourceStartAt: number
  sourceEndAt: number
  boundaries: TtsBoundary[]
  wordBoundaries: TtsBoundary[]
}

export function isPartialWordSelection(
  scoped: { from: number; to: number },
  content: string,
  covering: ReturnType<typeof splitTtsSegments>,
  sessionSegments: ReturnType<typeof splitTtsSegments>,
  segmentMetaMap: Record<number, { wordBoundaries?: TtsBoundary[] }>,
): boolean {
  if (covering.length === 0) return false
  const firstSeg = covering[0]
  const lastSeg = covering[covering.length - 1]
  const firstIdx = sessionSegments.findIndex(s => s.indexStart === firstSeg.indexStart && s.indexEnd === firstSeg.indexEnd && s.text === firstSeg.text)
  const lastIdx = sessionSegments.findIndex(s => s.indexStart === lastSeg.indexStart && s.indexEnd === lastSeg.indexEnd && s.text === lastSeg.text)
  const firstMeta = firstIdx >= 0 ? segmentMetaMap[firstIdx] : undefined
  const lastMeta = lastIdx >= 0 ? segmentMetaMap[lastIdx] : undefined

  const checkInsideWord = (absOffset: number, seg: ReturnType<typeof splitTtsSegments>[number], meta: { wordBoundaries?: TtsBoundary[] } | undefined): boolean => {
    if (!meta?.wordBoundaries || meta.wordBoundaries.length === 0) {
      const prev = absOffset > 0 ? content[absOffset - 1] : ''
      const curr = absOffset < content.length ? content[absOffset] : ''
      return !!prev && !!curr && isWordChar(prev) && isWordChar(curr)
    }
    for (const wb of meta.wordBoundaries) {
      const wFrom = seg.indexStart + wb.offset
      const wTo = wFrom + (wb.text?.length ?? 0)
      if (absOffset > wFrom && absOffset < wTo) return true
    }
    return false
  }

  if (checkInsideWord(scoped.from, firstSeg, firstMeta)) return true
  if (checkInsideWord(scoped.to, lastSeg, lastMeta)) return true
  return false
}

export function buildReusableScopedSegments(
  scoped: { from: number; to: number },
  content: string,
  deps: {
    peekCachedSynthesis: (text: string, voiceEdge: string) => { boundaries: TtsBoundary[]; wordBoundaries?: TtsBoundary[]; spokenEnd?: number } | null
    resolveEffectiveVoice: (lang: string) => { edge: string } | undefined
    sessionSegments: ReturnType<typeof splitTtsSegments>
    segmentMetaMap: Record<number, { wordBoundaries?: TtsBoundary[] }>
  },
): ReusableScopedSegment[] | null {
  const { peekCachedSynthesis, resolveEffectiveVoice, sessionSegments, segmentMetaMap } = deps
  const fullSegments = splitTtsSegments(content)
  const covering = getCoveringSegments(scoped, fullSegments)
  if (covering.length === 0) return null
  if (isPartialWordSelection(scoped, content, covering, sessionSegments, segmentMetaMap)) return null
  const reusable: ReusableScopedSegment[] = []
  for (const seg of covering) {
    const voice = resolveEffectiveVoice(seg.lang)
    if (!voice?.edge) return null
    const cached = peekCachedSynthesis(seg.text, voice.edge)
    if (!cached) return null
    const sourceWordBoundaries = cached.wordBoundaries ?? []
    const sourceBoundaries = sourceWordBoundaries.length > 0 ? sourceWordBoundaries : cached.boundaries
    if (sourceBoundaries.length === 0) return null
    const selectedWords = sourceBoundaries.filter(boundary => {
      const absoluteStart = seg.indexStart + boundary.offset
      const absoluteEnd = absoluteStart + (boundary.text?.length ?? 0)
      return absoluteStart >= scoped.from && absoluteEnd <= scoped.to
    })
    if (selectedWords.length === 0) continue
    const first = selectedWords[0]
    const last = selectedWords[selectedWords.length - 1]
    const sourceStartAt = first.at
    const lastBoundaryEnd = last.duration != null ? last.at + last.duration : null
    const nextAfterLast = sourceBoundaries.find(boundary => boundary.at > last.at)
    const sourceEndAt = lastBoundaryEnd ?? nextAfterLast?.at ?? cached.spokenEnd ?? last.at + 0.5
    const absoluteStart = seg.indexStart + first.offset
    const absoluteEnd = Math.min(scoped.to, seg.indexEnd + 1)
    const text = content.slice(absoluteStart, absoluteEnd)
    const wordBoundaries = selectedWords.map(boundary => ({
      offset: seg.indexStart + boundary.offset - absoluteStart,
      at: boundary.at - sourceStartAt,
      text: boundary.text,
      duration: boundary.duration,
    }))
    const sentenceStarts = [absoluteStart]
    for (const boundary of cached.boundaries) {
      const start = seg.indexStart + boundary.offset
      if (start > absoluteStart && start < absoluteEnd) {
        sentenceStarts.push(start)
      }
    }
    sentenceStarts.sort((a, b) => a - b)
    const sentenceBoundaries = sentenceStarts.map((start, index) => {
      const nextStart = sentenceStarts[index + 1] ?? absoluteEnd
      const offset = start - absoluteStart
      const t = content.slice(start, nextStart)
      const sourceBoundary = cached.boundaries.find(boundary => seg.indexStart + boundary.offset === start)
      const boundaryAt = sourceBoundary ? Math.max(0, sourceBoundary.at - sourceStartAt) : 0
      return {
        offset,
        at: boundaryAt,
        text: t,
      }
    })
    reusable.push({
      source: seg,
      text,
      lang: seg.lang,
      indexStart: absoluteStart,
      indexEnd: absoluteEnd - 1,
      sourceStartAt,
      sourceEndAt,
      boundaries: sentenceBoundaries,
      wordBoundaries,
    })
  }
  return reusable.length > 0 ? reusable : null
}
