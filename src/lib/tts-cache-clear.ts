import { CANONICAL_SYNTHESIS_RATE, synthesisCacheKey } from './tts-cache-key'

export function isScopeInvalidatedByClearedKeys(
  scope: { text: string; lang: string } | null,
  clearedKeys: string[],
  cacheEntries: Array<{ key: string; text: string }>,
  opts: { resolveVoiceEdge: (lang: string) => string },
): boolean {
  if (!scope) return false
  const trimmedScope = scope.text.trim()
  if (!trimmedScope) return false
  const clearedSet = new Set(clearedKeys)
  const clearedTexts = new Set(
    cacheEntries.filter(entry => clearedSet.has(entry.key)).map(entry => (entry.text ?? '').trim()),
  )
  if (clearedTexts.has(trimmedScope)) return true
  const voiceEdge = opts.resolveVoiceEdge(scope.lang)
  if (!voiceEdge) return false
  const candidateKey = synthesisCacheKey(trimmedScope, voiceEdge, CANONICAL_SYNTHESIS_RATE)
  return clearedSet.has(candidateKey)
}
