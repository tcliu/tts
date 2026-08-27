import { synthesisCacheKey } from './tts-cache-key'
import type { TtsBoundary } from './tts-reference'

export interface SynthesizedSegment {
  blob: Blob
  boundaries: TtsBoundary[]
  wordBoundaries?: TtsBoundary[]
  spokenStart?: number
  spokenEnd?: number
}

const SYNTHESIS_CACHE_MAX = 200
const synthesisCache = new Map<string, SynthesizedSegment>()

function cacheSynthesis(key: string, entry: SynthesizedSegment) {
  if (synthesisCache.has(key)) {
    synthesisCache.delete(key)
  }
  synthesisCache.set(key, entry)
  while (synthesisCache.size > SYNTHESIS_CACHE_MAX) {
    const oldest = synthesisCache.keys().next().value
    if (oldest === undefined) break
    synthesisCache.delete(oldest)
  }
}

async function requestSynthesis(
  textToSpeak: string,
  voiceId: string,
  rate: number,
  signal?: AbortSignal,
): Promise<SynthesizedSegment> {
  const response = await fetch('/api/tts/synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: textToSpeak, voice: voiceId, rate }),
    signal,
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(typeof data.error === 'string' ? data.error : 'Synthesis failed.')
  }

  const data = (await response.json()) as {
    audio: string
    boundaries: TtsBoundary[]
    wordBoundaries?: TtsBoundary[]
    spokenStart?: number
    spokenEnd?: number
  }
  const binary = atob(data.audio)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return {
    blob: new Blob([bytes], { type: 'audio/mpeg' }),
    boundaries: data.boundaries,
    wordBoundaries: data.wordBoundaries ?? [],
    spokenStart: data.spokenStart,
    spokenEnd: data.spokenEnd,
  }
}

export function peekCachedSynthesis(
  textToSpeak: string,
  voiceId: string,
  rate: number,
): SynthesizedSegment | null {
  const cacheKey = synthesisCacheKey(textToSpeak, voiceId, rate)
  return synthesisCache.get(cacheKey) ?? null
}

export async function getCachedSynthesis(
  textToSpeak: string,
  voiceId: string,
  rate: number,
  signal?: AbortSignal,
): Promise<SynthesizedSegment> {
  const cacheKey = synthesisCacheKey(textToSpeak, voiceId, rate)
  const cached = synthesisCache.get(cacheKey)
  if (cached) return cached
  const entry = await requestSynthesis(textToSpeak, voiceId, rate, signal)
  cacheSynthesis(cacheKey, entry)
  return entry
}
