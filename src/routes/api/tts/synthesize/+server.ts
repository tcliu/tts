import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { synthesizeEdgeTts } from '$lib/server/edge-tts'
import { synthesisCacheKey, getCachedSynthesis, setCachedSynthesis } from '$lib/server/tts-cache'

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return json({ error: 'Invalid request body' }, { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const voice = typeof body.voice === 'string' ? body.voice.trim() : ''
  const rate = typeof body.rate === 'number' ? body.rate : 1

  if (!text) {
    return json({ error: 'Text must not be empty' }, { status: 400 })
  }
  if (!voice) {
    return json({ error: 'Voice must not be empty' }, { status: 400 })
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
    const message = error instanceof Error ? error.message : 'Synthesis failed'
    return json({ error: message }, { status: 502 })
  }
}
