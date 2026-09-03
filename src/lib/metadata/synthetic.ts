export function syntheticRangeAt(range: { start: number }, textLength: number, segDuration: number): number {
  return segDuration > 0 ? (range.start / Math.max(1, textLength)) * segDuration : 0
}
