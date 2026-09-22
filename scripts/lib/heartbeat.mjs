#!/usr/bin/env node
// Shared prod heartbeat driver: syncs the cron-job.org scan job that calls
// GET /api/cron/scan. Used by `scripts/deploy.mjs` (as one deploy
// step) and `scripts/heartbeat.mjs` (standalone switch, no deploy).
//
// Hard failures throw (callers turn them into their own fail path). Secrets
// pass in memory only, never via argv, and are never printed.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTargetEnv } from './target-env.mjs'
import { logEvent } from '../log-event.mjs'
import { c, promptYesNo } from '../_terminal.mjs'
import { setScanJobEnabled, syncScanJob } from './cron-job.mjs'
import { withPrompt } from './prompt-queue.mjs'

const LIB_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = join(LIB_DIR, '..', '..')

export const HEARTBEAT_PROVIDERS = ['cron-job', 'none']

// Whether this app serves the heartbeat endpoint the scan job calls. Apps
// without the cron route (no scan domain) skip heartbeat wiring entirely so
// one deploy shape fits every project; a present route with missing secrets
// still fails fast in the sync below. `root` is injectable so tests can point
// at a fixture dir; production callers omit it (repo root).
export function isHeartbeatSupported(root = DEFAULT_ROOT) {
  return existsSync(join(root, 'src', 'routes', 'api', 'cron', 'scan', '+server.ts'))
}

export const HEARTBEAT_CHOICES = [
  { value: 'cron-job', label: 'cron-job.org', description: 'upsert + enable the scan job (needs CRONJOB_API_KEY)' },
  { value: 'none', label: 'None', description: 'disable the scan job' },
]

// Whether the deploy interview must ask the heartbeat question: only when
// the caller gave no explicit choice and wiring is possible (the app serves
// the cron endpoint and the operator API key is available). Otherwise the
// deploy skips it silently ('skip'). `root`/`apiKey` are injectable so tests
// stay hermetic (defaults read the real checkout and env, Vercel-target
// merge for the key — every target merge carries .env.local/shell).
export function shouldAskHeartbeat({ heartbeat = '', root = DEFAULT_ROOT, apiKey } = {}) {
  if (['cron-job', 'none'].includes(heartbeat)) {
    return false
  }
  return isHeartbeatSupported(root) && isHeartbeatConfigurable(apiKey === undefined ? {} : { apiKey })
}

// Picker chrome shared by the deploy and heartbeat interviews; hint names the
// default the picker preselects via defaultValue.
export function renderOptionPicker(hint = 'default yes') {
  return (entries, state) => {
    const lines = []
    for (let i = 0; i < entries.length; i++) {
      const item = entries[i]
      const cursor = i === state.cursor ? `${c.cyan}>${c.reset}` : ' '
      lines.push(` ${cursor} ${c.green}${item.label}${c.reset} ${c.gray}(${item.description})${c.reset}`)
    }
    lines.push('', `${c.dim}Up/Down: move | Enter: confirm (${hint}) | q: cancel${c.reset}`)
    return lines
  }
}

export function heartbeatSecrets(target = 'vercel') {
  // Unified load order (`.env` < `.env.local` < `.env.prod` < overlay <
  // shell) via target-env; previously the Cloudflare deploy merge omitted
  // `.env.local`.
  const merged = loadTargetEnv(target)
  return {
    cronSecret: String(merged.CRON_SECRET || '').trim(),
    baseUrl: String(merged.APP_BASE_URL || '').trim(),
    apiKey: String(merged.CRONJOB_API_KEY || '').trim(),
  }
}

export function scanEndpointUrl(baseUrl) {
  return `${baseUrl.replace(/\/$/, '')}/api/cron/scan`
}

// Whether heartbeat wiring can do anything: without the operator API key no
// job can be created, read, or disabled, so callers skip the interview node
// and the wiring instead of prompting for a dead choice. With no argument the
// key comes from the merged target env (shell, .env.local); tests inject it
// directly to stay hermetic.
export function isHeartbeatConfigurable({ apiKey } = {}) {
  const key = apiKey === undefined ? heartbeatSecrets().apiKey : apiKey
  return String(key || '').trim() !== ''
}

// Interactive guard for the sync below: a differing job prompts before the
// PATCH (the diff names fields only, never secret values). Non-interactive
// callers keep the overwrite so `--heartbeat cron-job` stays deterministic.
export async function confirmScanJobOverwrite({ existing, diff }) {
  if (!process.stdin.isTTY) {
    return true
  }
  const fields = diff.length > 0 ? diff.join(', ') : 'settings'
  return withPrompt(() =>
    promptYesNo(
      `cron-job.org scan job ${existing?.jobId ?? 'unknown'} differs (${fields}). Overwrite with the canonical every-minute config`,
      true,
      process.stderr,
    ),
  )
}

