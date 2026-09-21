import { describe, expect, it } from 'vitest'

import {
  desiredPagesVars,
  detectProductionBranch,
  ensurePagesProject,
  getPagesProjectDomain,
  renderWranglerConfig,
  resolveCloudflareProjectName,
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
  it('splits vars, secrets, and local-only keys; drops empties', () => {
    expect(
      splitCloudflareEnv({
        CLOUDFLARE_PROJECT: 'codepg-projects',
        APP_BASE_URL: 'https://x.pages.dev',
        ADMIN_USERNAME: 'admin',
        EMPTY: '',
        DATABASE_URL: 'postgres://x',
        CRON_SECRET: 's',
      }),
    ).toEqual({
      project: 'codepg-projects',
      vars: { ADMIN_USERNAME: 'admin' },
      secrets: { DATABASE_URL: 'postgres://x', CRON_SECRET: 's' },
    })
  })

  it('returns an empty project when the overlay key is missing', () => {
    expect(splitCloudflareEnv({ ADMIN_USERNAME: 'admin' }).project).toBe('')
  })
})

describe('detectProductionBranch', () => {
  it('reads the checkout branch', () => {
    expect(detectProductionBranch('/d/dev/workspaces/tts')).toBe('main')
  })
})
