import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REVEAL_CLASS, TOOLBAR_BANDS, menuFor, type PanelAction, type ToolbarMode } from './toolbar-ladder'

const ALL: Record<ToolbarMode, PanelAction[]> = {
  doc: ['play', 'reset', 'save', 'delete', 'info', 'copy', 'clone', 'upload'],
  fresh: ['play', 'reset', 'save', 'info', 'copy', 'upload'],
}

// Expected menus per band, in TOOLBAR_BANDS order. The final entry is empty
// because every action is inline; the first equals the full set because the
// tiny band reveals nothing.
const EXPECTED_MENUS: Record<ToolbarMode, PanelAction[][]> = {
  doc: [
    ['play', 'reset', 'save', 'delete', 'info', 'copy', 'clone', 'upload'],
    ['reset', 'save', 'delete', 'info', 'copy', 'clone', 'upload'],
    ['reset', 'delete', 'info', 'copy', 'clone', 'upload'],
    ['delete', 'info', 'copy', 'clone', 'upload'],
    ['delete', 'copy', 'clone', 'upload'],
    ['delete', 'clone', 'upload'],
    ['clone', 'upload'],
    [],
    [],
  ],
  fresh: [
    ['play', 'reset', 'save', 'info', 'copy', 'upload'],
    ['reset', 'save', 'info', 'copy', 'upload'],
    ['reset', 'info', 'copy', 'upload'],
    ['info', 'copy', 'upload'],
    ['copy', 'upload'],
    ['upload'],
    [],
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

// The pairing rule documented on TOOLBAR_BANDS: an action must go inline at
// exactly the variant where its assigned band's width range begins. Both sides
// are derived from the public tables, so drift fails here instead of leaving a
// width interval where a control is neither inline nor in the overflow menu.
describe('toolbar ladder reveal/band pairing', () => {
  /** Lower-bound variant per band index; inherited from the prior band's close. */
  function bandLowerBounds(): (string | null)[] {
    let inherited: string | null = null
    return TOOLBAR_BANDS.map(band => {
      const open = band.menuClass.match(/@([a-z0-9-]+):inline-flex/)
      const close = [...band.menuClass.matchAll(/@([a-z0-9-]+):hidden/g)].pop()
      const lower = open ? open[1] : inherited
      if (close) {
        inherited = close[1]
      }
      return lower ?? null
    })
  }

  function revealVariants(cls: string): string[] {
    return [...cls.matchAll(/@([a-z0-9-]+):inline-flex/g)].map(match => match[1])
  }

  function revealClass(action: PanelAction, mode: ToolbarMode): string {
    const entry = REVEAL_CLASS[action]
    return typeof entry === 'string' ? entry : entry[mode]
  }

  function allRevealClasses(node: unknown): string[] {
    if (typeof node === 'string') return node.includes('@') ? [node] : []
    if (Array.isArray(node)) return node.flatMap(allRevealClasses)
    if (node && typeof node === 'object') return Object.values(node).flatMap(allRevealClasses)
    return []
  }

  it('pairs every reveal threshold with its band lower bound', () => {
    const bounds = bandLowerBounds()
    for (const mode of ['doc', 'fresh'] as const) {
      let previous = new Set(menuFor(TOOLBAR_BANDS[0].name, mode))
      TOOLBAR_BANDS.forEach((band, i) => {
        const current = new Set(menuFor(band.name, mode))
        for (const action of ALL[mode]) {
          if (!current.has(action) && previous.has(action)) {
            expect(revealVariants(revealClass(action, mode)), `${action} (${mode})`).toEqual([
              bounds[i],
            ])
          }
        }
        previous = current
      })
    }
  })

  it('keeps exactly one inline-flex variant in every reveal class', () => {
    for (const cls of allRevealClasses(REVEAL_CLASS)) {
      expect(revealVariants(cls), cls).toHaveLength(1)
    }
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
