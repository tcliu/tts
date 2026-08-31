import { describe, expect, it } from 'vitest'
import { synthesisCacheKey } from './tts-cache-key'
import { isScopeInvalidatedByClearedKeys } from './tts-cache-clear'

function key(text: string, voice: string, rate: number) {
  return synthesisCacheKey(text, voice, rate)
}

describe('isScopeInvalidatedByClearedKeys', () => {
  it('returns false for null or blank scope', () => {
    expect(isScopeInvalidatedByClearedKeys(null, ['k'], [], { effectiveSpeed: 1, defaultSpeed: 1, resolveVoiceEdge: () => 'en-US-AriaNeural' })).toBe(false)
    expect(isScopeInvalidatedByClearedKeys({ text: '   ', lang: 'en' }, ['k'], [], { effectiveSpeed: 1, defaultSpeed: 1, resolveVoiceEdge: () => 'en-US-AriaNeural' })).toBe(false)
  })

  it('matches by trimmed text regardless of surrounding whitespace', () => {
    const scope = { text: 'hello', lang: 'en' }
    const entries = [{ key: 'k1', text: '  hello  ' }]
    expect(isScopeInvalidatedByClearedKeys(scope, ['k1'], entries, { effectiveSpeed: 1, defaultSpeed: 1, resolveVoiceEdge: () => '' })).toBe(true)
  })

  it('matches exactly by text even when voice has no configuration', () => {
    const scope = { text: 'hello', lang: 'en' }
    const entries = [{ key: 'k1', text: 'hello' }]
    expect(isScopeInvalidatedByClearedKeys(scope, ['k1'], entries, { effectiveSpeed: 1, defaultSpeed: 1, resolveVoiceEdge: () => '' })).toBe(true)
    expect(isScopeInvalidatedByClearedKeys(scope, ['k2'], entries, { effectiveSpeed: 1, defaultSpeed: 1, resolveVoiceEdge: () => '' })).toBe(false)
  })

  it('matches by candidate cache key with session voice at either speed tier', () => {
    const scope = { text: 'Hello world', lang: 'en' }
    const voice = 'en-US-AriaNeural'
    const k = key('Hello world', voice, 1.5)
    const kDefault = key('Hello world', voice, 1)
    expect(isScopeInvalidatedByClearedKeys(scope, [k], [], { effectiveSpeed: 1.5, defaultSpeed: 1, resolveVoiceEdge: () => voice })).toBe(true)
    expect(isScopeInvalidatedByClearedKeys(scope, [kDefault], [], { effectiveSpeed: 1.5, defaultSpeed: 1, resolveVoiceEdge: () => voice })).toBe(true)
  })

  it('respects the session voice resolver over default voice (override scenario)', () => {
    const scope = { text: 'Hola', lang: 'es' }
    const sessionVoice = 'es-ES-AlvaroNeural'
    const defaultVoice = 'es-ES-ElviraNeural'
    const sessionKey = key('Hola', sessionVoice, 1)
    const defaultKey = key('Hola', defaultVoice, 1)
    // session voice key matches when resolver returns session voice
    expect(isScopeInvalidatedByClearedKeys(scope, [sessionKey], [], { effectiveSpeed: 1, defaultSpeed: 1, resolveVoiceEdge: () => sessionVoice })).toBe(true)
    // default voice key does NOT match when resolver is session voice
    expect(isScopeInvalidatedByClearedKeys(scope, [defaultKey], [], { effectiveSpeed: 1, defaultSpeed: 1, resolveVoiceEdge: () => sessionVoice })).toBe(false)
  })

  it('is a no-op for non-involved keys', () => {
    const scope = { text: 'Hello', lang: 'en' }
    expect(isScopeInvalidatedByClearedKeys(scope, ['other'], [{ key: 'k', text: 'Hello' }], { effectiveSpeed: 1, defaultSpeed: 1, resolveVoiceEdge: () => 'en-US-AriaNeural' })).toBe(false)
  })
})
