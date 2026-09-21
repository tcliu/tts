#!/usr/bin/env node
// Shared prod heartbeat driver: syncs the cron-job.org scan job that calls
// GET /api/cron/scan. Used by `scripts/deploy.mjs` (as one deploy
// step) and `scripts/heartbeat.mjs` (standalone switch, no deploy).
//
// Hard failures throw (callers turn them into their own fail path). Secrets
// pass in memory only, never via argv, and are never printed.
import { loadTargetEnv } from './target-env.mjs'
import { c, promptYesNo } from '../_terminal.mjs'
import { setScanJobEnabled, syncScanJob } from './cron-job.mjs'
import { withPrompt } from './prompt-queue.mjs'

export const HEARTBEAT_PROVIDERS = ['cron-job', 'none']

export const HEARTBEAT_CHOICES = [
  { value: 'cron-job', label: 'cron-job.org', description: 'upsert + enable the scan job (needs CRONJOB_API_KEY)' },
  { value: 'none', label: 'None', description: 'disable the scan job' },
]

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
// heartbeat.
export async function syncCronJobHeartbeat(target = 'vercel', { confirmOverwrite = confirmScanJobOverwrite } = {}) {
  const { cronSecret, baseUrl, apiKey } = heartbeatSecrets(target)
  if (!apiKey) {
    throw new Error('CRONJOB_API_KEY is empty: set it in the shell env or .env.local (cron-job.org console Settings > API key; .env.local is never synced to Vercel).')
  }
  if (!cronSecret || !baseUrl) {
    throw new Error('CRON_SECRET or APP_BASE_URL is empty: the scan job needs both.')
  }
  const url = scanEndpointUrl(baseUrl)
  console.log(`-> Syncing cron-job.org scan job -> ${url}...`)
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
    console.log(`-> cron-job.org scan job ${outcome} (jobId ${jobId ?? 'unknown'}, every minute UTC).`)
  } catch (error) {
    throw new Error(`Failed to sync the cron-job.org scan job: ${error?.message || error}`)
  }
}

// Disable for the none provider. A missing job is a clean
// no-op.
export async function disableCronJobHeartbeat(target = 'vercel') {
  const { baseUrl, apiKey } = heartbeatSecrets(target)
  if (!apiKey) {
    console.error('-> CRONJOB_API_KEY is empty; skipping cron-job.org disable (switch the scan job off in the console if it exists).')
    return
  }
  if (!baseUrl) {
    console.error('-> APP_BASE_URL is empty; skipping cron-job.org disable.')
    return
  }
  try {
    const { jobId, changed } = await setScanJobEnabled({
      apiKey,
      url: scanEndpointUrl(baseUrl),
      enabled: false,
      target,
    })
    if (jobId === null) {
      console.log('-> No cron-job.org scan job found; nothing to disable.')
    } else if (changed) {
      console.log(`-> cron-job.org scan job disabled (jobId ${jobId}).`)
    } else {
      console.log(`-> cron-job.org scan job already disabled (jobId ${jobId}).`)
    }
  } catch (error) {
    console.error(`-> Failed to disable the cron-job.org scan job: ${error?.message || error}. Switch it off in the console.`)
  }
}

const defaultSteps = {
  syncCronJobHeartbeat,
  disableCronJobHeartbeat,
}

// Applies a provider selection for a target. Steps are injectable so tests
// can assert the routing matrix without touching the network.
export async function applyHeartbeat(provider, steps = defaultSteps, target = 'vercel') {
  if (provider === 'cron-job') {
    await steps.syncCronJobHeartbeat(target)
  } else if (provider === 'none') {
    await steps.disableCronJobHeartbeat(target)
  } else {
    throw new Error(`Unknown heartbeat: ${provider} (expected cron-job|none).`)
  }
}
