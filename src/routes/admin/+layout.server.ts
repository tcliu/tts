import { redirect } from '@sveltejs/kit'
import type { LayoutServerLoad } from './$types'
import { isAdminSession } from '$lib/server/admin-auth'

export const load: LayoutServerLoad = ({ cookies }) => {
  if (!isAdminSession({ cookies })) {
    throw redirect(307, '/login')
  }
  return { adminAuthenticated: true }
}
