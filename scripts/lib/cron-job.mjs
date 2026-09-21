#!/usr/bin/env node
// Minimal cron-job.org REST client (https://docs.cron-job.org/rest-api.html).
//
// There is no official Node.js SDK or CLI for cron-job.org, and the API is
// small enough (GET/PUT/PATCH /jobs) that plain fetch covers it with no new
// dependency. Auth is a console-issued API key ("Settings" in the cron-job.org
// console, CRONJOB_API_KEY here) sent as `Authorization: Bearer <key>` — never
// confuse it with the app's CRON_SECRET, which is the bearer token the scan
// job itself sends to GET /api/cron/scan via extendedData headers.
//
// All functions take an injectable fetchImpl so unit tests never touch the
// network; nothing in this module prints secrets.
export const CRON_JOB_API_BASE = 'https://api.cron-job.org'
export const SCAN_JOB_TITLE = 'tts auto-scan'

// One scan job per running app, told apart by title: the Vercel job keeps the
// original title so the live job migrates in place (URL match + title patch,
// never a duplicate); the Cloudflare job gets a suffixed title so the two
// never match each other by the title fallback in findScanJob.
export function scanJobTitle(target = 'vercel') {
  return target === 'cloudflare' ? `${SCAN_JOB_TITLE} (cloudflare)` : SCAN_JOB_TITLE
}

// Every-minute heartbeat in UTC: the endpoint re-checks scan_auto_enabled +
// scan_auto_cron on every call, so the heartbeat must tick at least as often
// as the finest schedule it may drive (default scan_auto_cron is * * * * *).
export const EVERY_MINUTE_UTC = {
  timezone: 'UTC',
  expiresAt: 0,
  hours: [-1],
  mdays: [-1],
  minutes: [-1],
  months: [-1],
  wdays: [-1],
}

export class CronJobApiError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'CronJobApiError'
    this.status = status
  }
}

function apiErrorMessage(status, payload) {
  if (status === 401) return 'Invalid cron-job.org API key (401).'
  if (status === 403) return 'cron-job.org API key rejected for this origin (403).'
  if (status === 404) return 'cron-job.org job not found (404).'
  if (status === 409) return 'cron-job.org resource conflict (409).'
  if (status === 429) return 'cron-job.org quota or rate limit exceeded (429).'
  const detail = payload && typeof payload === 'object' ? JSON.stringify(payload) : String(payload ?? '')
  return `cron-job.org request failed (${status})${detail ? `: ${detail}` : '.'}`
}

