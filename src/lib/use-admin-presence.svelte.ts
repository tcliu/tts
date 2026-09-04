import { fetchAdminSession } from './admin-client'

export function useAdminPresence() {
  let isAdmin = $state(false)

  async function refresh() {
    try {
      const session = await fetchAdminSession()
      isAdmin = session.authenticated
    } catch {
      isAdmin = false
    }
  }

  return {
    get isAdmin() {
      return isAdmin
    },
    refresh,
  }
}
