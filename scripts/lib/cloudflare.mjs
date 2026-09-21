#!/usr/bin/env node
// Shared Cloudflare Pages project helpers: ensure the Pages project exists
// before steps that need it (`secret put`, `pages deploy`), mirroring
// `ensureRemoteProject` in `scripts/deploy.mjs` for Vercel.
//
// The runner is injectable so tests can stub wrangler without network; the
// default uses spawnSync like the other scripts.
import { spawnSync } from 'node:child_process'

import { LOCAL_ONLY_ENV_KEYS } from '../env-file.mjs'

// Generated wrangler config must sit at the project root under a standard
// name: `wrangler pages deploy` rejects a custom `--config` path and only
// auto-discovers `wrangler.json`/`wrangler.jsonc`/`wrangler.toml` in cwd. The
// file is gitignored and regenerated from the overlay on every run.
export const GENERATED_WRANGLER_CONFIG = 'wrangler.toml'

// Static Pages stanza: compat + build output. [vars] below is rewritten by
// renderWranglerConfig (pruned to desired), so per-target values live in
// `.env.prod` + `.env.cloudflare`, never here.
const WRANGLER_STATIC_STANZA = ['compatibility_date = "2026-09-01"', 'compatibility_flags = ["nodejs_compat"]', 'pages_build_output_dir = ".svelte-kit/cloudflare"', '']

// `npx wrangler` pays package resolution on every invocation; a PATH
// wrangler skips it. Resolved once per process (every caller is short-lived,
// so no staleness concern); falls back to npx when absent.
let resolvedWranglerBin = null
export function wranglerBin() {
  if (!resolvedWranglerBin) {
    const probe = spawnSync('command -v wrangler', { shell: true, encoding: 'utf8' })
    resolvedWranglerBin = probe.status === 0 && probe.stdout.trim() ? 'wrangler' : 'npx'
  }
  return resolvedWranglerBin
}

