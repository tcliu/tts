import { describe, expect, it } from 'vitest'
import {
  APP_SHELL_DEFAULT_WIDTH,
  APP_SHELL_MAX_WIDTH,
  APP_SHELL_MIN_WIDTH,
  APP_SHELL_RAIL_WIDTH,
  clampPaneWidth,
  collapsesToRail,
  loadPaneSize,
  savePaneSize,
} from './app-shell'

describe('clampPaneWidth', () => {
  it('rounds and clamps into range', () => {
    expect(clampPaneWidth(200.6, APP_SHELL_MIN_WIDTH, APP_SHELL_MAX_WIDTH, APP_SHELL_DEFAULT_WIDTH)).toBe(201)
    expect(clampPaneWidth(50, APP_SHELL_MIN_WIDTH, APP_SHELL_MAX_WIDTH, APP_SHELL_DEFAULT_WIDTH)).toBe(
      APP_SHELL_MIN_WIDTH,
    )
    expect(clampPaneWidth(900, APP_SHELL_MIN_WIDTH, APP_SHELL_MAX_WIDTH, APP_SHELL_DEFAULT_WIDTH)).toBe(
      APP_SHELL_MAX_WIDTH,
    )
  })

  it('falls back on non-finite input', () => {
    expect(clampPaneWidth(Number.NaN, APP_SHELL_MIN_WIDTH, APP_SHELL_MAX_WIDTH, APP_SHELL_DEFAULT_WIDTH)).toBe(
      APP_SHELL_DEFAULT_WIDTH,
    )
  })
})

describe('collapsesToRail', () => {
  it('collapses at or below the rail width', () => {
    expect(collapsesToRail(APP_SHELL_RAIL_WIDTH, APP_SHELL_RAIL_WIDTH)).toBe(true)
    expect(collapsesToRail(APP_SHELL_RAIL_WIDTH + 1, APP_SHELL_RAIL_WIDTH)).toBe(false)
  })
})

describe('pane persistence without a storage key', () => {
  it('loads the fallback and never touches storage', () => {
    expect(loadPaneSize(undefined, APP_SHELL_DEFAULT_WIDTH, APP_SHELL_MIN_WIDTH, APP_SHELL_MAX_WIDTH)).toBe(
      APP_SHELL_DEFAULT_WIDTH,
    )
  })

  it('saves as a no-op without a storage key', () => {
    expect(() => savePaneSize(undefined, 300)).not.toThrow()
  })
})
