import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { isAdminSession, isAdminConfigured } from '$lib/server/admin-auth'

export const GET: RequestHandler = async ({ cookies }) => {
  return json({
    authenticated: isAdminSession({ cookies }),
    configured: await isAdminConfigured(),
  })
}
