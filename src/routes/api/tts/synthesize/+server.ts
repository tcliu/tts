import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { logAccess, logEvent, getRequestIp } from '$lib/server/logging'
import { synthesizeEdgeTts } from '$lib/server/edge-tts'
import { synthesisCacheKey, getCachedSynthesis, setCachedSynthesis, matchesIfNoneMatch } from '$lib/server/tts-cache'
import { isRateLimited, RETRY_AFTER_S } from '$lib/server/rate-limit'
import { getMaxTextLength } from '$lib/server/admin-properties'
import { CANONICAL_SYNTHESIS_RATE } from '$lib/tts-cache-key'
import { REFERENCE_LANGUAGES, SPEEDS } from '$lib/tts-reference'

const KNOWN_VOICES = new Set(REFERENCE_LANGUAGES.flatMap(language => language.voices.map(voice => voice.edge)))
// Client segments are capped at 500 chars; allow headroom for direct API use.
const DEFAULT_MAX_TEXT_LENGTH = 2000

function maxTextLength(): number {
  try {
    return getMaxTextLength()
  } catch {
    return DEFAULT_MAX_TEXT_LENGTH
  }
}

// Edge TTS synthesis can take several seconds; give the serverless function
// enough headroom. Vercel caps this per plan (Hobby: 60s max). The runtime
// itself is set once in svelte.config.js.
export const config = {
  maxDuration: 60,
}

export const POST: RequestHandler = async event => {
  const { request } = event
  const ip = getRequestIp(event)
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return json({ error: 'invalid_request' }, { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const voice = typeof body.voice === 'string' ? body.voice.trim() : ''
  const rate = typeof body.rate === 'number' && Number.isFinite(body.rate) ? body.rate : 1

  if (!text) {
    return json({ error: 'text_required' }, { status: 400 })
  }
  const maxText = maxTextLength()
  if (text.length > maxText) {
    return json({ error: 'text_too_long', max_length: maxText }, { status: 413 })
  }
  if (!voice) {
    return json({ error: 'voice_required' }, { status: 400 })
  }
  if (!KNOWN_VOICES.has(voice)) {
    return json({ error: 'unknown_voice' }, { status: 400 })
  }
  if (!(SPEEDS as readonly number[]).includes(rate)) {
    return json({ error: 'invalid_rate' }, { status: 400 })
  }

  const synthesisRate = CANONICAL_SYNTHESIS_RATE
  const key = synthesisCacheKey(text, voice, synthesisRate)
  const startedAt = Date.now()
  logAccess({ event, action: 'tts_synthesize_start', details: { key, voice, rate, synthesis_rate: synthesisRate, text_length: text.length } })

  try {
    const cached = await getCachedSynthesis(key)
    if (cached) {
      const ifNoneMatch = request.headers.get('if-none-match')
      if (ifNoneMatch && matchesIfNoneMatch(ifNoneMatch, cached.etag)) {
        // Client holds the current audio locally; no bytes need to travel.
        logAccess({
          event,
          action: 'tts_synthesize_not_modified',
          details: {
            key,
            voice,
            rate,
            synthesis_rate: synthesisRate,
            text_length: text.length,
            elapsed_ms: Date.now() - startedAt,
          },
        })
        return new Response(null, {
          status: 304,
          headers: { 'Cache-Control': 'no-store', ETag: cached.etag },
        })
      }
      logAccess({
        event,
        action: 'tts_synthesize_cache_hit',
        details: {
          key,
          voice,
          rate,
          synthesis_rate: synthesisRate,
          text_length: text.length,
          audio_bytes: Buffer.byteLength(cached.value.audio, 'base64'),
          elapsed_ms: Date.now() - startedAt,
        },
      })
      // Wire format is snake_case per AGENTS.md/references/api-client.md; internal
      // CachedSynthesis stays camelCase and is mapped at the boundary.
      const wireValue = {
        audio: cached.value.audio,
        boundaries: cached.value.boundaries,
        word_boundaries: cached.value.wordBoundaries,
        spoken_start: cached.value.spokenStart,
        spoken_end: cached.value.spokenEnd,
      }
      return json(wireValue, { headers: { 'Cache-Control': 'no-store', ETag: cached.etag } })
    }

    if (isRateLimited(ip)) {
      logEvent({
        ip,
        action: 'tts_synthesize_rate_limited',
        details: { voice, rate, text_length: text.length, retry_after_s: RETRY_AFTER_S, level: 'WARN' },
      })
      return json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(RETRY_AFTER_S) } })
    }

    const result = await synthesizeEdgeTts(text, voice, synthesisRate)
    const stored: import('$lib/server/tts-cache').CachedSynthesis = {
      audio: Buffer.from(result.audio).toString('base64'),
      boundaries: result.boundaries,
      wordBoundaries: result.wordBoundaries,
      spokenStart: result.spokenStart,
      spokenEnd: result.spokenEnd,
      text,
      voice,
    }
    const etag = await setCachedSynthesis(key, stored)
    const payload = {
      audio: stored.audio,
      boundaries: stored.boundaries,
      word_boundaries: stored.wordBoundaries,
      spoken_start: stored.spokenStart,
      spoken_end: stored.spokenEnd,
    }
    logAccess({
      event,
      action: 'tts_synthesize_complete',
      details: {
        key,
        voice,
        rate,
        synthesis_rate: synthesisRate,
        text_length: text.length,
        audio_bytes: result.audio.byteLength,
        boundary_count: result.boundaries.length,
        elapsed_ms: Date.now() - startedAt,
      },
    })
    return json(payload, { headers: { 'Cache-Control': 'no-store', ETag: etag } })
  } catch (error) {
    logAccess({
      event,
      action: 'tts_synthesize_error',
      details: {
        key,
        voice,
        rate,
        synthesis_rate: synthesisRate,
        text_length: text.length,
        error: error instanceof Error ? error.message : 'Unknown error',
        elapsed_ms: Date.now() - startedAt,
      },
    })
    return json({ error: 'synthesis_failed' }, { status: 502 })
  }
}
