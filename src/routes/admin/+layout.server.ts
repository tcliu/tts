import type { LayoutServerLoad } from './$types'
import { isAdminSession } from '$lib/server/admin-auth'

export const load: LayoutServerLoad = ({ cookies }) => {
  return { adminAuthenticated: isAdminSession({ cookies }) }
}
