import { getSegmentDuration, scaledDurationForBase, scaledAtForMediaValue, mediaAtForScaledValue } from './timing'
import type { SegmentMeta } from './types'
import type { TtsSegment } from '../tts/segment'

export function segmentDurationAt(metaMap: Record<number, SegmentMeta>, index: number): number {
  return getSegmentDuration(metaMap[index])
}

export function scaledDurationAt(
  metaMap: Record<number, SegmentMeta>,
  effectiveSpeed: number,
  index: number,
): number {
  const base = segmentDurationAt(metaMap, index)
  if (base === 0) return 0
  const meta = metaMap[index]
  const rate = meta?.rate ?? effectiveSpeed
  return scaledDurationForBase(base, rate, effectiveSpeed)
}

export function scaledAtForMedia(
  metaMap: Record<number, SegmentMeta>,
  effectiveSpeed: number,
  index: number,
  mediaAt: number,
): number {
  const meta = metaMap[index]
  const rate = meta?.rate ?? effectiveSpeed
  return scaledAtForMediaValue(mediaAt, rate, effectiveSpeed)
}

export function mediaAtForScaled(
  metaMap: Record<number, SegmentMeta>,
  effectiveSpeed: number,
  index: number,
  scaledAt: number,
): number {
  const meta = metaMap[index]
  const rate = meta?.rate ?? effectiveSpeed
  return mediaAtForScaledValue(scaledAt, rate, effectiveSpeed)
}

export function locatePlaybackPosition(input: {
  segments: TtsSegment[]
  metaMap: Record<number, SegmentMeta>
  effectiveSpeed: number
  totalDuration: number
  scaledElapsed: number
}): { index: number; startAt: number } | null {
  const { segments, metaMap, effectiveSpeed, totalDuration, scaledElapsed } = input
  if (segments.length === 0) return null
  const clampedScaled = Math.max(0, Math.min(scaledElapsed, totalDuration || scaledElapsed))
  let total = 0
  for (let index = 0; index < segments.length; index += 1) {
    const duration = scaledDurationAt(metaMap, effectiveSpeed, index)
    if (index === segments.length - 1 || clampedScaled <= total + duration) {
      const scaledAt = Math.max(0, clampedScaled - total)
      return { index, startAt: mediaAtForScaled(metaMap, effectiveSpeed, index, scaledAt) }
    }
    total += duration
  }
  return { index: segments.length - 1, startAt: 0 }
}
