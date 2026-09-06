export class UserAuthError extends Error {
  readonly minLength: number | null
  constructor(code: string, minLength?: number | null) {
    super(code)
    this.name = 'UserAuthError'
    this.minLength = minLength ?? null
  }
}

export interface User {
  id: number
  username: string
  email: string
}

export interface AdminIdentity {
  username: string
}

export interface UserSessionInfo {
  user: User | null
  admin: AdminIdentity | null
}

export type LoginResult = { kind: 'user'; user: User } | { kind: 'admin' }

const AUTH_PATH = '/api/auth'

async function parseResponse<T>(response: Response, fallback: string): Promise<T> {
  const body: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    // Errors travel as stable wire codes (`error`) plus the optional
    // `min_length` context — never raw English literals or technical detail —
    // so every mapper below resolves a localized UI_TEXT string.
    const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
    const code = record && typeof record.error === 'string' ? record.error : fallback
    throw new UserAuthError(code, record && typeof record.min_length === 'number' ? record.min_length : null)
  }
  return body as T
}

export async function login(identifier: string, password: string, rememberMe = false): Promise<LoginResult> {
  const response = await fetch(`${AUTH_PATH}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password, remember_me: rememberMe }),
  })
  const body = await parseResponse<{ user?: User | null; admin?: boolean }>(response, 'invalid_credentials')
  if (body.admin) {
    return { kind: 'admin' }
  }
  if (body.user) {
    return { kind: 'user', user: body.user }
  }
  throw new UserAuthError('invalid_response')
}

export async function register(username: string, email: string, password: string): Promise<User> {
  const response = await fetch(`${AUTH_PATH}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, email, password }),
  })
  const body = await parseResponse<{ user?: User }>(response, 'registration_failed')
  if (!body.user) {
    throw new UserAuthError('registration_failed')
  }
  return body.user
}

export async function logout(): Promise<void> {
  const response = await fetch(`${AUTH_PATH}/logout`, { method: 'POST' })
  await parseResponse<{ ok: boolean }>(response, 'Failed to sign out')
}

export async function fetchUserSession(): Promise<UserSessionInfo> {
  const response = await fetch(`${AUTH_PATH}/session`)
  const body = await parseResponse<{ user?: User | null; admin?: AdminIdentity | null }>(
    response,
    'Failed to check session',
  )
  return { user: body.user ?? null, admin: body.admin ?? null }
}
