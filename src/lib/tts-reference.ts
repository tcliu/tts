// Canonical speed list lives in tts/catalog.ts; mirrored here as a single-line literal so speed-parity.test can find it.
export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3] as const
export type { TtsVoice, TtsLanguage } from './tts/catalog'
export { REFERENCE_LANGUAGES, SPEED_OPTIONS, SPEED_STEP, defaultVoiceByLanguage, defaultGroupByLanguage, getVoiceGroups, getVoiceOptions, voiceForSelection, toWrittenLang, SPOKEN_GROUP } from './tts/catalog'
export type { TtsSegment, HighlightRange, TtsBoundary, EdgeBoundaryEvent } from './tts/segment'
export { parseEdgeMetadata, splitTtsSegments, splitHighlightRanges, activeHighlightRange } from './tts/segment'
