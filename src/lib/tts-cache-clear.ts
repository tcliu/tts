import { synthesisCacheKey } from './tts-cache-key'

export function isScopeInvalidatedByClearedKeys(
  scope: { text: string; lang: string } | null,
  clearedKeys: string[],
  cacheEntries: Array<{ key: string; text: string }>,
  opts: { effectiveSpeed: number; defaultSpeed: number; resolveVoiceEdge: (lang: string) => string },
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
  const candidateKeys =
    opts.effectiveSpeed === opts.defaultSpeed
      ? [synthesisCacheKey(trimmedScope, voiceEdge, opts.effectiveSpeed)]
      : [
          synthesisCacheKey(trimmedScope, voiceEdge, opts.effectiveSpeed),
          synthesisCacheKey(trimmedScope, voiceEdge, opts.defaultSpeed),
        ]
  return candidateKeys.some(key => clearedSet.has(key))
}
