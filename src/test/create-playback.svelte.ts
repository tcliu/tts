import { usePlayback, type PlaybackDeps, type PlaybackHandle } from '$lib/use-playback.svelte'

export function createPlaybackHost(
  deps: PlaybackDeps,
): { playback: PlaybackHandle; dispose: () => void } {
  let handle: PlaybackHandle | null = null
  const dispose = $effect.root(() => {
    handle = usePlayback(deps)
  })
  if (!handle) {
    throw new Error('playback handle was not created')
  }
  return { playback: handle, dispose }
}
