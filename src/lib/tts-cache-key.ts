export const CANONICAL_SYNTHESIS_RATE = 1

// rate is retained for call-site compat; the cache is canonical at 1× and
// reused across playback speeds via HTMLAudioElement.playbackRate.
export function synthesisCacheKey(text: string, voice: string, _rate?: number): string {
  return JSON.stringify([text.trim(), voice, CANONICAL_SYNTHESIS_RATE])
}
