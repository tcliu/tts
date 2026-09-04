import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Speed values live in stringly-typed sync points that the compiler cannot
// fully cross-check: the canonical array in tts/catalog.ts (the source of truth
// for the UI's NumberInput min/max, the dropdown options, and the SPEED_STEP
// derivation), the legacy reference script in tts.mjs, and the server's rate
// allowlist. This test fails when any of them drifts away from the canonical
// list, keeping spec.md §Settings' "default speed options must match the
// speed list in tts.mjs" contract enforceable.
const catalogSource = readFileSync('src/lib/tts/catalog.ts', 'utf-8')
const ttsMjs = readFileSync('tts.mjs', 'utf-8')
const serverSource = readFileSync('src/routes/api/tts/synthesize/+server.ts', 'utf-8')

function canonicalSpeeds(): number[] {
  const marker = 'export const SPEEDS = ['
  const start = catalogSource.indexOf(marker)
  expect(start, 'the SPEEDS array declaration must stay findable').toBeGreaterThanOrEqual(0)
  const end = catalogSource.indexOf(']', start)
  expect(end, 'the SPEEDS array must be a single-line literal').toBeGreaterThan(start)
  const literal = catalogSource.slice(start + marker.length, end)
  return literal
    .split(',')
    .map(token => Number(token.trim()))
    .filter(value => Number.isFinite(value))
}

describe('speed value parity across sync points', () => {
  const speeds = canonicalSpeeds()

  it('keeps 1 as a member of the canonical list (default rate)', () => {
    expect(speeds).toContain(1)
  })

  it('sorts the canonical list in ascending order', () => {
    for (let i = 1; i < speeds.length; i += 1) {
      expect(speeds[i]).toBeGreaterThan(speeds[i - 1])
    }
  })

  it('matches the speed list in tts.mjs', () => {
    const match = ttsMjs.match(/const SPEEDS = \[([^\]]+)\]/)
    expect(match, 'tts.mjs must declare a SPEEDS array').not.toBeNull()
    const ttsMjsSpeeds = match![1]
      .split(',')
      .map(token => Number(token.trim()))
      .filter(value => Number.isFinite(value))
    expect(ttsMjsSpeeds).toEqual(speeds)
  })

  it('enforces the canonical speed list at the API boundary', () => {
    // The server validates `rate` against `SPEEDS` (the canonical list) rather
    // than re-declaring the values, so checking the symbol plus an `includes`
    // call pattern is the right sync-point test here.
    expect(serverSource, 'the synthesize handler must import SPEEDS').toMatch(/import .* SPEEDS .* from .*tts-reference/)
    expect(serverSource, 'the synthesize handler must reject rates outside SPEEDS').toMatch(/SPEEDS[\s\S]{0,80}\.includes\(rate\)/)
  })
})
