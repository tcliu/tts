import { createTtsI18n } from '$lib/i18n.svelte'
import { useSettings, type SettingsHandle } from '$lib/use-settings.svelte'

export function createSettingsHost(): { settings: SettingsHandle; dispose: () => void } {
  // Fresh store per host: $effect.root runs outside component initialisation
  // where getContext is unavailable, so inject the store explicitly instead
  // of resolving the layout's context. Each test hydrates and mutates its own
  // locale with no cross-test leakage.
  const i18n = createTtsI18n()
  let handle: SettingsHandle | null = null
  const dispose = $effect.root(() => {
    handle = useSettings(i18n)
  })
  if (!handle) {
    throw new Error('settings handle was not created')
  }
  return { settings: handle, dispose }
}
