/** @deprecated re-export shim — import from playback/timing, playback/boundaries or playback/audio-helpers instead */
export { formatClock, RESUME_EPSILON, getSegmentDuration, syntheticRangeAt } from './playback/timing'
export { highlightBoundaries, activeBoundaryAt, locateSegmentStartByCharOffset, locateBoundaryStartWithinOrBefore, trimWhitespaceRange } from './playback/boundaries'
export { readAudioDuration } from './playback/audio-helpers'