export async function cronJobRequest({ apiKey, method, path, body, fetchImpl = globalThis.fetch }) {
  if (!String(apiKey || '').trim()) {
    throw new CronJobApiError(0, 'Missing cron-job.org API key.')
  }
  const response = await fetchImpl(`${CRON_JOB_API_BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiKey}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok) {
    throw new CronJobApiError(response.status, apiErrorMessage(response.status, payload))
  }
  return payload ?? {}
}

export function normalizeJobUrl(value) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase()
}

// The scan job is identified by its target URL (the /api/cron/scan endpoint),
// which survives title edits in the console; when no job targets the URL
// (e.g. APP_BASE_URL changed since the last sync), the target's canonical
// title is the fallback so sync patches the stale job instead of creating a
// duplicate. The fallback is target-scoped: a Cloudflare sync must never
// match (and repoint) the Vercel job, and vice versa.
export function findScanJob(jobs, url, target = 'vercel') {
  const list = Array.isArray(jobs) ? jobs : []
  const wanted = normalizeJobUrl(url)
  if (!wanted) return null
  const title = scanJobTitle(target)
  const matches = list.filter(job => normalizeJobUrl(job?.url) === wanted)
  if (matches.length > 0) {
    return matches.find(job => job?.title === title) ?? matches[0]
  }
  return list.find(job => job?.title === title) ?? null
}

// Full job body for create, delta for update: GET-equivalent heartbeat with
// the app's CRON_SECRET as its Authorization header.
export function buildScanJobPayload({ url, cronSecret, enabled, target = 'vercel' }) {
  return {
    url,
    enabled,
    title: scanJobTitle(target),
    saveResponses: true,
    requestMethod: 0,
    requestTimeout: 60,
    schedule: { ...EVERY_MINUTE_UTC },
    extendedData: { headers: { Authorization: `Bearer ${cronSecret}` }, body: '' },
  }
}

export async function listCronJobs(apiKey, { fetchImpl = globalThis.fetch } = {}) {
  const payload = await cronJobRequest({ apiKey, method: 'GET', path: '/jobs', fetchImpl })
  return Array.isArray(payload?.jobs) ? payload.jobs : []
}

export async function getCronJobDetails(apiKey, jobId, { fetchImpl = globalThis.fetch } = {}) {
  const payload = await cronJobRequest({ apiKey, method: 'GET', path: `/jobs/${jobId}`, fetchImpl })
  return payload?.jobDetails ?? {}
}

function schedulesEqual(a, b) {
  for (const key of ['timezone', 'expiresAt', 'hours', 'mdays', 'minutes', 'months', 'wdays']) {
    if (JSON.stringify(a?.[key] ?? null) !== JSON.stringify(b?.[key] ?? null)) {
      return false
    }
  }
  return true
}

// List-visible drift from the canonical payload (GET /jobs omits
// extendedData, so auth is compared separately from the details fetch).
function listPartDiff(existing, { url, enabled, target = 'vercel' }) {
  const diff = []
  if (normalizeJobUrl(existing?.url) !== normalizeJobUrl(url)) diff.push('url')
  if (Boolean(existing?.enabled) !== Boolean(enabled)) diff.push('enabled')
  if (String(existing?.title ?? '') !== scanJobTitle(target)) diff.push('title')
  if (existing?.saveResponses !== true) diff.push('saveResponses')
  if ((existing?.requestMethod ?? null) !== 0) diff.push('requestMethod')
  if ((existing?.requestTimeout ?? null) !== 60) diff.push('requestTimeout')
  if (!schedulesEqual(existing?.schedule, EVERY_MINUTE_UTC)) diff.push('schedule')
  return diff
}

function authDiff(details, { cronSecret }) {
  const headers = details?.extendedData?.headers ?? {}
  if (String(headers.Authorization ?? '') !== `Bearer ${cronSecret}`) return ['auth']
  if (String(details?.extendedData?.body ?? '') !== '') return ['body']
  return []
}

// Field names that differ from the canonical scan payload, without secret
// values: safe to show in an overwrite prompt.
export function describeScanJobDiff(existing, details, { url, cronSecret, enabled = true, target = 'vercel' }) {
  return [...listPartDiff(existing, { url, enabled, target }), ...authDiff(details, { cronSecret })]
}

// Create the scan job when no job targets url yet; patch a differing match
// back to the canonical payload (re-enables a console-disabled job); skip
// the PATCH when the match is already canonical. confirmOverwrite decides
// whether a differing job may be patched (the heartbeat driver prompts when
// interactive); omitted means overwrite, so non-interactive callers keep the
// deterministic upsert.
export async function syncScanJob({ apiKey, url, cronSecret, enabled = true, target = 'vercel' }, deps = {}) {
  if (!String(cronSecret || '').trim()) {
    throw new CronJobApiError(0, 'Missing CRON_SECRET for the scan job header.')
  }
  if (!String(url || '').trim()) {
    throw new CronJobApiError(0, 'Missing scan endpoint URL.')
  }
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  const confirmOverwrite = deps.confirmOverwrite
  const getDetails = deps.getDetails ?? getCronJobDetails
  const jobs = await listCronJobs(apiKey, { fetchImpl })
  const existing = findScanJob(jobs, url, target)
  const payload = buildScanJobPayload({ url, cronSecret, enabled, target })
  if (!existing) {
    const created = await cronJobRequest({
      apiKey,
      method: 'PUT',
      path: '/jobs',
      body: { job: payload },
      fetchImpl,
    })
    return { jobId: created?.jobId ?? null, created: true }
  }
  // GET /jobs omits extendedData, so the secret needs the details fetch. A
  // failed details read degrades to auth-unknown (still prompts, then
  // PATCHes) rather than failing the deploy on a transient read.
  let details = null
  let detailsFailed = false
  try {
    details = await getDetails(apiKey, existing.jobId, { fetchImpl })
  } catch {
    detailsFailed = true
  }
  const diff = detailsFailed
    ? [...listPartDiff(existing, { url, enabled, target }), 'auth']
    : describeScanJobDiff(existing, details, { url, cronSecret, enabled, target })
  if (diff.length === 0) {
    return { jobId: existing.jobId, created: false, updated: false, reason: 'up-to-date' }
  }
  if (confirmOverwrite && !(await confirmOverwrite({ existing, diff }))) {
    return { jobId: existing.jobId, created: false, updated: false, reason: 'declined' }
  }
  await cronJobRequest({
    apiKey,
    method: 'PATCH',
    path: `/jobs/${existing.jobId}`,
    body: { job: payload },
    fetchImpl,
  })
  return { jobId: existing.jobId, created: false, updated: true }
}

// Toggle-only disable for provider switches: leaves the job in place so
// switching back re-enables it without losing console history.
export async function setScanJobEnabled({ apiKey, url, enabled, target = 'vercel' }, deps = {}) {
  const jobs = await listCronJobs(apiKey, deps)
  const existing = findScanJob(jobs, url, target)
  if (!existing) {
    return { jobId: null, changed: false }
  }
  if (Boolean(existing.enabled) === enabled) {
    return { jobId: existing.jobId, changed: false }
  }
  await cronJobRequest({
    apiKey,
    method: 'PATCH',
    path: `/jobs/${existing.jobId}`,
    body: { job: { enabled } },
    fetchImpl: deps.fetchImpl ?? globalThis.fetch,
  })
  return { jobId: existing.jobId, changed: true }
}
