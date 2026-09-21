import { describe, expect, it } from 'vitest'

import {
  buildScanJobPayload,
  CronJobApiError,
  cronJobRequest,
  describeScanJobDiff,
  findScanJob,
  normalizeJobUrl,
  SCAN_JOB_TITLE,
  scanJobTitle,
  setScanJobEnabled,
  syncScanJob,
} from './cron-job.mjs'

const SCAN_URL = 'https://codepg-tts.vercel.app/api/cron/scan'
const CF_SCAN_URL = 'https://codepg-tts-b1s.pages.dev/api/cron/scan'

const CANONICAL_LIST_ENTRY = {
  jobId: 7,
  url: SCAN_URL,
  enabled: true,
  title: SCAN_JOB_TITLE,
  saveResponses: true,
  requestMethod: 0,
  requestTimeout: 60,
  schedule: {
    timezone: 'UTC',
    expiresAt: 0,
    hours: [-1],
    mdays: [-1],
    minutes: [-1],
    months: [-1],
    wdays: [-1],
  },
}

const canonicalDetails = (authorization = 'Bearer s3cr3t') => ({
  jobDetails: { extendedData: { headers: { Authorization: authorization }, body: '' } },
})

function mockFetch(routes) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    const route = routes.find(entry => entry.method === init?.method && url.endsWith(entry.path))
    if (!route) throw new Error(`unexpected request: ${init?.method} ${url}`)
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      json: async () => route.payload ?? {},
    }
  }
  return { calls, fetchImpl }
}

describe('normalizeJobUrl', () => {
  it('ignores trailing slashes and case', () => {
    expect(normalizeJobUrl('https://Codepg-Tts.Vercel.App/api/cron/scan/')).toBe(SCAN_URL)
  })
})

describe('findScanJob', () => {
  it('matches by URL and prefers the canonical title', () => {
    const jobs = [
      { jobId: 1, url: `${SCAN_URL}/`, title: 'renamed in console' },
      { jobId: 2, url: SCAN_URL, title: 'tts auto-scan' },
    ]
    expect(findScanJob(jobs, SCAN_URL)?.jobId).toBe(2)
  })

  it('returns null when nothing targets the URL', () => {
    expect(findScanJob([{ jobId: 1, url: 'https://example.com/' }], SCAN_URL)).toBeNull()
  })

  it('falls back to the canonical title when the URL drifted', () => {
    const jobs = [{ jobId: 9, url: 'https://old.example.com/api/cron/scan', title: 'tts auto-scan' }]
    expect(findScanJob(jobs, SCAN_URL)?.jobId).toBe(9)
  })

  it('returns null for an empty URL even when a titled job exists', () => {
    const jobs = [{ jobId: 9, url: SCAN_URL, title: 'tts auto-scan' }]
    expect(findScanJob(jobs, '')).toBeNull()
  })

  it('scopes the title fallback per target so jobs never steal each other', () => {
    const jobs = [
      { jobId: 1, url: SCAN_URL, title: 'tts auto-scan' },
      { jobId: 2, url: CF_SCAN_URL, title: 'tts auto-scan (cloudflare)' },
    ]
    // URL drift falls back to the same target's job, never the other's.
    expect(findScanJob(jobs, 'https://moved.pages.dev/api/cron/scan', 'cloudflare')?.jobId).toBe(2)
    expect(findScanJob(jobs, 'https://old.example.com/api/cron/scan', 'vercel')?.jobId).toBe(1)
    // With only the other target's job present, a fresh URL creates a new job
    // instead of repointing the foreign one.
    const lonely = [{ jobId: 1, url: SCAN_URL, title: SCAN_JOB_TITLE }]
    expect(findScanJob(lonely, CF_SCAN_URL, 'cloudflare')).toBeNull()
    expect(findScanJob([{ jobId: 2, url: CF_SCAN_URL, title: `${SCAN_JOB_TITLE} (cloudflare)` }], SCAN_URL)).toBeNull()
  })
})

describe('scanJobTitle', () => {
  it('keeps the Vercel title stable and suffixes Cloudflare', () => {
    expect(scanJobTitle('vercel')).toBe(SCAN_JOB_TITLE)
    expect(scanJobTitle()).toBe(SCAN_JOB_TITLE)
    expect(scanJobTitle('cloudflare')).toBe(`${SCAN_JOB_TITLE} (cloudflare)`)
  })
})

