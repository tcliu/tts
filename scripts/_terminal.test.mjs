import { describe, expect, it } from 'vitest'

import { formatCommand, isSecretKey, maskArgv } from './_terminal.mjs'

describe('isSecretKey', () => {
  it.each([
    'SESSION_SECRET',
    'ADMIN_PASSWORD',
    'ADMIN_PASSWORD_HASH',
    'CRON_SECRET',
    'VERCEL_TOKEN',
    'DATABASE_URL',
    'PROJECT_CATALOG_DATABASE_URL',
    'API_KEY',
    'ENCRYPTION_KEY',
  ])('treats %s as secret', key => {
    expect(isSecretKey(key)).toBe(true)
  })

  it.each(['PROFILE', 'APP_BASE_URL', 'SCHEMA_NAME', 'ADMIN_USERNAME', 'VERCEL_TEAM_ID', 'MAX_DOCUMENTS_PER_IP'])(
    'treats %s as ordinary',
    key => {
      expect(isSecretKey(key)).toBe(false)
    },
  )
})

describe('maskArgv', () => {
  it('masks the value after --value for secret keys', () => {
    expect(maskArgv(['env', 'add', 'SESSION_SECRET', 'production', '--value', 's3cr3t', '--force'])).toEqual([
      'env',
      'add',
      'SESSION_SECRET',
      'production',
      '--value',
      '***',
      '--force',
    ])
  })

  it('leaves ordinary values visible', () => {
    expect(maskArgv(['env', 'add', 'APP_BASE_URL', 'production', '--value', 'https://x.vercel.app'])).toEqual([
      'env',
      'add',
      'APP_BASE_URL',
      'production',
      '--value',
      'https://x.vercel.app',
    ])
  })

  it('leaves other argv untouched', () => {
    expect(maskArgv(['deploy', '--prod', '--yes'])).toEqual(['deploy', '--prod', '--yes'])
  })

  it('handles a trailing --value and empty input', () => {
    expect(maskArgv(['env', 'add', '--value'])).toEqual(['env', 'add', '--value'])
    expect(maskArgv([])).toEqual([])
  })
})

describe('formatCommand', () => {
  it('prefixes the joined command with $ and masks secrets', () => {
    expect(formatCommand('vercel', ['env', 'add', 'SESSION_SECRET', 'production', '--value', 's3cr3t'])).toBe(
      '$ vercel env add SESSION_SECRET production --value ***',
    )
    expect(formatCommand('git', ['rev-parse', 'HEAD'])).toBe('$ git rev-parse HEAD')
  })
})
