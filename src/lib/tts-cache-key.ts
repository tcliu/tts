export function synthesisCacheKey(text: string, voice: string, rate: number): string {
  return JSON.stringify([text, voice, rate])
}
