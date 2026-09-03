export interface TtsSegment {
  text: string
  lang: string
  indexStart: number
  indexEnd: number
}

export interface HighlightRange {
  start: number
  end: number
  lang: string
}

export interface TtsBoundary {
  offset: number
  at: number
  duration?: number
  text?: string
}
