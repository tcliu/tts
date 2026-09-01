import { describe, expect, it } from 'vitest'
import { CANONICAL_SYNTHESIS_RATE, synthesisCacheKey } from './tts-cache-key'

describe('synthesisCacheKey', () => {
  it('produces identical keys for identical inputs regardless of call site', () => {
    expect(synthesisCacheKey('Hello', 'en-US-AriaNeural', 1)).toBe(synthesisCacheKey('Hello', 'en-US-AriaNeural', 1))
  })

  it('distinguishes text and voice while reusing every playback rate', () => {
    const base = synthesisCacheKey('Hello', 'en-US-AriaNeural', 1)
    expect(base).not.toBe(synthesisCacheKey('Hello!', 'en-US-AriaNeural', 1))
    expect(base).not.toBe(synthesisCacheKey('Hello', 'en-US-JennyNeural', 1))
    expect(base).toBe(synthesisCacheKey('Hello', 'en-US-AriaNeural', 1.5))
  })

  it('keeps field boundaries stable for values containing separators', () => {
    const tricky = synthesisCacheKey('a|b,c', 'x|y', 2)
    expect(tricky).toBe(synthesisCacheKey('a|b,c', 'x|y', 2))
    expect(tricky).not.toBe(synthesisCacheKey('a', 'b,c|x|y', 2))
  })

  it('always encodes the canonical synthesis rate', () => {
    expect(synthesisCacheKey('Hello', 'en-US-AriaNeural', 3)).toBe(
      JSON.stringify(['Hello', 'en-US-AriaNeural', CANONICAL_SYNTHESIS_RATE]),
    )
  })
})
