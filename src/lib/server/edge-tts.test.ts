import { describe, expect, it } from 'vitest'
import { normalizeForChineseVoice, ZH_VARIANT_PAIRS } from './edge-tts'

describe('normalizeForChineseVoice', () => {
  it('maps the reported Japanese variant sentence to standard Chinese', () => {
    expect(normalizeForChineseVoice('毎朝,')).toBe('每朝,')
    expect(normalizeForChineseVoice('毎朝, この静かな場所には 美しい花 が咲き誇り,')).toBe(
      '每朝, この静かな場所には 美しい花 が咲き誇り,',
    )
  })

  it('leaves text without Japanese variants untouched', () => {
    const samples = [
      '',
      'Hello world.',
      '老李 每天也會來到公園的這座古色古香的 茶館,',
      'глинвейн глинвейн',
    ]
    for (const sample of samples) {
      expect(normalizeForChineseVoice(sample)).toBe(sample)
    }
  })

  it('preserves text length so boundary offsets stay aligned', () => {
    for (const [variant] of ZH_VARIANT_PAIRS) {
      const normalized = normalizeForChineseVoice(`x${variant}y`)
      expect(normalized.length).toBe(3)
    }
  })

  it('keeps the pair table single-character with unique variants', () => {
    const variants = ZH_VARIANT_PAIRS.map(([variant]) => variant)
    const standards = ZH_VARIANT_PAIRS.map(([, standard]) => standard)
    for (const [variant, standard] of ZH_VARIANT_PAIRS) {
      expect([...variant]).toHaveLength(1)
      expect([...standard]).toHaveLength(1)
    }
    // Variants must be unique so each normalizes deterministically; standards
    // may collide (e.g. 歴 and 暦 both map to 历) because mapping is
    // many-to-one and display text is sliced from the original, never inverted.
    expect(new Set(variants).size).toBe(ZH_VARIANT_PAIRS.length)
    expect(new Set(variants).size).toBeGreaterThanOrEqual(new Set(standards).size)
    for (const standard of standards) {
      expect(variants).not.toContain(standard)
    }
  })

  it('normalizes every mapped variant consistently', () => {
    for (const [variant, standard] of ZH_VARIANT_PAIRS) {
      expect(normalizeForChineseVoice(variant)).toBe(standard)
      expect(normalizeForChineseVoice(standard)).toBe(standard)
    }
  })
})
