import type { SegmentMeta } from '../use-playback.svelte'

export function segmentDurationForMeta(meta: SegmentMeta | undefined): number {
  if (!meta) return 0
  if (meta.spokenEnd != null && meta.spokenStart != null) {
    return Math.max(0, meta.spokenEnd - meta.spokenStart)
  }
  return meta.duration ?? 0
}

export function scaledDurationForBase(base: number, rate: number, speed: number): number {
  if (base === 0) return 0
  const s = speed || 1
  return (base * rate) / s
}

export function scaledAtForMediaValue(mediaAt: number, rate: number, speed: number): number {
  const s = speed || 1
  return (mediaAt * rate) / s
}

export function mediaAtForScaledValue(scaledAt: number, rate: number, speed: number): number {
  const s = speed || 1
  return (scaledAt * s) / rate
}
