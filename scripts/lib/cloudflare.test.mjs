import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  desiredPagesVars,
  detectProductionBranch,
  ensureD1Database,
  ensurePagesProject,
  findD1DatabaseId,
  generatedWranglerProjectName,
  getPagesProjectDomain,
  renderWranglerConfig,
  resolveCloudflareAppUrl,
  resolveCloudflareProjectName,
  resolveD1DatabaseName,
  splitCloudflareEnv,
} from './cloudflare.mjs'

const PAGES_JSON = JSON.stringify([
  {
    'Project Name': 'tts',
    'Project Domains': 'tts-b1s.pages.dev',
    'Git Provider': 'No',
    'Last Modified': '6 minutes ago',
  },
  {
    'Project Name': 'tts-v2',
    'Project Domains': 'tts-v2.pages.dev',
    'Git Provider': 'No',
    'Last Modified': '1 hour ago',
  },
])

function stubRunner({ listOutput = PAGES_JSON, listStatus = 0, createStatus = 0 } = {}) {
  const calls = []
  const runner = (args, _options) => {
    calls.push(args.join(' '))
    if (args.includes('create')) {
      return { status: createStatus, output: '' }
    }
    return { status: listStatus, output: listOutput }
  }
  return { calls, runner }
}

describe('ensurePagesProject', () => {
  it('does nothing when the project already exists', () => {
    const { calls, runner } = stubRunner()
    expect(ensurePagesProject('tts', runner, '/root', 'master')).toBe('exists')
    expect(calls).toEqual(['pages project list --json'])
  })

  it('does not collide with prefix names', () => {
    const { calls, runner } = stubRunner()
    expect(ensurePagesProject('tts-v', runner, '/root', 'master')).toBe('created')
    expect(calls).toEqual([
      'pages project list --json',
      'pages project create tts-v --production-branch master',
    ])
  })

  it('creates the project when it is missing', () => {
    const { calls, runner } = stubRunner({ listOutput: '[]' })
    expect(ensurePagesProject('tts', runner, '/root', 'master')).toBe('created')
    expect(calls).toEqual(['pages project list --json', 'pages project create tts --production-branch master'])
  })

  it('throws when listing fails', () => {
    const { runner } = stubRunner({ listStatus: 1 })
    expect(() => ensurePagesProject('tts', runner, '/root')).toThrow('project list failed')
  })

  it('throws when creation fails', () => {
    const { runner } = stubRunner({ listOutput: '[]', createStatus: 1 })
    expect(() => ensurePagesProject('tts', runner, '/root', 'master')).toThrow(
      'Failed to create Cloudflare Pages project',
    )
  })

  it('treats non-JSON output as missing', () => {
    const { calls, runner } = stubRunner({ listOutput: 'not json' })
    expect(ensurePagesProject('tts', runner, '/root', 'master')).toBe('created')
    expect(calls).toEqual(['pages project list --json', 'pages project create tts --production-branch master'])
  })
})

function jsonRunner(output) {
  return () => ({ status: 0, output })
}

describe('getPagesProjectDomain', () => {
  it('returns the production hostname from the JSON list', () => {
    expect(getPagesProjectDomain('tts', jsonRunner(PAGES_JSON), '/root')).toBe(
      'tts-b1s.pages.dev',
    )
  })

  it('returns empty when the project is absent or the list fails', () => {
    expect(getPagesProjectDomain('missing', jsonRunner(PAGES_JSON), '/root')).toBe('')
    expect(getPagesProjectDomain('tts', jsonRunner('[]'), '/root')).toBe('')
    expect(getPagesProjectDomain('tts', jsonRunner('not json'), '/root')).toBe('')
    expect(
      getPagesProjectDomain(
        'tts',
        () => ({ status: 1, output: '' }),
        '/root',
      ),
    ).toBe('')
  })
})

