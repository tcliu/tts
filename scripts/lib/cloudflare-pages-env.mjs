#!/usr/bin/env node
// Cloudflare Pages project env-var access: reads the production `env_vars`
// map (the only place remote values are observable — `plain_text` carries its
// value, `secret_text` comes back with an empty value, so secret content is
// write-only) and merge-patches/deletes individual keys. Used by
// `sync-cloudflare-env.mjs` to write only missing/updated vars and to prune
// keys that left the .env files. Fetch is injectable so unit tests never touch
// the network.
export const CF_API_BASE = 'https://api.cloudflare.com/client/v4'
export const PAGES_ENV_TARGET = 'production'

function apiError(status, payload) {
  const detail = (payload?.errors || [])
    .map(error => error?.message)
    .filter(Boolean)
    .join('; ')
  return new Error(`Cloudflare API ${status}${detail ? `: ${detail}` : ''}`)
}

function projectPath(project) {
  return `/pages/projects/${encodeURIComponent(project)}`
}

async function pagesRequest({ path, method = 'GET', body, accountId, token, fetchImpl = globalThis.fetch }) {
  if (!String(token || '').trim()) {
    throw new Error('CLOUDFLARE_API_TOKEN is empty: cannot read or prune Pages env vars.')
  }
  if (!String(accountId || '').trim()) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID is empty: cannot read or prune Pages env vars.')
  }
  const response = await fetchImpl(`${CF_API_BASE}/accounts/${accountId}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.success === false) {
    throw apiError(response.status, payload)
  }
  return payload.result ?? {}
}

// Remote production env state: the `env_vars` map plus the wrangler config
// hash the delete path mirrors (the API expects the current hash back, as
// `wrangler pages secret delete` does).
export async function fetchPagesEnvState({
  project,
  accountId,
  token,
  fetchImpl,
  environment = PAGES_ENV_TARGET,
}) {
  const result = await pagesRequest({
    path: projectPath(project),
    accountId,
    token,
    fetchImpl,
  })
  const config = result?.deployment_configs?.[environment] ?? {}
  return {
    envVars: config.env_vars ?? {},
    configHash: config.wrangler_config_hash,
  }
}

// Merge-patches env vars: keys absent from `envVars` are untouched and a null
// value deletes the key (verified against the live API). One call can add,
// update, and delete together.
export async function patchPagesEnvVars({
  project,
  envVars,
  configHash,
  accountId,
  token,
  fetchImpl,
  environment = PAGES_ENV_TARGET,
}) {
  if (!envVars || Object.keys(envVars).length === 0) {
    return
  }
  await pagesRequest({
    path: projectPath(project),
    method: 'PATCH',
    body: {
      deployment_configs: {
        [environment]: {
          env_vars: envVars,
          ...(configHash ? { wrangler_config_hash: configHash } : {}),
        },
      },
    },
    accountId,
    token,
    fetchImpl,
  })
}

// Drift between the desired plain vars and the remote `env_vars` map. `missing`
// and `changed` are what a sync must write; `unchanged` is skipped. A key
// stored remotely as `secret_text` (or with a different value) reads as
// `changed`, so a var/secret name collision converges to the plain var.
export function diffDesiredVars(desiredVars = {}, remoteEnvVars = {}) {
  const missing = []
  const changed = []
  const unchanged = []
  for (const [key, value] of Object.entries(desiredVars)) {
    const remote = remoteEnvVars[key]
    if (!remote) {
      missing.push(key)
    } else if (remote.type !== 'plain_text' || String(remote.value ?? '') !== String(value)) {
      changed.push(key)
    } else {
      unchanged.push(key)
    }
  }
  return { missing, changed, unchanged, drift: [...missing, ...changed] }
}

// Secret drift by name only: values are never returned, so `present` cannot be
// told apart from a rotated value (that is why `--secrets=always` stays the
// default).
export function diffDesiredSecrets(desiredSecrets = {}, remoteEnvVars = {}) {
  const missing = []
  const present = []
  for (const key of Object.keys(desiredSecrets)) {
    if (remoteEnvVars[key]) {
      present.push(key)
    } else {
      missing.push(key)
    }
  }
  return { missing, present }
}

// Remote keys absent from the desired universe (vars + secrets). Prune
// candidates; the caller decides which types to act on (plain vars are
// reconciled by the deploy, so only secrets need an explicit delete).
export function findOrphanKeys(remoteEnvVars = {}, desiredKeys = []) {
  const wanted = new Set(desiredKeys)
  return Object.keys(remoteEnvVars).filter(key => !wanted.has(key))
}
