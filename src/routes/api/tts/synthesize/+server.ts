import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { logAccess } from '$lib/server/logging'
import { synthesizeEdgeTts } from '$lib/server/edge-tts'
import { synthesisCacheKey, getCachedSynthesis, setCachedSynthesis, matchesIfNoneMatch } from '$lib/server/tts-cache'
import { REFERENCE_LANGUAGES } from '$lib/tts-reference'

const KNOWN_VOICES = new Set(REFERENCE_LANGUAGES.flatMap(language => language.voices.map(voice => voice.edge)))
// Client segments are capped at 500 chars; allow headroom for direct API use.
const MAX_TEXT_LENGTH = 2000

// Edge TTS synthesis can take several seconds; give the serverless function
// enough headroom. Vercel caps this per plan (Hobby: 60s max). The runtime
// itself is set once in svelte.config.js.
export const config = {
  maxDuration: 60,
}

export const POST: RequestHandler = async event => {
  const { request } = event
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return json({ error: 'Invalid request body' }, { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const voice = typeof body.voice === 'string' ? body.voice.trim() : ''
  const rate = typeof body.rate === 'number' && Number.isFinite(body.rate) ? body.rate : 1

  if (!text) {
    return json({ error: 'Text must not be empty' }, { status: 400 })
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return json({ error: `Text must not exceed ${MAX_TEXT_LENGTH} characters` }, { status: 413 })
  }
  if (!voice) {
    return json({ error: 'Voice must not be empty' }, { status: 400 })
  }
  if (!KNOWN_VOICES.has(voice)) {
    return json({ error: 'Unknown voice' }, { status: 400 })
  }

  const key = synthesisCacheKey(text, voice, rate)
  const startedAt = Date.now()
  logAccess({ event, action: 'tts_synthesize_start', details: { key, voice, rate, text_length: text.length } })

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
          text_length: text.length,
          audio_bytes: Buffer.byteLength(cached.value.audio, 'base64'),
          elapsed_ms: Date.now() - startedAt,
        },
      })
      return json(cached.value, { headers: { 'Cache-Control': 'no-store', ETag: cached.etag } })
    }

    const result = await synthesizeEdgeTts(text, voice, rate)
    const payload = {
      audio: Buffer.from(result.audio).toString('base64'),
      boundaries: result.boundaries,
      wordBoundaries: result.wordBoundaries,
      spokenStart: result.spokenStart,
      spokenEnd: result.spokenEnd,
    }
    const etag = await setCachedSynthesis(key, payload)
    logAccess({
      event,
      action: 'tts_synthesize_complete',
      details: {
        key,
        voice,
        rate,
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
        error: error instanceof Error ? error.message : 'Unknown error',
        elapsed_ms: Date.now() - startedAt,
      },
    })
    return json({ error: 'Synthesis failed' }, { status: 502 })
  }
}
