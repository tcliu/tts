import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { isAdminSession } from '$lib/server/admin-auth'
import { getCachedSynthesis, isSafeCacheKey } from '$lib/server/tts-cache'

export const GET: RequestHandler = async ({ cookies, url }) => {
  if (!isAdminSession({ cookies })) {
    return json({ error: 'session_required' }, { status: 401 })
  }
  const key = url.searchParams.get('key') ?? ''
  if (!isSafeCacheKey(key)) {
    return json({ error: 'invalid_request' }, { status: 400 })
  }
  const cached = await getCachedSynthesis(key)
  if (!cached) {
    return json({ error: 'not_found' }, { status: 404 })
  }
  return json({ audio: cached.value.audio, etag: cached.etag }, { headers: { 'Cache-Control': 'no-store' } })
}
