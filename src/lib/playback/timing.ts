import type { SegmentMeta } from './types'

export function getSegmentDuration(meta: SegmentMeta | undefined): number {
  if (!meta) return 0
  if (meta.spokenEnd != null && meta.spokenStart != null) {
    return Math.max(0, meta.spokenEnd - meta.spokenStart)
  }
  return meta.duration ?? 0
}

export function scaledDurationForBase(base: number, rate: number, speed: number): number {
  if (base === 0) return 0
  const s = speed ?? 1
  return (base * rate) / s
}

export function scaledAtForMediaValue(mediaAt: number, rate: number, speed: number): number {
  const s = speed ?? 1
  return (mediaAt * rate) / s
}

export function mediaAtForScaledValue(scaledAt: number, rate: number, speed: number): number {
  const s = speed ?? 1
  return (scaledAt * s) / rate
}

export function syntheticRangeAt(range: { start: number }, textLength: number, segDuration: number): number {
  return segDuration > 0 ? (range.start / Math.max(1, textLength)) * segDuration : 0
}

export function formatClock(sec: number): string {
  const value = Math.max(0, sec || 0)
  const roundedTenths = Math.round(value * 10)
  const minutes = Math.floor(roundedTenths / 600)
  const seconds = Math.floor((roundedTenths % 600) / 10)
  const tenths = roundedTenths % 10
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`
}

export const RESUME_EPSILON = 0.08
