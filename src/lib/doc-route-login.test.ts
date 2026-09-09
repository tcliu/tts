import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pageSource = readFileSync('src/routes/[[docId]]/+page.svelte', 'utf-8')
const loginSource = readFileSync('src/routes/login/+page.svelte', 'utf-8')
const authSource = readFileSync('src/lib/use-admin-auth.svelte.ts', 'utf-8')

describe('login dialog routing contract', () => {
  it('auto-opens the login dialog on ?login and strips the param without navigating', () => {
    expect(pageSource).toContain("new URLSearchParams(window.location.search).get('login')")
    expect(pageSource).toContain('loginOpen = true')
    expect(pageSource).toContain('window.history.replaceState')
  })

  it('sends /login visitors to the editor with the dialog flag instead of a form', () => {
    expect(loginSource).toContain('`${lastDocUrl()}?login=1`')
    expect(loginSource).not.toContain('<UserAuthPanel')
  })

  it('lands explicit admin sign-out on the editor root, keeping /login for expired sessions', () => {
    expect(authSource).toContain("void goto('/')")
    expect(authSource).not.toContain('redirectToEditor')
    expect(authSource).toContain("void goto('/login')")
  })
})
