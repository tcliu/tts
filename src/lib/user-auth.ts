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
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      typeof body === 'object' && body !== null && typeof body.error === 'string' ? body.error : fallback,
    )
  }
  return body as T
}

export async function login(identifier: string, password: string, rememberMe = false): Promise<LoginResult> {
  const response = await fetch(`${AUTH_PATH}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password, remember_me: rememberMe }),
  })
  const body = await parseResponse<{ user?: User | null; admin?: boolean }>(response, 'Failed to sign in')
  if (body.admin) {
    return { kind: 'admin' }
  }
  if (body.user) {
    return { kind: 'user', user: body.user }
  }
  throw new Error('Unexpected login response')
}

export async function register(username: string, email: string, password: string): Promise<User> {
  const response = await fetch(`${AUTH_PATH}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, email, password }),
  })
  const body = (await response.json().catch(() => ({}))) as { user?: User; error?: unknown; min_length?: unknown }
  if (!response.ok) {
    const code = typeof body.error === 'string' ? body.error : 'Failed to create account'
    const minLength = typeof body.min_length === 'number' ? body.min_length : null
    throw new UserAuthError(code, minLength)
  }
  if (!body.user) {
    throw new UserAuthError('Unexpected register response')
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