describe('resolveCloudflareProjectName', () => {
  it('prefers the overlay key over the generated file', () => {
    expect(resolveCloudflareProjectName({ CLOUDFLARE_PROJECT: 'codepg-projects' }, 'tts')).toBe(
      'codepg-projects',
    )
  })

  it('falls back to the generated name', () => {
    expect(resolveCloudflareProjectName({}, 'tts')).toBe('tts')
  })

  it('returns empty when neither is set', () => {
    expect(resolveCloudflareProjectName({}, '')).toBe('')
  })
})

describe('generatedWranglerProjectName', () => {
  it('reads the name from the generated config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wrangler-name-'))
    writeFileSync(join(dir, 'wrangler.toml'), 'name = "my-app"\n[vars]\n')
    expect(generatedWranglerProjectName(dir)).toBe('my-app')
  })

  it('returns empty without a config', () => {
    expect(generatedWranglerProjectName(mkdtempSync(join(tmpdir(), 'wrangler-empty-')))).toBe('')
  })
})

describe('resolveCloudflareAppUrl', () => {
  it('derives the live URL from the Pages production domain', () => {
    expect(
      resolveCloudflareAppUrl({ env: { CLOUDFLARE_PROJECT: 'tts' }, runner: jsonRunner(PAGES_JSON) }),
    ).toBe('https://tts-b1s.pages.dev')
  })

  it('throws when the project is missing', () => {
    expect(() =>
      resolveCloudflareAppUrl({
        env: {},
        runner: jsonRunner(PAGES_JSON),
        root: mkdtempSync(join(tmpdir(), 'wrangler-noproj-')),
      }),
    ).toThrow('Missing CLOUDFLARE_PROJECT')
  })

  it('throws when the production domain is unresolvable', () => {
    expect(() =>
      resolveCloudflareAppUrl({ env: { CLOUDFLARE_PROJECT: 'missing' }, runner: jsonRunner(PAGES_JSON) }),
    ).toThrow('Could not resolve the Pages production domain for project missing')
  })
})

describe('renderWranglerConfig', () => {
  it('renders name + static stanza + pruned vars', () => {
    expect(renderWranglerConfig({ project: 'codepg-projects', vars: { ADMIN_USERNAME: 'admin' } })).toBe(
      [
        'name = "codepg-projects"',
        'compatibility_date = "2026-09-01"',
        'compatibility_flags = ["nodejs_compat"]',
        'pages_build_output_dir = ".svelte-kit/cloudflare"',
        '',
        '[vars]',
        'ADMIN_USERNAME = "admin"',
        '',
      ].join('\n'),
    )
  })
})

describe('desiredPagesVars', () => {
  it('appends the forced build vars', () => {
    expect(desiredPagesVars({ ADMIN_USERNAME: 'admin' })).toEqual({
      ADMIN_USERNAME: 'admin',
      CF_PAGES: '1',
      PROFILE: 'prod',
    })
  })

  it('forces CF_PAGES and PROFILE even when the overlay disagrees', () => {
    expect(desiredPagesVars({ CF_PAGES: '0', PROFILE: 'dev' })).toEqual({
      CF_PAGES: '1',
      PROFILE: 'prod',
    })
  })
})

describe('splitCloudflareEnv', () => {
  it('splits vars, secrets, and local-only keys; drops empties and forbidden keys', () => {
    expect(
      splitCloudflareEnv({
        CLOUDFLARE_PROJECT: 'codepg-projects',
        APP_BASE_URL: 'https://x.pages.dev',
        ADMIN_USERNAME: 'admin',
        EMPTY: '',
        DATABASE_URL: 'postgres://x',
        VERCEL_TOKEN: 'v',
        CRON_SECRET: 's',
        CLOUDFLARE_SCAN_TOKEN: 't',
      }),
    ).toEqual({
      project: 'codepg-projects',
      vars: { ADMIN_USERNAME: 'admin' },
      secrets: { CRON_SECRET: 's', CLOUDFLARE_SCAN_TOKEN: 't' },
    })
  })

  it('returns an empty project when the overlay key is missing', () => {
    expect(splitCloudflareEnv({ ADMIN_USERNAME: 'admin' }).project).toBe('')
  })

  it('accepts a narrower forbidden set for Neon-backed apps', () => {
    const vercelOnly = new Set(['VERCEL_TOKEN'])
    expect(
      splitCloudflareEnv({ DATABASE_URL: 'postgres://x', VERCEL_TOKEN: 'v' }, { forbidden: vercelOnly }),
    ).toEqual({ project: '', vars: {}, secrets: { DATABASE_URL: 'postgres://x' } })
  })
})

