import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { isAdminSession } from '$lib/server/admin-auth'

// Authenticated admins never see the form. Regular users are bounced back to
// the last-opened doc client-side (the active slug lives in localStorage,
// which the server cannot read), so no `returnTo` query is threaded. The
// return is intentionally `{}` so the root layout's `user` stays visible at
// `page.data.user` for that client-side bounce.
export const load: PageServerLoad = async ({ cookies }) => {
  if (isAdminSession({ cookies })) {
    throw redirect(307, '/admin/properties')
  }
  return {}
}
