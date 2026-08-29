import { describe, expect, it } from 'vitest'
import {
  mergeBracketBoundaries,
  mergeBracketRanges,
  shouldFallbackToRanges,
} from './bracket-merge'

describe('mergeBracketRanges', () => {
  it('merges an opening bracket with the following range', () => {
    const ranges = [
      { start: 0, end: 1, lang: 'zh' },
      { start: 1, end: 5, lang: 'zh' },
    ]
    expect(mergeBracketRanges(ranges, '（你好')).toEqual([{ start: 0, end: 5, lang: 'zh' }])
  })

  it('extends the previous merged range with a closing bracket', () => {
    const ranges = [
      { start: 0, end: 2, lang: 'zh' },
      { start: 2, end: 3, lang: 'zh' },
    ]
    expect(mergeBracketRanges(ranges, '你好）')).toEqual([{ start: 0, end: 3, lang: 'zh' }])
  })

  it('leaves a closing bracket as a separate range when nothing precedes it', () => {
    const ranges = [{ start: 0, end: 1, lang: 'zh' }]
    expect(mergeBracketRanges(ranges, '）')).toEqual(ranges)
  })

  it('leaves non-bracket ranges untouched', () => {
    const ranges = [
      { start: 0, end: 2, lang: 'zh' },
      { start: 2, end: 4, lang: 'en' },
    ]
    expect(mergeBracketRanges(ranges, '嗨hi')).toEqual(ranges)
  })
})

describe('mergeBracketBoundaries', () => {
  it('concatenates opening bracket text into the next boundary', () => {
    const boundaries = [
      { offset: 0, at: 0, text: '（' },
      { offset: 1, at: 0.5, text: '你好' },
    ]
    // Opening bracket is consumed into the next boundary, so only one remains.
    expect(mergeBracketBoundaries(boundaries)).toEqual([
      { offset: 0, at: 0, duration: undefined, text: '（你好' },
    ])
  })

  it('appends a closing bracket to the previous boundary text', () => {
    const boundaries = [
      { offset: 0, at: 0, text: '你好' },
      { offset: 2, at: 0.5, text: '）' },
    ]
    const merged = mergeBracketBoundaries(boundaries)
    expect(merged[0].text).toBe('你好）')
    expect(merged).toHaveLength(1)
  })
})

describe('shouldFallbackToRanges', () => {
  it('is true when boundaries under-count ranges', () => {
    expect(shouldFallbackToRanges({ boundaries: [{ offset: 0, at: 0, text: 'x' }], ranges: [{ start: 0, end: 1, lang: 'zh' }, { start: 1, end: 2, lang: 'zh' }] })).toBe(true)
  })

  it('is false when boundaries and ranges align', () => {
    expect(shouldFallbackToRanges({ boundaries: [{ offset: 0, at: 0, text: 'x' }, { offset: 2, at: 1, text: 'y' }], ranges: [{ start: 0, end: 1, lang: 'zh' }] })).toBe(false)
  })

  it('is false with no boundaries', () => {
    expect(shouldFallbackToRanges({ boundaries: [], ranges: [] })).toBe(false)
  })
})
