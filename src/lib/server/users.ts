import { getDb } from './db'
import { isUniqueViolation } from './db-errors'
import { hashPassword, verifyPassword } from './admin-auth'

export const MAX_USERNAME_LENGTH = 32
export const MAX_EMAIL_LENGTH = 254
export const MAX_PASSWORD_LENGTH = 256
const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type UserStatus = 'active' | 'inactive'

export interface User {
  id: number
  username: string
  email: string
  status: UserStatus
}

interface UserRow {
  id: number
  username: string
  email: string
  status: string | null
}

interface UserWithHashRow extends UserRow {
  password_hash: string
}

function toUser(row: UserRow): User {
  return {
    id: Number(row.id),
    username: row.username,
    email: row.email,
    status: row.status === 'inactive' ? 'inactive' : 'active',
  }
}

export function normalizeUsername(value: string) {
  const username = value.trim().toLowerCase()
  if (!username) {
    throw new Error('username is required')
  }
  if (username.length > MAX_USERNAME_LENGTH || !USERNAME_PATTERN.test(username)) {
    throw new Error(`username must be 3-${MAX_USERNAME_LENGTH} lowercase letters, numbers, or underscores`)
  }
  return username
}

export function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase()
  if (!email) {
    throw new Error('email is required')
  }
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new Error('email must be a valid email address')
  }
  return email
}

export async function createUser(input: { username: string; email: string; password: string }): Promise<User> {
  const username = normalizeUsername(input.username)
  const email = normalizeEmail(input.email)
  const adminUsername = (process.env.ADMIN_USERNAME || '').trim().toLowerCase() || 'admin'
  if (username === adminUsername) {
    throw new Error('username is reserved')
  }
  if (input.password.length < 12) {
    throw new Error('password_too_short')
  }
  if (input.password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`password must not exceed ${MAX_PASSWORD_LENGTH} characters`)
  }
  const passwordHash = await hashPassword(input.password)
  const db = await getDb()
  try {
    const result = await db.query<UserRow>(
      `insert into users (username, email, password_hash)
       values ($1, $2, $3)
       returning id, username, email, status`,
      [username, email, passwordHash],
    )
    return toUser(result.rows[0])
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error('registration_failed')
    }
    throw error
  }
}

export async function findUserById(id: number): Promise<User | null> {
  const db = await getDb()
  const result = await db.query<UserRow>('select id, username, email, status from users where id = $1', [id])
  const row = result.rows[0]
  return row ? toUser(row) : null
}

export async function findUserByCredentials(identifier: string, password: string): Promise<User | null> {
  const value = identifier.trim().toLowerCase()
  if (!value || !password) {
    return null
  }
  const db = await getDb()
  const result = await db.query<UserWithHashRow>(
    'select id, username, email, status, password_hash from users where username = $1 or email = $2',
    [value, value],
  )
  const row = result.rows[0]
  if (!row || row.status === 'inactive' || !(await verifyPassword(password, row.password_hash))) {
    return null
  }
  return toUser(row)
}
