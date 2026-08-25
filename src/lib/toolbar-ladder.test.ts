import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REVEAL_CLASS, TOOLBAR_BANDS, menuFor, type PanelAction, type ToolbarMode } from './toolbar-ladder'

const ALL: Record<ToolbarMode, PanelAction[]> = {
  doc: ['reset', 'save', 'delete', 'info', 'copy', 'clone', 'upload'],
  fresh: ['reset', 'save', 'info', 'copy', 'upload'],
}

// Expected menus per band, in TOOLBAR_BANDS order. The final entry is empty
// because every action is inline; the first equals the full set because the
// compact band reveals nothing.
const EXPECTED_MENUS: Record<ToolbarMode, PanelAction[][]> = {
  doc: [
    ['reset', 'save', 'delete', 'info', 'copy', 'clone', 'upload'],
    ['delete', 'info', 'copy', 'clone', 'upload'],
    ['delete', 'info', 'clone', 'upload'],
    ['info', 'clone', 'upload'],
    ['clone', 'upload'],
    [],
  ],
  fresh: [
    ['reset', 'save', 'info', 'copy', 'upload'],
    ['info', 'copy', 'upload'],
    ['info', 'upload'],
    ['upload'],
    [],
    [],
  ],
}

describe('toolbar ladder derivation', () => {
  for (const mode of ['doc', 'fresh'] as const) {
    it(`matches the expected per-band menus (${mode})`, () => {
      TOOLBAR_BANDS.forEach((band, i) => {
        expect(menuFor(band.name, mode), `band ${band.name}`).toEqual(EXPECTED_MENUS[mode][i])
      })
    })

    it(`reveals actions monotonically and loses none (${mode})`, () => {
      let previousLength = Infinity
      const seen = new Set<string>()
      for (const band of TOOLBAR_BANDS) {
        const menu = menuFor(band.name, mode)
        // The menu shrinks strictly as bands widen until it empties, nothing
        // already inline returns to it, and no action ever disappears
        // entirely (the Copy-drop regression class).
        if (previousLength > 0) {
          expect(menu.length, `band ${band.name}`).toBeLessThan(previousLength)
        } else {
          expect(menu, `band ${band.name}`).toEqual([])
        }
        expect(menu.every(action => !seen.has(action)), `band ${band.name}`).toBe(true)
        for (const action of ALL[mode]) {
          if (!menu.includes(action)) seen.add(action)
        }
        previousLength = menu.length
      }
      expect(menuFor('full', mode)).toEqual([])
      expect(seen).toEqual(new Set(ALL[mode]))
    })
  }

  it('throws on an unknown band', () => {
    expect(() => menuFor('nope' as never, 'doc')).toThrow()
  })
})

// The reveal classes are chosen at runtime between closed literal sets, so
// Tailwind only emits them if the literals stay verbatim in this module and
// their @tokens keep a --container-* definition in styles.css.
describe('toolbar ladder tailwind contract', () => {
  const module = readFileSync('src/lib/toolbar-ladder.ts', 'utf-8')
  const styles = readFileSync('src/styles.css', 'utf-8')

  function collectLiterals(node: unknown): string[] {
    if (typeof node === 'string') return [node]
    if (Array.isArray(node)) return node.flatMap(collectLiterals)
    if (node && typeof node === 'object') return Object.values(node).flatMap(collectLiterals)
    return []
  }

  it('keeps a definition for every referenced container variant', () => {
    // Tailwind's built-in container scale; anything outside it must be
    // defined explicitly in styles.css.
    const defaultScale = ['3xs', '2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl']
    const variants = [...module.matchAll(/@([a-z0-9-]+):/g)].map(match => match[1])
    expect(variants.length).toBeGreaterThan(0)
    for (const variant of new Set(variants)) {
      if (defaultScale.includes(variant)) continue
      expect(styles, `--container-${variant} missing from styles.css`).toMatch(
        new RegExp(`--container-${variant}\\s*:`),
      )
    }
  })

  it('declares every reveal and menu class as a source literal', () => {
    const literals = collectLiterals(REVEAL_CLASS).concat(TOOLBAR_BANDS.map(band => band.menuClass)).filter(Boolean)
    expect(literals.length).toBeGreaterThanOrEqual(TOOLBAR_BANDS.length)
    for (const literal of literals) {
      expect(module, `literal not found in toolbar-ladder.ts: ${literal}`).toContain(literal)
    }
  })
})
