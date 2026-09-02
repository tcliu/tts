import type { TtsSegment } from '../tts-reference'

export interface PlaybackSession {
  segments: TtsSegment[]
  offset: number
  selectedRange: { from: number; to: number } | null
  selectionScoped: boolean
  sourceContent: string
  resumeSelection: { from: number; to: number } | null
  resumeIndex: number
  resumeTime: number
  gen: number
  langOverrides: Map<number, string>
  voiceSelections: Map<string, string>
  speed: number | null
}

export function createEmptySession(): PlaybackSession {
  return {
    segments: [],
    offset: 0,
    selectedRange: null,
    selectionScoped: false,
    sourceContent: '',
    resumeSelection: null,
    resumeIndex: 0,
    resumeTime: 0,
    gen: 0,
    langOverrides: new Map(),
    voiceSelections: new Map(),
    speed: null,
  }
}
