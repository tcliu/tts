import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSettingsHost } from '../test/create-settings.svelte'
import { SPEEDS } from './tts-reference'

describe('useSettings persistence', () => {
  afterEach(() => {
    localStorage.clear()
    vi.useRealTimers()
  })

  it('persists changed settings and restores them after a reload', async () => {
    vi.useFakeTimers()

    // Mirror the app's startup order: the hook's effects flush during mount
    // (before onMount), then hydrate() runs from onMount.
    const first = createSettingsHost()
    await Promise.resolve()
    first.settings.hydrate()
    first.settings.setLocale('zh-TW')
    first.settings.setSpeed(1.5)
    first.settings.content = 'hello world'
    await vi.advanceTimersByTimeAsync(500)

    const saved = JSON.parse(localStorage.getItem('tts:web-settings') ?? 'null') as {
      locale?: string
      speed?: number
      content?: string
    } | null
    expect(saved?.locale).toBe('zh-TW')
    expect(saved?.speed).toBe(1.5)
    expect(saved?.content).toBe('hello world')
    first.dispose()

    const second = createSettingsHost()
    second.settings.hydrate()
    expect(second.settings.locale).toBe('zh-TW')
    expect(second.settings.speed).toBe(1.5)
    expect(second.settings.content).toBe('hello world')
    second.dispose()
  })

  it('rejects out-of-range speed and concurrency values when hydrating', async () => {
    localStorage.setItem(
      'tts:web-settings',
      JSON.stringify({ speed: 3, synthesisConcurrency: 99, locale: 'zh-CN' }),
    )

    const { settings, dispose } = createSettingsHost()
    settings.hydrate()
    expect(settings.speed).toBe(1)
    expect(SPEEDS).toContain(settings.speed)
    expect(settings.synthesisConcurrency).toBe(4)
    expect(settings.locale).toBe('zh-CN')
    dispose()
  })
})