export function defaultWranglerRunner(args, { cwd, input, capture = false } = {}) {
  const bin = wranglerBin()
  // No `--config`: Pages rejects custom config paths, and the generated root
  // config is auto-discovered from `cwd`.
  const fullArgs = bin === 'npx' ? ['wrangler', ...args] : args
  const result = spawnSync(bin, fullArgs, {
    cwd,
    encoding: 'utf8',
    input,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
  })
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

export function listPagesProjects(runner = defaultWranglerRunner, cwd = process.cwd()) {
  // `--json` (never the table): machine-read, no box-drawing parse.
  const { status, output } = runner(['pages', 'project', 'list', '--json'], { cwd, capture: true })
  if (status !== 0) {
    throw new Error(`wrangler pages project list failed (exit ${status}).`)
  }
  return output
}

function parsePagesProjects(output) {
  try {
    const parsed = JSON.parse(String(output || ''))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function projectEntry(project, output) {
  return parsePagesProjects(output).find(entry => String(entry?.['Project Name'] || '').trim() === project)
}

// Production hostname for a Pages project, from `pages project list --json`
// (authoritative: the account may suffix the subdomain, e.g.
// project-catalog-b1s.pages.dev for project-catalog). Bare hostname, or ''
// when unresolvable.
export function getPagesProjectDomain(project, runner = defaultWranglerRunner, cwd = process.cwd()) {
  let output = ''
  try {
    const result = runner(['pages', 'project', 'list', '--json'], { cwd, capture: true })
    if (result.status !== 0) {
      return ''
    }
    output = result.output
  } catch (error) {
    console.warn(`-> Could not list Cloudflare Pages projects (${error?.message || error}).`)
    return ''
  }
  const entry = projectEntry(project, output)
  if (!entry) {
    return ''
  }
  const domains = String(entry?.['Project Domains'] || '')
    .split(/[,\s]+/)
    .map(domain => domain.trim())
    .filter(Boolean)
  const production = domains.find(domain => domain.endsWith('.pages.dev')) ?? domains[0] ?? ''
  return production.replace(/^https?:\/\//, '')
}

// Production branch for a new Pages project: the checkout's current branch
// (this repo deploys from master). Direct-upload deploys ignore it, but the
// create API requires a value.
export function detectProductionBranch(cwd = process.cwd()) {
  try {
    const result = spawnSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' })
    const branch = String(result.stdout || '').trim()
    if (branch) {
      return branch
    }
    console.warn('-> git reported no current branch; using "main" for the Pages project.')
  } catch (error) {
    console.warn(`-> Could not read the git branch (${error?.message || error}); using "main".`)
  }
  return 'main'
}

export function ensurePagesProject(
  project,
  runner = defaultWranglerRunner,
  cwd = process.cwd(),
  productionBranch = detectProductionBranch(cwd),
) {
  const output = listPagesProjects(runner, cwd)
  // JSON entries: match the name exactly (prefix names must not collide).
  const exists = parsePagesProjects(output).some(
    entry => String(entry?.['Project Name'] || '').trim() === project,
  )
  if (exists) {
    return 'exists'
  }
  console.log(`-> Creating Cloudflare Pages project ${project}...`)
  const created = runner(['pages', 'project', 'create', project, '--production-branch', productionBranch], { cwd })
  if (created.status !== 0) {
    throw new Error(
      `Failed to create Cloudflare Pages project ${project} (exit ${created.status}). Create it in the dashboard and retry.`,
    )
  }
  return 'created'
}

// Pages project name: the `CLOUDFLARE_PROJECT` overlay key owns it (mirrors
// VERCEL_PROJECT for Vercel); a stale generated config is the fallback so a
// checkout that predates the key keeps working. `merged` is the unified
// target env (loadTargetEnv('cloudflare')); `generatedName` lets tests inject
// the file value without touching disk.
export function resolveCloudflareProjectName(merged = {}, generatedName = '') {
  const fromOverlay = String(merged?.CLOUDFLARE_PROJECT || '').trim()
  if (fromOverlay) {
    return fromOverlay
  }
  return String(generatedName || '').trim()
}

// Splits a file-env merge into the generator inputs: `project` from the
// overlay, `vars` (plain [vars], forced CF_PAGES/PROFILE applied at render),
// `secrets` (secret-store only). Local-only keys never sync; empty values
// keep the remote value. Shared by sync-cloudflare-env.mjs and deploy.mjs
// (auth-step generation) so the split cannot drift.
export const CLOUDFLARE_SECRET_KEYS = new Set([
  'PROJECT_CATALOG_DATABASE_URL',
  'DATABASE_URL',
  'ADMIN_PASSWORD',
  'ADMIN_PASSWORD_HASH',
  'SESSION_SECRET',
  'CRON_SECRET',
  'VERCEL_TOKEN',
  'VERCEL_PROJECT_CATALOG_ACCOUNTS',
  'VERCEL_ACCOUNT_NAME',
  'VERCEL_TEAM_ID',
  'VERCEL_TEAM_SLUG',
])

export const CLOUDFLARE_LOCAL_ONLY_KEYS = LOCAL_ONLY_ENV_KEYS

export function splitCloudflareEnv(raw = {}) {
  const project = String(raw?.CLOUDFLARE_PROJECT || '').trim()
  const vars = {}
  const secrets = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!value || CLOUDFLARE_LOCAL_ONLY_KEYS.has(key)) continue
    if (CLOUDFLARE_SECRET_KEYS.has(key)) {
      secrets[key] = value
    } else {
      vars[key] = value
    }
  }
  return { project, vars, secrets }
}

// Build vars forced into every Pages deploy, placed last so the overlay can
// never set a dev profile or a non-CF build. Single source of truth for the
// renderer and the env-var diff (sync-cloudflare-env.mjs compares the same
// set it renders).
export const FORCED_PAGES_VARS = { CF_PAGES: '1', PROFILE: 'prod' }

// Desired `[vars]` for a Pages deploy: overlay vars with the forced build
// vars last. Callers pass the result to renderWranglerConfig and to the
// remote diff, so the deployed set and the compared set cannot drift.
export function desiredPagesVars(vars = {}) {
  return { ...vars, ...FORCED_PAGES_VARS }
}

// Renders the generated wrangler config: `name` from the overlay, the static
// Pages stanza, and `[vars]` pruned to exactly `vars`. Local-only keys must
// already be excluded by the caller, and the forced build vars come from
// desiredPagesVars. Pure (string in, string out) so tests assert it without
// disk.
export function renderWranglerConfig({ project, vars = {} }) {
  const lines = [`name = ${JSON.stringify(project)}`, ...WRANGLER_STATIC_STANZA, '[vars]']
  for (const [key, value] of Object.entries(vars)) {
    lines.push(`${key} = ${JSON.stringify(String(value))}`)
  }
  return `${lines.join('\n')}\n`
}
