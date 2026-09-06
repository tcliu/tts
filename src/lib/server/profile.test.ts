import { describe, expect, it } from 'vitest'
import { resolveProfile } from './profile'

describe('resolveProfile', () => {
  it('prefers an explicit PROFILE', () => {
    expect(resolveProfile({ PROFILE: 'prod' })).toBe('prod')
    expect(resolveProfile({ PROFILE: 'PROD' })).toBe('prod')
    expect(resolveProfile({ PROFILE: 'dev', NODE_ENV: 'production' })).toBe('dev')
  })

  it('treats NODE_ENV=production as prod without an explicit PROFILE', () => {
    expect(resolveProfile({ NODE_ENV: 'production' })).toBe('prod')
  })

  it('defaults to dev', () => {
    expect(resolveProfile({})).toBe('dev')
    expect(resolveProfile({ NODE_ENV: 'test' })).toBe('dev')
  })
})
