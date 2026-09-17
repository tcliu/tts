import {
  AdminAuthError,
  adminErrorCode,
  fetchAdminProperties,
  resetAdminProperty,
  updateAdminProperties,
  type AdminProperty,
} from '$lib/admin-client'
import type { MessageKey, TtsI18n } from '$lib/i18n.svelte'

export function useAdminProperties(onSignedOut: () => void) {
  let properties = $state<AdminProperty[]>([])
  let draftValues = $state<Record<string, string>>({})
  let pending = $state(false)
  let loadError = $state('')

  function hasDraftValue(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(draftValues, key)
  }

  const hasUnsavedChanges = $derived(
    properties.some(property => hasDraftValue(property.key) && draftValues[property.key] !== String(property.value)),
  )

  function handleAuthError(error: unknown): boolean {
    if (error instanceof AdminAuthError) {
      onSignedOut()
      return true
    }
    return false
  }

  function validateDraft(
    property: AdminProperty,
    raw: string,
    i18n: TtsI18n,
  ): { ok: true; value: number } | { ok: false; error: string } {
    // Label keys arrive as wire data; fall back to the property key when the
    // server sends a key with no dictionary entry (t returns the key itself).
    const labelKey = property.labelKey
    const labelMessage = i18n.t(labelKey as MessageKey)
    const label = labelMessage === labelKey ? property.key : labelMessage
    const parsed = Number(raw.trim())
    if (!Number.isInteger(parsed)) {
      return { ok: false, error: `${label}: ${i18n.t('admin.propNotInteger')}` }
    }
    if (parsed < (property.min ?? Number.NEGATIVE_INFINITY) || parsed > (property.max ?? Number.POSITIVE_INFINITY)) {
      return {
        ok: false,
        error: `${label}: ${i18n.t('admin.propOutOfRange', { min: String(property.min ?? 0), max: String(property.max ?? Number.MAX_SAFE_INTEGER) })}`,
      }
    }
    return { ok: true, value: parsed }
  }


  async function load(): Promise<boolean> {
    try {
      const loaded = await fetchAdminProperties()
      properties = loaded
      draftValues = Object.fromEntries(loaded.map(property => [property.key, String(property.value)]))
      loadError = ''
      return true
    } catch (error) {
      if (!handleAuthError(error)) {
        loadError = adminErrorCode(error)
      }
      return false
    }
  }

  function apply(i18n: TtsI18n): string | null {
    if (pending) return null
    const changed = properties.filter(
      property => hasDraftValue(property.key) && draftValues[property.key] !== String(property.value),
    )
    if (changed.length === 0) {
      return null
    }
    const payload: Array<{ key: string; value: number | null }> = []
    for (const property of changed) {
      const validated = validateDraft(property, draftValues[property.key] ?? '', i18n)
      if (!validated.ok) {
        return validated.error
      }
      payload.push({ key: property.key, value: validated.value })
    }
    pending = true
    void updateAdminProperties(payload)
      .then(updated => {
        properties = updated
        draftValues = Object.fromEntries(updated.map(property => [property.key, String(property.value)]))
      })
      .catch(error => {
        if (!handleAuthError(error)) {
          loadError = adminErrorCode(error)
        }
      })
      .finally(() => {
        pending = false
      })
    return null
  }

  async function reload() {
    if (pending) return
    pending = true
    try {
      await load()
    } finally {
      pending = false
    }
  }

  function resetDraft() {
    draftValues = Object.fromEntries(properties.map(property => [property.key, String(property.value)]))
  }

  function reset() {
    properties = []
    draftValues = {}
    loadError = ''
    pending = false
  }

  async function resetProperty(property: AdminProperty): Promise<string | null> {
    if (pending) return null
    pending = true
    try {
      const updated = await resetAdminProperty(property.key)
      properties = updated
      draftValues = Object.fromEntries(updated.map(item => [item.key, String(item.value)]))
      return null
    } catch (error) {
      if (handleAuthError(error)) return null
      return adminErrorCode(error)
    } finally {
      pending = false
    }
  }

  return {
    get properties() {
      return properties
    },
    get draftValues() {
      return draftValues
    },
    get pending() {
      return pending
    },
    get loadError() {
      return loadError
    },
    get hasUnsavedChanges() {
      return hasUnsavedChanges
    },
    setDraftValue(key: string, value: string) {
      draftValues = { ...draftValues, [key]: value }
    },
    load,
    apply,
    reload,
    resetDraft,
    reset,
    resetProperty,
  }
}
