import { goto } from '$app/navigation'
import { AdminAuthError, adminErrorCode, adminLogout, fetchAdminSession } from '$lib/admin-client'
import { lastDocUrl } from './document-history'

export type AdminAuthState = 'checking' | 'unauthenticated' | 'authenticated' | 'error'

export function useAdminAuth(params: { onSignedOut: () => void; initialAuthenticated: boolean }) {
  const { onSignedOut } = params

  let state = $state<AdminAuthState>(params.initialAuthenticated ? 'authenticated' : 'checking')
  let sessionError = $state('')
  let unconfigured = $state(false)

  function redirectToLogin() {
    if (window.location.pathname !== '/login') {
      void goto('/login')
    }
  }

  function redirectToEditor() {
    const target = lastDocUrl()
    if (window.location.pathname !== target) {
      void goto(target)
    }
  }

  function handleSignedOut() {
    onSignedOut()
    state = 'unauthenticated'
    unconfigured = false
    redirectToLogin()
  }
  async function handleLogout() {
    try {
      await adminLogout()
    } catch {
      // Session cookie may already be gone; still sign out locally.
    }
    onSignedOut()
    state = 'unauthenticated'
    unconfigured = false
    redirectToEditor()
  }

  async function checkSession() {
    try {
      const session = await fetchAdminSession()
      if (session.authenticated) {
        state = 'authenticated'
        sessionError = ''
        unconfigured = false
        return
      }
      unconfigured = !session.configured
    } catch (error) {
      if (error instanceof AdminAuthError) {
        state = 'unauthenticated'
        unconfigured = false
        redirectToLogin()
        return
      }
      sessionError = adminErrorCode(error)
      state = 'error'
      return
    }
    state = 'unauthenticated'
    redirectToLogin()
  }

  function retry() {
    state = 'checking'
    void checkSession()
  }

  function markAuthenticated() {
    state = 'authenticated'
    sessionError = ''
    unconfigured = false
  }

  function markUnconfigured() {
    state = 'unauthenticated'
    unconfigured = true
  }

  return {
    get state() {
      return state
    },
    get sessionError() {
      return sessionError
    },
    get unconfigured() {
      return unconfigured
    },
    checkSession,
    handleLogout,
    handleSignedOut,
    markAuthenticated,
    markUnconfigured,
    retry,
  }
}
