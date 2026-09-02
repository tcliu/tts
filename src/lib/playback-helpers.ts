import type { TtsBoundary } from './tts-reference'

type BoundaryMeta = { wordBoundaries?: TtsBoundary[]; boundaries: TtsBoundary[] }

export function formatClock(sec: number): string {
  const value = Math.max(0, sec || 0)
  const roundedTenths = Math.round(value * 10)
  const minutes = Math.floor(roundedTenths / 600)
  const seconds = Math.floor((roundedTenths % 600) / 10)
  const tenths = roundedTenths % 10
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`
}

export const RESUME_EPSILON = 0.08

export function highlightBoundaries(meta: BoundaryMeta | undefined, fallback: TtsBoundary[] = []): TtsBoundary[] {
  if (meta?.wordBoundaries && meta.wordBoundaries.length > 0) {
    return meta.wordBoundaries
  }
  if (meta?.boundaries.length) {
    return meta.boundaries
  }
  return fallback
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

export function trimWhitespaceRange(text: string, start: number, end: number): { start: number; end: number } {
  let s = start
  let e = end
  while (s < e && /\s/.test(text[s] ?? '')) s += 1
  while (e > s && /\s/.test(text[e - 1] ?? '')) e -= 1
  return { start: s, end: e }
}

export function readAudioDuration(blob: Blob, signal: AbortSignal): Promise<number> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve(0)
      return
    }
    const audio = new Audio()
    const url = URL.createObjectURL(blob)
    let settled = false
    const cleanup = () => {
      signal.removeEventListener('abort', handleAbort)
      audio.onloadedmetadata = null
      audio.onerror = null
      audio.pause()
      audio.src = ''
      URL.revokeObjectURL(url)
    }
    const finish = (duration: number) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Number.isFinite(duration) ? duration : 0)
    }
    const handleAbort = () => finish(0)
    signal.addEventListener('abort', handleAbort, { once: true })
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => finish(audio.duration)
    audio.onerror = () => finish(0)
    audio.src = url
  })
}
