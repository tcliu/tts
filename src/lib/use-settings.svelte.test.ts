import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSettingsHost } from '../test/create-settings.svelte'
import { SPEEDS } from './tts-reference'

describe('useSettings persistence', () => {
  afterEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
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

  it('defaults the theme to dark and persists a changed theme across reloads', async () => {
    vi.useFakeTimers()

    const first = createSettingsHost()
    await Promise.resolve()
    first.settings.hydrate()
    expect(first.settings.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBeUndefined()
    first.settings.setTheme('ember')
    await vi.advanceTimersByTimeAsync(500)
    expect(document.documentElement.dataset.theme).toBe('ember')

    const saved = JSON.parse(localStorage.getItem('tts:web-settings') ?? 'null') as {
      theme?: string
    } | null
    expect(saved?.theme).toBe('ember')
    first.dispose()

    const second = createSettingsHost()
    second.settings.hydrate()
    expect(second.settings.theme).toBe('ember')
    second.dispose()
  })

  it('applies and clears the data-theme attribute when switching themes', async () => {
    const { settings, dispose } = createSettingsHost()
    settings.hydrate()
    for (const theme of ['light', 'ember', 'sepia', 'nebula', 'sky'] as const) {
      settings.setTheme(theme)
      await Promise.resolve()
      expect(document.documentElement.dataset.theme).toBe(theme)
    }
    settings.setTheme('dark')
    await Promise.resolve()
    expect(document.documentElement.dataset.theme).toBeUndefined()
    dispose()
  })

  it('falls back to dark when the stored theme is invalid', async () => {
    localStorage.setItem('tts:web-settings', JSON.stringify({ theme: 'blue' }))

    const { settings, dispose } = createSettingsHost()
    settings.hydrate()
    expect(settings.theme).toBe('dark')
    dispose()
  })
})
