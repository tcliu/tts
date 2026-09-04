import { mkdirSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type PropertySource = 'file' | 'environment' | 'default'

export interface PropertyDefinition {
  key: string
  labelKey: string
  descriptionKey: string
  envKey: string
  defaultValue: number
  min: number
  max: number
}

export interface AdminProperty extends PropertyDefinition {
  value: number
  source: PropertySource
}

export const PROPERTY_DEFINITIONS: PropertyDefinition[] = [
  {
    key: 'tts_rate_limit_max',
    labelKey: 'adminPropRateLimitMaxLabel',
    descriptionKey: 'adminPropRateLimitMaxDesc',
    envKey: 'TTS_RATE_LIMIT_MAX',
    defaultValue: 60,
    min: 1,
    max: 10000,
  },
  {
    key: 'tts_max_text_length',
    labelKey: 'adminPropMaxTextLengthLabel',
    descriptionKey: 'adminPropMaxTextLengthDesc',
    envKey: 'TTS_MAX_TEXT_LENGTH',
    defaultValue: 2000,
    min: 1,
    max: 10000,
  },
  {
    key: 'tts_cache_ttl_ms',
    labelKey: 'adminPropCacheTtlLabel',
    descriptionKey: 'adminPropCacheTtlDesc',
    envKey: 'TTS_CACHE_TTL_MS',
    defaultValue: 7 * 24 * 60 * 60 * 1000,
    min: 60 * 1000,
    max: 365 * 24 * 60 * 60 * 1000,
  },
  {
    key: 'tts_cache_max_entries',
    labelKey: 'adminPropCacheMaxEntriesLabel',
    descriptionKey: 'adminPropCacheMaxEntriesDesc',
    envKey: 'TTS_CACHE_MAX_ENTRIES',
    defaultValue: 500,
    min: 1,
    max: 100000,
  },
  {
    key: 'tts_cache_max_bytes',
    labelKey: 'adminPropCacheMaxBytesLabel',
    descriptionKey: 'adminPropCacheMaxBytesDesc',
    envKey: 'TTS_CACHE_MAX_BYTES',
    defaultValue: 200 * 1024 * 1024,
    min: 1024 * 1024,
    max: 10 * 1024 * 1024 * 1024,
  },
  {
    key: 'edge_tts_timeout_ms',
    labelKey: 'adminPropEdgeTtsTimeoutLabel',
    descriptionKey: 'adminPropEdgeTtsTimeoutDesc',
    envKey: 'EDGE_TTS_TIMEOUT_MS',
    defaultValue: 30_000,
    min: 1000,
    max: 120_000,
  },
]

function getDefinition(key: string): PropertyDefinition | undefined {
  return PROPERTY_DEFINITIONS.find(definition => definition.key === key)
}

export function assertKnownPropertyKey(key: string): PropertyDefinition {
  const definition = getDefinition(key)
  if (!definition) {
    throw new Error(`Unknown property: ${key}`)
  }
  return definition
}

function propertiesFile(): string {
  const override = (process.env.TTS_PROPERTIES_FILE || '').trim()
  if (override) return override
  if (process.env.VERCEL === '1') return path.resolve('/tmp', '.data', 'admin-properties.json')
  return path.resolve(process.cwd(), '.data', 'admin-properties.json')
}

// Hot synthesis-path getters (`rate-limit`, `edge-tts`, `tts-cache`) read through
// this cache, so keep the window generous: a sync `readFileSync` happens at
// most once per window per process, and `setPropertyValues` invalidates it.
const FILE_CACHE_TTL_MS = 30_000
let fileCache: { values: Record<string, unknown>; expiresAt: number } | null = null

function readFileValues(): Record<string, unknown> {
  const now = Date.now()
  if (fileCache && now < fileCache.expiresAt) {
    return fileCache.values
  }
  let values: Record<string, unknown> = {}
  try {
    const raw = readFileSync(propertiesFile(), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      values = parsed as Record<string, unknown>
    }
  } catch {
    values = {}
  }
  fileCache = { values, expiresAt: now + FILE_CACHE_TTL_MS }
  return values
}

function readNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function isInRange(definition: PropertyDefinition, value: number): boolean {
  return Number.isInteger(value) && value >= definition.min && value <= definition.max
}

function effectiveValue(definition: PropertyDefinition): { value: number; source: PropertySource } {
  const stored = readFileValues()[definition.key]
  if (typeof stored === 'number' && isInRange(definition, stored)) {
    return { value: stored, source: 'file' }
  }
  const envValue = readNumber(process.env[definition.envKey])
  if (envValue !== null && isInRange(definition, envValue)) {
    return { value: envValue, source: 'environment' }
  }
  return { value: definition.defaultValue, source: 'default' }
}

function getValue(key: string): number {
  return effectiveValue(assertKnownPropertyKey(key)).value
}

export function listProperties(): AdminProperty[] {
  return PROPERTY_DEFINITIONS.map(definition => ({ ...definition, ...effectiveValue(definition) }))
}

export type PropertyValidationReason = 'unknown' | 'integer' | 'range'

export class PropertyValidationError extends Error {
  readonly reason: PropertyValidationReason
  readonly propertyKey: string
  constructor(reason: PropertyValidationReason, propertyKey: string) {
    super(reason === 'unknown' ? `Unknown property: ${propertyKey}` : reason)
    this.name = 'PropertyValidationError'
    this.reason = reason
    this.propertyKey = propertyKey
  }
}

export function validatePropertyValue(key: string, value: unknown): number {
  const definition = getDefinition(key)
  if (!definition) {
    throw new PropertyValidationError('unknown', key)
  }
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
  if (!Number.isInteger(parsed)) {
    throw new PropertyValidationError('integer', key)
  }
  if (parsed < definition.min || parsed > definition.max) {
    throw new PropertyValidationError('range', key)
  }
  return parsed
}

export async function setPropertyValues(updates: Array<{ key: string; value: number | null }>): Promise<AdminProperty[]> {
  const current = { ...readFileValues() }
  for (const update of updates) {
    assertKnownPropertyKey(update.key)
    if (update.value === null) {
      delete current[update.key]
    } else {
      current[update.key] = update.value
    }
  }
  const file = propertiesFile()
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(current, null, 2), 'utf-8')
  fileCache = null
  return listProperties()
}

export async function deletePropertyValue(key: string): Promise<AdminProperty[]> {
  return setPropertyValues([{ key, value: null }])
}

export function resetPropertiesCache(): void {
  fileCache = null
}

export function getRateLimitMax(): number {
  return getValue('tts_rate_limit_max')
}

export function getMaxTextLength(): number {
  return getValue('tts_max_text_length')
}

export function getCacheTtlMs(): number {
  return getValue('tts_cache_ttl_ms')
}

export function getCacheMaxEntries(): number {
  return getValue('tts_cache_max_entries')
}

export function getCacheMaxBytes(): number {
  return getValue('tts_cache_max_bytes')
}

export function getEdgeTtsTimeoutMs(): number {
  return getValue('edge_tts_timeout_ms')
}

export function ensureDataDirSync(): void {
  mkdirSync(path.dirname(propertiesFile()), { recursive: true })
}
