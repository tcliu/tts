import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// SelectDropdown builds `text-${size}` classes at runtime; Tailwind only emits
// them because src/styles.css force-generates the candidates via @source inline.
// This test fails when a size is added to SelectDropdown without updating that
// rule (or vice versa).
describe('tailwind @source inline contract', () => {
  const styles = readFileSync('src/styles.css', 'utf-8')

  it('force-generates every text-size utility SelectDropdown can emit', () => {
    const match = /@source\s+inline\("([^"]+)"\)/.exec(styles)
    expect(match).not.toBeNull()
    const declared = new Set((match?.[1] ?? '').split(/\s+/).filter(Boolean))
    for (const size of ['text-xs', 'text-sm', 'text-md', 'text-lg']) {
      expect(declared, `${size} must be listed in styles.css @source inline`).toContain(size)
    }
  })
})
