export function synthesisCacheKey(text: string, voice: string, rate: number): string {
  return JSON.stringify([text.trim(), voice, rate])
}
