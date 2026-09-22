import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  applyHeartbeat,
  confirmScanJobOverwrite,
  disableCronJobHeartbeat,
  isHeartbeatConfigurable,
  isHeartbeatSupported,
  shouldAskHeartbeat,
  syncCronJobHeartbeat,
} from './heartbeat.mjs'

function stubSteps() {
  const calls = []
  return {
    calls,
    steps: {
      syncCronJobHeartbeat: async target => void calls.push(`syncCronJobHeartbeat:${target}`),
      disableCronJobHeartbeat: async target => void calls.push(`disableCronJobHeartbeat:${target}`),
    },
  }
}

describe('applyHeartbeat', () => {
  it('cron-job syncs the job', async () => {
    const { calls, steps } = stubSteps()
    await applyHeartbeat('cron-job', steps)
    expect(calls).toEqual(['syncCronJobHeartbeat:vercel'])
  })

  it('none disables the job', async () => {
    const { calls, steps } = stubSteps()
    await applyHeartbeat('none', steps)
    expect(calls).toEqual(['disableCronJobHeartbeat:vercel'])
  })

  it('routes the target through to the steps', async () => {
    const { calls, steps } = stubSteps()
    await applyHeartbeat('cron-job', steps, 'cloudflare')
    await applyHeartbeat('none', steps, 'cloudflare')
    expect(calls).toEqual(['syncCronJobHeartbeat:cloudflare', 'disableCronJobHeartbeat:cloudflare'])
  })

  it('rejects unknown providers before touching either side', async () => {
    const { calls, steps } = stubSteps()
    await expect(applyHeartbeat('skip', steps)).rejects.toThrow('Unknown heartbeat')
    expect(calls).toHaveLength(0)
  })

  it('forwards options to the steps', async () => {
    const seen = []
    const steps = {
      syncCronJobHeartbeat: async (target, options) => void seen.push([target, options]),
      disableCronJobHeartbeat: async (target, options) => void seen.push([target, options]),
    }
    await applyHeartbeat('cron-job', steps, 'cloudflare', { baseUrl: 'https://x.pages.dev' })
    await applyHeartbeat('none', steps, 'cloudflare', { baseUrl: 'https://x.pages.dev' })
    expect(seen).toEqual([
      ['cloudflare', { baseUrl: 'https://x.pages.dev' }],
      ['cloudflare', { baseUrl: 'https://x.pages.dev' }],
    ])
  })
})

describe('confirmScanJobOverwrite', () => {
  it('keeps the overwrite without prompting when non-interactive', async () => {
    // vitest has no TTY, so this resolves true without reading stdin.
    await expect(confirmScanJobOverwrite({ existing: { jobId: 7 }, diff: ['enabled'] })).resolves.toBe(true)
  })
})

function fixtureRoot({ withEndpoint = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'heartbeat-'))
  if (withEndpoint) {
    const endpointDir = join(dir, 'src', 'routes', 'api', 'cron', 'scan')
    mkdirSync(endpointDir, { recursive: true })
    writeFileSync(join(endpointDir, '+server.ts'), 'export function GET() {}')
  }
  return dir
}

describe('isHeartbeatSupported', () => {
  it('detects the cron endpoint', () => {
    expect(isHeartbeatSupported(fixtureRoot({ withEndpoint: true }))).toBe(true)
    expect(isHeartbeatSupported(fixtureRoot())).toBe(false)
  })
})

describe('isHeartbeatConfigurable', () => {
  it('needs the operator API key', () => {
    // Injected values keep the test hermetic (the no-arg path reads the real
    // env: shell, .env.local).
    expect(isHeartbeatConfigurable({ apiKey: 'key' })).toBe(true)
    expect(isHeartbeatConfigurable({ apiKey: '  ' })).toBe(false)
    expect(isHeartbeatConfigurable({ apiKey: '' })).toBe(false)
  })
})

describe('shouldAskHeartbeat', () => {
  const endpointRoot = fixtureRoot({ withEndpoint: true })
  const bareRoot = fixtureRoot()

  it('asks when wiring is possible and no choice was given', () => {
    expect(shouldAskHeartbeat({ heartbeat: '', root: endpointRoot, apiKey: 'key' })).toBe(true)
  })

  it('stays silent without a cron endpoint', () => {
    expect(shouldAskHeartbeat({ heartbeat: '', root: bareRoot, apiKey: 'key' })).toBe(false)
  })

  it('stays silent without the operator API key', () => {
    expect(shouldAskHeartbeat({ heartbeat: '', root: endpointRoot, apiKey: '' })).toBe(false)
  })

  it('stays silent on an explicit provider choice', () => {
    expect(shouldAskHeartbeat({ heartbeat: 'cron-job', root: endpointRoot, apiKey: 'key' })).toBe(false)
    expect(shouldAskHeartbeat({ heartbeat: 'none', root: endpointRoot, apiKey: '' })).toBe(false)
  })
})

describe('heartbeat skip without endpoint', () => {
  it('sync skips without touching secrets or network', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await expect(syncCronJobHeartbeat('vercel', { root: fixtureRoot() })).resolves.toBeUndefined()
      expect(log).toHaveBeenCalledWith(expect.stringContaining('action=heartbeat_unsupported_skip'))
    } finally {
      log.mockRestore()
    }
  })

  it('disable skips without touching secrets or network', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await expect(disableCronJobHeartbeat('vercel', { root: fixtureRoot() })).resolves.toBeUndefined()
      expect(log).toHaveBeenCalledWith(expect.stringContaining('action=heartbeat_unsupported_skip'))
    } finally {
      log.mockRestore()
    }
  })
})
