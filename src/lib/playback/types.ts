import type { HighlightRange, TtsBoundary } from '../tts-reference'

export class LocalizedPlaybackError extends Error {}

export interface SegmentMeta {
  index: number
  lang: string
  text: string
  ranges: HighlightRange[]
  boundaries: TtsBoundary[]
  wordBoundaries?: TtsBoundary[]
  baseOffset: number
  duration?: number
  spokenStart?: number
  spokenEnd?: number
  rate?: number
}

export interface PlaybackController {
  cancelled: boolean
  abort: AbortController
  cancelAudio?: () => void
}