describe('renderWranglerConfig with D1', () => {
  it('appends a D1 binding when provided', () => {
    const config = renderWranglerConfig({
      project: 'my-app',
      vars: { PROFILE: 'prod' },
      d1: { binding: 'MY_APP_D1', databaseName: 'my-app-d1', databaseId: 'abc-123' },
    })
    expect(config).toContain('[vars]')
    expect(config).toContain('[[d1_databases]]')
    expect(config).toContain('binding = "MY_APP_D1"')
    expect(config).toContain('database_name = "my-app-d1"')
    expect(config).toContain('database_id = "abc-123"')
  })

  it('omits the D1 block without a database', () => {
    expect(renderWranglerConfig({ project: 'x', vars: {} })).not.toContain('d1_databases')
  })

  it('fails closed on a partial D1 descriptor', () => {
    expect(() => renderWranglerConfig({ project: 'x', vars: {}, d1: { databaseName: 'd', databaseId: 'i' } }))
      .toThrow('d1.binding is required')
    expect(() => renderWranglerConfig({ project: 'x', vars: {}, d1: { binding: 'B' } }))
      .toThrow('d1.databaseName is required')
  })
})

describe('resolveD1DatabaseName', () => {
  it('prefers the overlay value and returns empty when unset', () => {
    expect(resolveD1DatabaseName({ CLOUDFLARE_D1_DATABASE: 'custom-d1' })).toBe('custom-d1')
    expect(resolveD1DatabaseName({})).toBe('')
  })
})

describe('findD1DatabaseId', () => {
  const d1List = JSON.stringify([
    { uuid: 'id-1', name: 'my-app-d1' },
    { database_id: 'id-2', name: 'other-d1' },
  ])

  it('accepts uuid and database_id fields', () => {
    expect(findD1DatabaseId(d1List, 'my-app-d1')).toBe('id-1')
    expect(findD1DatabaseId(d1List, 'other-d1')).toBe('id-2')
    expect(findD1DatabaseId(d1List, 'missing-d1')).toBe('')
    expect(findD1DatabaseId('not json', 'my-app-d1')).toBe('')
  })
})

describe('ensureD1Database', () => {
  const d1List = JSON.stringify([{ uuid: 'id-1', name: 'my-app-d1' }])

  it('returns the existing id without creating', () => {
    const calls = []
    const runner = args => {
      calls.push(args.join(' '))
      return { status: 0, output: d1List }
    }
    expect(ensureD1Database('my-app-d1', runner)).toEqual({ status: 'exists', databaseId: 'id-1' })
    expect(calls).toEqual(['d1 list --json'])
  })

  it('creates and re-lists when missing', () => {
    const calls = []
    let listed = 0
    const runner = args => {
      calls.push(args.join(' '))
      if (args.includes('create')) {
        return { status: 0, output: '' }
      }
      listed += 1
      return { status: 0, output: listed === 1 ? '[]' : d1List }
    }
    expect(ensureD1Database('my-app-d1', runner)).toEqual({ status: 'created', databaseId: 'id-1' })
    expect(calls).toEqual(['d1 list --json', 'd1 create my-app-d1', 'd1 list --json'])
  })

  it('throws when listing fails', () => {
    const runner = () => ({ status: 1, output: '' })
    expect(() => ensureD1Database('my-app-d1', runner)).toThrow('d1 list failed')
  })
})

describe('detectProductionBranch', () => {
  it('reads the checkout branch', () => {
    expect(detectProductionBranch('/d/dev/workspaces/tts')).toBe('main')
  })
})
