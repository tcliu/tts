import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Theme IDs are enumerated in stringly-typed sync points that the compiler
// cannot fully cross-check: the pre-paint allowlist in app.html, the stored-
// value validation in use-settings, the per-theme palette overrides in
// styles.css, and the header menu's option list. This test fails when any of
// them drifts away from the UiTheme union.
const settingsSource = readFileSync('src/lib/use-settings.svelte.ts', 'utf-8')
const appHtml = readFileSync('src/app.html', 'utf-8')
const styles = readFileSync('src/styles.css', 'utf-8')
const pageSource = readFileSync('src/routes/[[docId]]/+page.svelte', 'utf-8')

function uiThemeUnion(): string[] {
  const marker = 'export type UiTheme = '
  const start = settingsSource.indexOf(marker)
  expect(start, 'the UiTheme union declaration must stay findable').toBeGreaterThanOrEqual(0)
  const rest = settingsSource.slice(start + marker.length)
  // The declaration ends at a semicolon, a blank line, or both, so the scrape
  // survives one-line, multi-line piped, and semicolon-terminated styles.
  const ends = [';', '\n\n'].map(token => {
    const at = rest.indexOf(token)
    return at === -1 ? Number.POSITIVE_INFINITY : at
  })
  const declaration = rest.slice(0, Math.min(...ends))
  expect(declaration.trim().length, 'the UiTheme union must not be empty').toBeGreaterThan(0)
  return [...declaration.matchAll(/'([\w-]+)'/g)].map(entry => entry[1])
}

describe('theme id parity across sync points', () => {
  const themes = uiThemeUnion()

  it('keeps dark as the default palette', () => {
    expect(themes[0]).toBe('dark')
  })

  it('allowlists every non-default theme in the app.html pre-paint script', () => {
    const arrayMatch = appHtml.match(/var themes = \[([^\]]+)\]/)
    const allowed = new Set(
      arrayMatch ? [...arrayMatch[1].matchAll(/'([a-z]+)'/g)].map(entry => entry[1]) : [...appHtml.matchAll(/stored === '([a-z]+)'/g)].map(entry => entry[1]),
    )
    for (const theme of themes) {
      if (theme === 'dark') {
        expect(allowed.has(theme), 'dark is the no-attribute default').toBe(false)
      } else {
        expect(allowed.has(theme), `${theme} missing from app.html`).toBe(true)
      }
    }
    expect(allowed.size).toBe(themes.length - 1)
  })

  it('validates every theme when hydrating stored settings', () => {
    const validated = new Set(
      [...settingsSource.matchAll(/parsed\.theme === '([a-z]+)'/g)].map(entry => entry[1]),
    )
    for (const theme of themes) {
      expect(validated.has(theme), `${theme} missing from hydrate validation`).toBe(true)
    }
    expect(validated.size).toBe(themes.length)
  })

  it('declares palette overrides for every non-default theme in styles.css', () => {
    const blocks = new Set([...styles.matchAll(/\[data-theme='([a-z]+)'\]/g)].map(entry => entry[1]))
    for (const theme of themes) {
      if (theme === 'dark') {
        expect(blocks.has(theme), 'dark is the un-overridden palette').toBe(false)
      } else {
        expect(blocks.has(theme), `${theme} has no [data-theme] block in styles.css`).toBe(true)
      }
    }
    expect(blocks.size).toBe(themes.length - 1)
  })

  it('offers every theme in the header menu options', () => {
    const options = new Set(
      [...pageSource.matchAll(/\{ value: '([a-z]+)' \},/g)].map(entry => entry[1]),
    )
    for (const theme of themes) {
      expect(options.has(theme), `${theme} missing from THEME_MENU_OPTIONS`).toBe(true)
    }
    expect(options.size).toBe(themes.length)
  })
})
