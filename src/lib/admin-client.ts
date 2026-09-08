import type { TtsI18n } from './i18n.svelte'

export class AdminAuthError extends Error {
  constructor(message = 'Admin session expired') {
    super(message)
    this.name = 'AdminAuthError'
  }
}

export class AdminRequestError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'AdminRequestError'
    this.code = code
  }
}

export function adminErrorCode(error: unknown): string {
  if (error instanceof AdminRequestError) return error.code
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'request_timeout'
  return 'request_failed'
}

export function adminErrorMessage(code: string, i18n: TtsI18n): string {
  switch (code) {
    case 'rate_limited':
      return i18n.t('adminErrorRateLimited')
    case 'invalid_request':
      return i18n.t('adminErrorBadRequest')
    case 'invalid_property':
      return i18n.t('adminErrorInvalidProperty')
    case 'request_timeout':
      return i18n.t('adminErrorTimeout')
    default:
      return i18n.t('adminErrorGeneric')
  }
}

export type AdminPropertySource = 'file' | 'environment' | 'default'

export interface AdminProperty {
  key: string
  labelKey: string
  descriptionKey: string
  kind: 'number'
  defaultValue: number
  envKey: string
  min?: number
  max?: number
  value: number
  source: AdminPropertySource
}

export interface AdminServerCacheEntry {
  key: string
  text: string | null
  voice: string | null
  savedAt: number
  bytes: number
}

export interface AdminServerCacheStats {
  entries: number
  bytes: number
}

export interface AdminSessionInfo {
  authenticated: boolean
  configured: boolean
}

const BASE_PATH = '/api/admin'
const REQUEST_TIMEOUT_MS = 15_000

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}))
  if (response.status === 401) {
    throw new AdminAuthError()
  }
  if (!response.ok) {
    const code =
      typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : 'request_failed'
    throw new AdminRequestError(code)
  }
  return body as T
}

function withTimeout(): { signal: AbortSignal; cleanup: () => void } {
  if (typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cleanup: () => {} }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) }
}

async function get<T>(path: string): Promise<T> {
  const { signal, cleanup } = withTimeout()
  try {
    const response = await fetch(`${BASE_PATH}${path}`, { signal })
    return await parseResponse<T>(response)
  } finally {
    cleanup()
  }
}

async function send<T>(path: string, method: string, payload: unknown): Promise<T> {
  const { signal, cleanup } = withTimeout()
  try {
    const response = await fetch(`${BASE_PATH}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
    return await parseResponse<T>(response)
  } finally {
    cleanup()
  }
}

interface WireProperty {
  key: string
  label_key: string
  description_key: string
  kind: 'number'
  default_value: number
  env_key: string
  min?: number
  max?: number
  value: number
  source: AdminPropertySource
}

interface WireCacheEntry {
  key: string
  text: string | null
  voice: string | null
  saved_at: number
  bytes: number
}

function mapProperty(wire: WireProperty): AdminProperty {
  return {
    key: wire.key,
    labelKey: wire.label_key,
    descriptionKey: wire.description_key,
    kind: wire.kind,
    defaultValue: wire.default_value,
    envKey: wire.env_key,
    min: wire.min,
    max: wire.max,
    value: wire.value,
    source: wire.source,
  }
}

function mapCacheEntry(wire: WireCacheEntry): AdminServerCacheEntry {
  return { key: wire.key, text: wire.text, voice: wire.voice, savedAt: wire.saved_at, bytes: wire.bytes }
}

export async function adminLogin(username: string, password: string, rememberMe = false): Promise<void> {
  await send<{ ok: boolean }>(`/login`, 'POST', { username, password, remember_me: rememberMe })
}

export async function fetchAdminSession(): Promise<AdminSessionInfo> {
  return get<AdminSessionInfo>(`/session`)
}

export async function adminLogout(): Promise<void> {
  await send<{ ok: boolean }>(`/logout`, 'POST', {})
}

export async function fetchAdminProperties(): Promise<AdminProperty[]> {
  const body = await get<{ properties: WireProperty[] }>(`/properties`)
  return body.properties.map(mapProperty)
}

export async function updateAdminProperties(properties: Array<{ key: string; value: number | null }>): Promise<AdminProperty[]> {
  const body = await send<{ properties: WireProperty[] }>(`/properties`, 'PUT', { properties })
  return body.properties.map(mapProperty)
}

export async function resetAdminProperty(key: string): Promise<AdminProperty[]> {
  return updateAdminProperties([{ key, value: null }])
}

export async function fetchAdminServerCache(): Promise<{ stats: AdminServerCacheStats; entries: AdminServerCacheEntry[] }> {
  const body = await get<{ stats: AdminServerCacheStats; entries: WireCacheEntry[] }>(`/synthesis-cache`)
  return { stats: body.stats, entries: body.entries.map(mapCacheEntry) }
}

export async function fetchAdminServerCacheAudio(key: string): Promise<{ audio: string; etag: string }> {
  return get<{ audio: string; etag: string }>(`/synthesis-cache/audio?key=${encodeURIComponent(key)}`)
}

export async function clearAdminServerCache(keys?: string[]): Promise<{
  stats: AdminServerCacheStats
  entries: AdminServerCacheEntry[]
}> {
  const body = await send<{ stats: AdminServerCacheStats; entries: WireCacheEntry[] }>(
    `/synthesis-cache`,
    'DELETE',
    keys === undefined ? {} : { keys },
  )
  return { stats: body.stats, entries: body.entries.map(mapCacheEntry) }
}
