import { describe, expect, it } from 'vitest'

import { applyHeartbeat, confirmScanJobOverwrite } from './heartbeat.mjs'

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
})

describe('confirmScanJobOverwrite', () => {
  it('keeps the overwrite without prompting when non-interactive', async () => {
    // vitest has no TTY, so this resolves true without reading stdin.
    await expect(confirmScanJobOverwrite({ existing: { jobId: 7 }, diff: ['enabled'] })).resolves.toBe(true)
  })
})
