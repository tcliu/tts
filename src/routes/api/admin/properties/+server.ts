import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { isAdminSession } from '$lib/server/admin-auth'
import {
  assertKnownPropertyKey,
  listProperties,
  PropertyValidationError,
  setPropertyValues,
  validatePropertyValue,
} from '$lib/server/admin-properties'
import { getRequestIp, logEvent } from '$lib/server/logging'

function toWire(properties: ReturnType<typeof listProperties>) {
  return {
    properties: properties.map(property => ({
      key: property.key,
      label_key: property.labelKey,
      description_key: property.descriptionKey,
      kind: 'number' as const,
      default_value: property.defaultValue,
      env_key: property.envKey,
      min: property.min,
      max: property.max,
      value: property.value,
      source: property.source,
    })),
  }
}

export const GET: RequestHandler = async ({ cookies }) => {
  if (!isAdminSession({ cookies })) {
    return json({ error: 'session_required' }, { status: 401 })
  }
  return json(toWire(listProperties()))
}

export const PUT: RequestHandler = async event => {
  const { cookies, request } = event
  if (!isAdminSession({ cookies })) {
    return json({ error: 'session_required' }, { status: 401 })
  }
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || !Array.isArray((body as { properties?: unknown }).properties)) {
    return json({ error: 'invalid_request' }, { status: 400 })
  }

  const before = new Map(listProperties().map(property => [property.key, property.value]))
  const updates: Array<{ key: string; value: number | null }> = []
  for (const item of (body as { properties: unknown[] }).properties) {
    if (!item || typeof item !== 'object' || typeof (item as { key?: unknown }).key !== 'string') {
      return json({ error: 'invalid_property', key: null, reason: 'key' }, { status: 400 })
    }
    const record = item as { key: string; value?: unknown }
    if (record.value === null || record.value === undefined) {
      try {
        assertKnownPropertyKey(record.key)
        updates.push({ key: record.key, value: null })
      } catch {
        return json({ error: 'invalid_property', key: record.key, reason: 'unknown' }, { status: 400 })
      }
      continue
    }
    try {
      updates.push({ key: record.key, value: validatePropertyValue(record.key, record.value) })
    } catch (error) {
      const reason = error instanceof PropertyValidationError ? error.reason : 'unknown'
      const key = error instanceof PropertyValidationError ? error.propertyKey : record.key
      return json({ error: 'invalid_property', key, reason }, { status: 400 })
    }
  }

  const startedAt = Date.now()
  const ip = getRequestIp(event)
  const keys = updates.map(update => update.key)
  logEvent({ ip, action: 'admin_properties_update_start', details: { keys } })
  const after = await setPropertyValues(updates)
  logEvent({
    ip,
    action: 'admin_properties_update_end',
    details: {
      keys,
      old_values: keys.map(key => before.get(key) ?? null),
      new_values: keys.map(key => after.find(property => property.key === key)?.value ?? null),
      elapsed_ms: Date.now() - startedAt,
    },
  })

  return json(toWire(after))
}