describe('buildScanJobPayload', () => {
  it('ticks every minute over GET with the app secret as its header', () => {
    const payload = buildScanJobPayload({ url: SCAN_URL, cronSecret: 's3cr3t', enabled: true })
    expect(payload.requestMethod).toBe(0)
    expect(payload.schedule).toMatchObject({ timezone: 'UTC', minutes: [-1], hours: [-1] })
    expect(payload.extendedData.headers).toEqual({ Authorization: 'Bearer s3cr3t' })
    expect(payload.title).toBe(SCAN_JOB_TITLE)
  })

  it('titles the Cloudflare job so it never collides with Vercel', () => {
    const payload = buildScanJobPayload({ url: CF_SCAN_URL, cronSecret: 's3cr3t', enabled: true, target: 'cloudflare' })
    expect(payload.title).toBe(`${SCAN_JOB_TITLE} (cloudflare)`)
    expect(payload.url).toBe(CF_SCAN_URL)
  })
})

describe('cronJobRequest', () => {
  it('maps 401 to an unauthorized error', async () => {
    const { fetchImpl } = mockFetch([{ method: 'GET', path: '/jobs', status: 401, payload: {} }])
    await expect(cronJobRequest({ apiKey: 'bad', method: 'GET', path: '/jobs', fetchImpl })).rejects.toThrow(
      CronJobApiError,
    )
  })

  it('refuses an empty API key without a network call', async () => {
    const { calls, fetchImpl } = mockFetch([])
    await expect(cronJobRequest({ apiKey: '  ', method: 'GET', path: '/jobs', fetchImpl })).rejects.toThrow(
      'Missing cron-job.org API key.',
    )
    expect(calls).toHaveLength(0)
  })
})

