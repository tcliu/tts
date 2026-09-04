/**
 * Playback slider state: draft value during scrubbing, display value (draft or
 * computed), and progress percentage. The draft lets the user drag without
 * seeking until they release.
 */
export function usePlaybackSlider(deps: {
  getTotalDuration: () => number
  getTotalElapsed: () => number
  getIsPlaybackEnded: () => boolean
}) {
  const { getTotalDuration, getTotalElapsed, getIsPlaybackEnded } = deps
  let playbackSliderDraft = $state<string | null>(null)

  const playbackSliderMax = $derived(Math.max(getTotalDuration(), getTotalElapsed(), 0))
  const playbackSliderValue = $derived(
    getIsPlaybackEnded() ? getTotalDuration() : Math.min(getTotalElapsed(), playbackSliderMax),
  )
  const playbackSliderDisplayValue = $derived(
    playbackSliderDraft === null ? playbackSliderValue : Number(playbackSliderDraft),
  )
  const playbackSliderProgress = $derived(
    playbackSliderMax > 0 ? Math.min(100, Math.max(0, (playbackSliderDisplayValue / playbackSliderMax) * 100)) : 0,
  )

  return {
    get max() {
      return playbackSliderMax
    },
    get displayValue() {
      return playbackSliderDisplayValue
    },
    get progress() {
      return playbackSliderProgress
    },
    handleInput(event: Event) {
      const target = event.currentTarget
      if (target instanceof HTMLInputElement) playbackSliderDraft = target.value
    },
    async commit(event: Event, seekTo: (elapsed: number) => Promise<void>) {
      const target = event.currentTarget
      if (!(target instanceof HTMLInputElement)) {
        playbackSliderDraft = null
        return
      }
      playbackSliderDraft = null
      await seekTo(Number(target.value))
    },
  }
}
