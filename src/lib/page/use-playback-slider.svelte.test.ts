import { describe, expect, it, vi } from 'vitest'
import { usePlaybackSlider } from './use-playback-slider.svelte'

function createSlider(overrides: Partial<Parameters<typeof usePlaybackSlider>[0]> = {}) {
  const deps = {
    getTotalDuration: () => 100,
    getTotalElapsed: () => 30,
    getIsPlaybackEnded: () => false,
    ...overrides,
  }
  return usePlaybackSlider(deps)
}

function realInputEvent(value: string): Event {
  const input = document.createElement('input')
  input.value = value
  const event = new Event('input')
  Object.defineProperty(event, 'currentTarget', { value: input })
  return event
}

describe('usePlaybackSlider', () => {
  it('reports max as the larger of duration and elapsed', () => {
    const slider = createSlider({ getTotalDuration: () => 100, getTotalElapsed: () => 30 })
    expect(slider.max).toBe(100)
  })

  it('clamps the value when elapsed exceeds duration', () => {
    const slider = createSlider({ getTotalDuration: () => 50, getTotalElapsed: () => 80 })
    expect(slider.max).toBe(80)
    expect(slider.displayValue).toBe(80)
  })

  it('shows the full duration when playback has ended', () => {
    const slider = createSlider({ getTotalDuration: () => 100, getTotalElapsed: () => 60, getIsPlaybackEnded: () => true })
    expect(slider.displayValue).toBe(100)
  })

  it('shows elapsed while playback is active', () => {
    const slider = createSlider({ getTotalDuration: () => 100, getTotalElapsed: () => 30 })
    expect(slider.displayValue).toBe(30)
  })

  it('computes progress as a clamped percentage', () => {
    const slider = createSlider({ getTotalDuration: () => 100, getTotalElapsed: () => 25 })
    expect(slider.progress).toBe(25)
  })

  it('reports zero progress when there is nothing to play', () => {
    const slider = createSlider({ getTotalDuration: () => 0, getTotalElapsed: () => 0 })
    expect(slider.max).toBe(0)
    expect(slider.progress).toBe(0)
  })

  it('holds the draft value during scrubbing instead of the computed value', () => {
    const slider = createSlider({ getTotalDuration: () => 100, getTotalElapsed: () => 30 })
    slider.handleInput(realInputEvent('70'))
    expect(slider.displayValue).toBe(70)
    expect(slider.progress).toBe(70)
  })

  it('seeks to the committed value and clears the draft', async () => {
    const slider = createSlider({ getTotalDuration: () => 100, getTotalElapsed: () => 30 })
    const seekTo = vi.fn(async (_elapsed: number) => {})
    slider.handleInput(realInputEvent('70'))
    expect(slider.displayValue).toBe(70)
    await slider.commit(realInputEvent('70'), seekTo)
    expect(seekTo).toHaveBeenCalledOnce()
    expect(seekTo).toHaveBeenCalledWith(70)
    expect(slider.displayValue).toBe(30)
  })

  it('ignores non-input commit targets', async () => {
    const slider = createSlider()
    const seekTo = vi.fn(async (_elapsed: number) => {})
    await slider.commit(new Event('change'), seekTo)
    expect(seekTo).not.toHaveBeenCalled()
  })
})
