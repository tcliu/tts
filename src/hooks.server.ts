import type { Handle } from '@sveltejs/kit'
import { assertProdEnv } from '$lib/server/env'
import { getCurrentUserId } from '$lib/server/user-auth'
import { findUserById } from '$lib/server/users'

assertProdEnv()

export const handle: Handle = async ({ event, resolve }) => {
  const userId = getCurrentUserId(event.cookies)
  if (userId !== null) {
    const user = await findUserById(userId)
    event.locals.user =
      user && user.status === 'active'
        ? { id: user.id, username: user.username, email: user.email }
        : null
  } else {
    event.locals.user = null
  }
  return resolve(event)
}
