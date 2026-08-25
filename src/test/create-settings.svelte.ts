import { useSettings, type SettingsHandle } from '$lib/use-settings.svelte'

export function createSettingsHost(): { settings: SettingsHandle; dispose: () => void } {
  let handle: SettingsHandle | null = null
  const dispose = $effect.root(() => {
    handle = useSettings()
  })
  if (!handle) {
    throw new Error('settings handle was not created')
  }
  return { settings: handle, dispose }
}