// Sync for the cron-job provider: creates the scan job when missing, patches
// a differing match back to canonical (prompting first when interactive),
// and skips the PATCH when the match is already canonical. Throws: an
// explicit choice with no working job would silently leave prod without a
// heartbeat. Unsupported apps (no cron endpoint) skip with a notice instead.
export async function syncCronJobHeartbeat(target = 'vercel', { confirmOverwrite = confirmScanJobOverwrite, root = DEFAULT_ROOT, baseUrl } = {}) {
  if (!isHeartbeatSupported(root)) {
    logEvent({ action: 'heartbeat_unsupported_skip', details: { operation: 'sync' } })
    return
  }
  const { cronSecret, baseUrl: envBaseUrl, apiKey } = heartbeatSecrets(target)
  // An explicit baseUrl wins: the Cloudflare deploy derives the production
  // URL from the Pages project (no APP_BASE_URL on that target) and passes
  // it in; every other caller reads the overlay key.
  const resolvedBaseUrl = String(baseUrl || envBaseUrl || '').trim()
  if (!apiKey) {
    throw new Error('CRONJOB_API_KEY is empty: set it in the shell env or .env.local (cron-job.org console Settings > API key; .env.local is never synced to Vercel).')
  }
  if (!cronSecret || !resolvedBaseUrl) {
    throw new Error('CRON_SECRET is empty or the target has no base URL: the scan job needs both.')
  }
  const url = scanEndpointUrl(resolvedBaseUrl)
  logEvent({ action: 'heartbeat_sync', details: { url, target } })
  try {
    const { jobId, created, updated, reason } = await syncScanJob(
      { apiKey, url, cronSecret, enabled: true, target },
      { confirmOverwrite },
    )
    const outcome = created
      ? 'created'
      : updated
        ? 'updated'
        : reason === 'declined'
          ? 'kept (overwrite declined)'
          : 'already up to date'
    logEvent({ action: 'heartbeat_synced', details: { jobId, outcome, target } })
  } catch (error) {
    throw new Error(`Failed to sync the cron-job.org scan job: ${error?.message || error}`)
  }
}

// Disable for the none provider. A missing job is a clean
// no-op. Unsupported apps (no cron endpoint) skip with a notice instead.
export async function disableCronJobHeartbeat(target = 'vercel', { root = DEFAULT_ROOT, baseUrl } = {}) {
  if (!isHeartbeatSupported(root)) {
    logEvent({ action: 'heartbeat_unsupported_skip', details: { operation: 'disable' } })
    return
  }
  const { baseUrl: envBaseUrl, apiKey } = heartbeatSecrets(target)
  const resolvedBaseUrl = String(baseUrl || envBaseUrl || '').trim()
  if (!apiKey) {
    logEvent({
      action: 'heartbeat_disable_skip',
      details: { reason: 'missing CRONJOB_API_KEY', level: 'WARN' },
    })
    return
  }
  if (!resolvedBaseUrl) {
    logEvent({ action: 'heartbeat_disable_skip', details: { reason: 'missing base URL', level: 'WARN' } })
    return
  }
  try {
    const { jobId, changed } = await setScanJobEnabled({
      apiKey,
      url: scanEndpointUrl(resolvedBaseUrl),
      enabled: false,
      target,
    })
    if (jobId === null) {
      logEvent({ action: 'heartbeat_disabled', details: { jobId: null, changed: false, note: 'no job found' } })
    } else {
      logEvent({ action: 'heartbeat_disabled', details: { jobId, changed } })
    }
  } catch (error) {
    logEvent({ action: 'heartbeat_disable_error', details: { error: error?.message || error } })
  }
}

const defaultSteps = {
  syncCronJobHeartbeat,
  disableCronJobHeartbeat,
}

// Applies a provider selection for a target. Steps are injectable so tests
// can assert the routing matrix without touching the network. `options` (a
// `baseUrl` override today) passes through to the steps untouched.
export async function applyHeartbeat(provider, steps = defaultSteps, target = 'vercel', options = {}) {
  if (provider === 'cron-job') {
    await steps.syncCronJobHeartbeat(target, options)
  } else if (provider === 'none') {
    await steps.disableCronJobHeartbeat(target, options)
  } else {
    throw new Error(`Unknown heartbeat: ${provider} (expected cron-job|none).`)
  }
}