describe('syncScanJob', () => {
  it('creates the job with PUT when no job targets the URL', async () => {
    const { calls, fetchImpl } = mockFetch([
      { method: 'GET', path: '/jobs', status: 200, payload: { jobs: [] } },
      { method: 'PUT', path: '/jobs', status: 200, payload: { jobId: 42 } },
    ])
    const result = await syncScanJob(
      { apiKey: 'key', url: SCAN_URL, cronSecret: 's3cr3t' },
      { fetchImpl },
    )
    expect(result).toEqual({ jobId: 42, created: true })
    expect(calls[1].init.method).toBe('PUT')
    expect(JSON.parse(calls[1].init.body).job.url).toBe(SCAN_URL)
  })

  it('creates a separately titled job per target without touching the other', async () => {
    const { calls, fetchImpl } = mockFetch([
      {
        method: 'GET',
        path: '/jobs',
        status: 200,
        payload: { jobs: [{ jobId: 7, url: SCAN_URL, title: SCAN_JOB_TITLE, enabled: true }] },
      },
      { method: 'PUT', path: '/jobs', status: 200, payload: { jobId: 43 } },
    ])
    const result = await syncScanJob(
      { apiKey: 'key', url: CF_SCAN_URL, cronSecret: 's3cr3t', target: 'cloudflare' },
      { fetchImpl },
    )
    expect(result).toEqual({ jobId: 43, created: true })
    const body = JSON.parse(calls[1].init.body).job
    expect(body.url).toBe(CF_SCAN_URL)
    expect(body.title).toBe(`${SCAN_JOB_TITLE} (cloudflare)`)
  })

  it('patches the match back to canonical when it already exists', async () => {
    const { calls, fetchImpl } = mockFetch([
      {
        method: 'GET',
        path: '/jobs',
        status: 200,
        payload: { jobs: [{ jobId: 7, url: SCAN_URL, enabled: false }] },
      },
      { method: 'GET', path: '/jobs/7', status: 200, payload: { jobDetails: {} } },
      { method: 'PATCH', path: '/jobs/7', status: 200, payload: {} },
    ])
    const result = await syncScanJob(
      { apiKey: 'key', url: SCAN_URL, cronSecret: 's3cr3t' },
      { fetchImpl },
    )
    expect(result).toEqual({ jobId: 7, created: false, updated: true })
    expect(JSON.parse(calls[2].init.body).job.enabled).toBe(true)
  })

  it('skips the PATCH when the job is already canonical', async () => {
    const { calls, fetchImpl } = mockFetch([
      { method: 'GET', path: '/jobs', status: 200, payload: { jobs: [CANONICAL_LIST_ENTRY] } },
      { method: 'GET', path: '/jobs/7', status: 200, payload: canonicalDetails() },
    ])
    const result = await syncScanJob(
      { apiKey: 'key', url: SCAN_URL, cronSecret: 's3cr3t' },
      { fetchImpl },
    )
    expect(result).toEqual({ jobId: 7, created: false, updated: false, reason: 'up-to-date' })
    expect(calls).toHaveLength(2)
  })

  it('declines the PATCH when confirmOverwrite refuses', async () => {
    const seen = []
    const { calls, fetchImpl } = mockFetch([
      {
        method: 'GET',
        path: '/jobs',
        status: 200,
        payload: { jobs: [{ jobId: 7, url: SCAN_URL, enabled: false }] },
      },
      { method: 'GET', path: '/jobs/7', status: 200, payload: { jobDetails: {} } },
    ])
    const result = await syncScanJob(
      { apiKey: 'key', url: SCAN_URL, cronSecret: 's3cr3t' },
      {
        fetchImpl,
        confirmOverwrite: async ({ existing, diff }) => {
          seen.push({ jobId: existing.jobId, diff })
          return false
        },
      },
    )
    expect(result).toEqual({ jobId: 7, created: false, updated: false, reason: 'declined' })
    expect(calls).toHaveLength(2)
    expect(seen[0].diff).toContain('enabled')
  })

  it('patches when the secret rotated even though the list matches', async () => {
    const { calls, fetchImpl } = mockFetch([
      { method: 'GET', path: '/jobs', status: 200, payload: { jobs: [CANONICAL_LIST_ENTRY] } },
      { method: 'GET', path: '/jobs/7', status: 200, payload: canonicalDetails('Bearer stale') },
      { method: 'PATCH', path: '/jobs/7', status: 200, payload: {} },
    ])
    const result = await syncScanJob(
      { apiKey: 'key', url: SCAN_URL, cronSecret: 's3cr3t' },
      { fetchImpl },
    )
    expect(result).toEqual({ jobId: 7, created: false, updated: true })
    expect(calls).toHaveLength(3)
  })

  it('treats a failed details read as auth-unknown and still patches', async () => {
    const { calls, fetchImpl } = mockFetch([
      { method: 'GET', path: '/jobs', status: 200, payload: { jobs: [CANONICAL_LIST_ENTRY] } },
      { method: 'GET', path: '/jobs/7', status: 500, payload: {} },
      { method: 'PATCH', path: '/jobs/7', status: 200, payload: {} },
    ])
    const seen = []
    const result = await syncScanJob(
      { apiKey: 'key', url: SCAN_URL, cronSecret: 's3cr3t' },
      {
        fetchImpl,
        confirmOverwrite: async ({ diff }) => {
          seen.push(diff)
          return true
        },
      },
    )
    expect(result).toEqual({ jobId: 7, created: false, updated: true })
    expect(seen[0]).toContain('auth')
    expect(calls).toHaveLength(3)
  })
})

describe('describeScanJobDiff', () => {
  it('is empty for a canonical job and names drifted fields otherwise', () => {
    expect(
      describeScanJobDiff(CANONICAL_LIST_ENTRY, canonicalDetails().jobDetails, {
        url: SCAN_URL,
        cronSecret: 's3cr3t',
      }),
    ).toEqual([])
    expect(
      describeScanJobDiff(
        { ...CANONICAL_LIST_ENTRY, enabled: false },
        canonicalDetails('Bearer stale').jobDetails,
        { url: SCAN_URL, cronSecret: 's3cr3t' },
      ),
    ).toEqual(['enabled', 'auth'])
  })
})

describe('setScanJobEnabled', () => {
  it('skips the PATCH when the job already has the wanted state', async () => {
    const { calls, fetchImpl } = mockFetch([
      {
        method: 'GET',
        path: '/jobs',
        status: 200,
        payload: { jobs: [{ jobId: 7, url: SCAN_URL, enabled: false }] },
      },
    ])
    await expect(setScanJobEnabled({ apiKey: 'key', url: SCAN_URL, enabled: false }, { fetchImpl })).resolves.toEqual(
      { jobId: 7, changed: false },
    )
    expect(calls).toHaveLength(1)
  })

  it('reports a miss without writing', async () => {
    const { fetchImpl } = mockFetch([{ method: 'GET', path: '/jobs', status: 200, payload: { jobs: [] } }])
    await expect(setScanJobEnabled({ apiKey: 'key', url: SCAN_URL, enabled: false }, { fetchImpl })).resolves.toEqual(
      { jobId: null, changed: false },
    )
  })
})
