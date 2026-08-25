import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { synthesizeEdgeTts } from '$lib/server/edge-tts'
import { synthesisCacheKey, getCachedSynthesis, setCachedSynthesis } from '$lib/server/tts-cache'
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

export const POST: RequestHandler = async ({ request }) => {
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

  try {
    const key = synthesisCacheKey(text, voice, rate)
    const cached = await getCachedSynthesis(key)
    if (cached) {
      return json(cached, { headers: { 'Cache-Control': 'no-store' } })
    }

    const result = await synthesizeEdgeTts(text, voice, rate)
    const payload = {
      audio: Buffer.from(result.audio).toString('base64'),
      boundaries: result.boundaries,
    }
    await setCachedSynthesis(key, payload)
    return json(payload, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('TTS synthesis failed:', error)
    return json({ error: 'Synthesis failed' }, { status: 502 })
  }
}
