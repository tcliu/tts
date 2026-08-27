import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TEXT_SIZE } from './text-size'

// TEXT_SIZE holds literal `text-*` classes so Tailwind's scanner sees them, and
// src/styles.css force-generates the same candidates via @source inline as
// defense-in-depth. This test keeps the two in lockstep in both directions.
describe('tailwind @source inline contract', () => {
  const styles = readFileSync('src/styles.css', 'utf-8')

  it('keeps styles.css @source inline in sync with TEXT_SIZE', () => {
    const match = /@source\s+inline\("([^"]+)"\)/.exec(styles)
    expect(match).not.toBeNull()
    const declared = new Set((match?.[1] ?? '').split(/\s+/).filter(Boolean))

    const emitted = new Set(Object.values(TEXT_SIZE))
    expect(emitted.size).toBeGreaterThan(0)

    for (const token of emitted) {
      expect(declared, `${token} must be listed in styles.css @source inline`).toContain(token)
    }
    for (const token of declared) {
      expect(emitted, `${token} is declared in styles.css but not emitted by TEXT_SIZE`).toContain(token)
    }
  })
})
