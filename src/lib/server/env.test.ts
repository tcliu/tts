import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertProdEnv, prodEnvIssues } from './env'

type Env = Record<string, string | undefined>

function env(overrides: Env = {}): Env {
  return { NODE_ENV: 'test', ...overrides }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('prodEnvIssues', () => {
  it('ignores non-prod runtimes, including builds with NODE_ENV=production', () => {
    expect(prodEnvIssues(env())).toEqual([])
    expect(prodEnvIssues(env({ NODE_ENV: 'production' }))).toEqual([])
  })

  it('requires SESSION_SECRET on any Vercel runtime', () => {
    expect(prodEnvIssues(env({ VERCEL: '1' }))).toEqual(['SESSION_SECRET'])
    expect(prodEnvIssues(env({ VERCEL: '1', SESSION_SECRET: 's3cret' }))).toEqual([])
  })

  it('requires DATABASE_URL only for the prod profile', () => {
    expect(prodEnvIssues(env({ VERCEL: '1', SESSION_SECRET: 's3cret' }))).toEqual([])
    expect(prodEnvIssues(env({ PROFILE: 'prod', SESSION_SECRET: 's3cret' }))).toEqual(['DATABASE_URL'])
    expect(
      prodEnvIssues(env({ PROFILE: 'prod', SESSION_SECRET: 's3cret', DATABASE_URL: 'postgres://db' })),
    ).toEqual([])
  })

  it('treats blank values as missing', () => {
    expect(prodEnvIssues(env({ PROFILE: 'prod', SESSION_SECRET: '  ' }))).toEqual([
      'SESSION_SECRET',
      'DATABASE_URL',
    ])
  })
})

describe('assertProdEnv', () => {
  it('passes outside prod and when complete', () => {
    expect(() => assertProdEnv(env())).not.toThrow()
    expect(() =>
      assertProdEnv(env({ PROFILE: 'prod', SESSION_SECRET: 's3cret', DATABASE_URL: 'postgres://db' })),
    ).not.toThrow()
  })

  it('logs key names and throws listing them, never values', () => {
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((message: string) => {
      logs.push(String(message))
    })
    expect(() => assertProdEnv(env({ PROFILE: 'prod' }))).toThrow(
      'Missing required production env: SESSION_SECRET, DATABASE_URL',
    )
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('action=env_invalid')
    expect(logs[0]).toContain('SESSION_SECRET')
    expect(logs[0]).toContain('DATABASE_URL')
  })
})
