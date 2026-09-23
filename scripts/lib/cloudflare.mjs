#!/usr/bin/env node
// Shared Cloudflare Pages project helpers: ensure the Pages project exists
// before steps that need it (`secret put`, `pages deploy`), mirroring
// `ensureRemoteProject` in `scripts/deploy.mjs` for Vercel.
//
// The runner is injectable so tests can stub wrangler without network; the
// default uses spawnSync like the other scripts.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { LOCAL_ONLY_ENV_KEYS } from '../env-file.mjs'
import { loadTargetEnv } from './target-env.mjs'

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

// Last non-empty lines of captured wrangler output, so failures carry the
// platform's own reason (bad token, missing account, network) instead of a
// bare exit code. Never includes credential values: wrangler prints
// diagnostics, not the token itself.
export function tailWranglerOutput(output, maxLines = 8) {
  return String(output || '')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== '')
    .slice(-maxLines)
    .join('\n')
    .trim()
}

export function listPagesProjects(runner = defaultWranglerRunner, cwd = process.cwd()) {
  // `--json` (never the table): machine-read, no box-drawing parse.
  const { status, output } = runner(['pages', 'project', 'list', '--json'], { cwd, capture: true })
  if (status !== 0) {
    const detail = tailWranglerOutput(output)
    throw new Error(`wrangler pages project list failed (exit ${status})${detail ? `: ${detail}` : '.'}`)
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
      const detail = tailWranglerOutput(result.output)
      console.warn(`-> Could not list Cloudflare Pages projects (exit ${result.status}${detail ? `: ${detail}` : ''}).`)
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
    const detail = tailWranglerOutput(created.output)
    throw new Error(
      `Failed to create Cloudflare Pages project ${project} (exit ${created.status})${detail ? `: ${detail}` : '.'} Create it in the dashboard and retry.`,
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

// Project name from the last generated config: fallback so a checkout that
// predates CLOUDFLARE_PROJECT keeps working. Shared by the env sync and the
// deploy/heartbeat flows so the fallback cannot drift.
export function generatedWranglerProjectName(root = process.cwd()) {
  try {
    const content = readFileSync(join(root, GENERATED_WRANGLER_CONFIG), 'utf8')
    return /^name\s*=\s*"([^"]+)"/m.exec(content)?.[1] || ''
  } catch {
    return ''
  }
}

// Production app URL for the Cloudflare target, derived from the Pages
// project instead of APP_BASE_URL: the live hostname is the production
// domain (the account may suffix the subdomain), so no overlay key can
// disagree with it. `env` is injectable so tests stay hermetic (the default
// reads the real target env, shell included); the wrangler runner is
// injectable for the same reason. Throws when the project or its production
// domain cannot be resolved.
export function resolveCloudflareAppUrl({ root = process.cwd(), runner = defaultWranglerRunner, env } = {}) {
  const merged = env ?? loadTargetEnv('cloudflare', root)
  const project = resolveCloudflareProjectName(merged, generatedWranglerProjectName(root))
  if (!project) {
    throw new Error('Missing CLOUDFLARE_PROJECT in .env.cloudflare: set it to the Pages project name.')
  }
  const host = getPagesProjectDomain(project, runner, root)
  if (!host) {
    throw new Error(
      `Could not resolve the Pages production domain for project ${project}: check wrangler auth and retry.`,
    )
  }
  return `https://${host}`
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
  'CLOUDFLARE_SCAN_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'VERCEL_TOKEN',
  'VERCEL_PROJECT_CATALOG_ACCOUNTS',
  'VERCEL_ACCOUNT_NAME',
  'VERCEL_TEAM_ID',
  'VERCEL_TEAM_SLUG',
])

// Keys that must never exist on the Cloudflare Pages project, whatever the
// app: a synced Neon URL silently wins over the D1 binding, and synced Vercel
// credentials would re-couple the Cloudflare target to Vercel. The union
// covers every sibling's key names; names an app never sets are harmless
// no-ops. The env sync removes them; deploy.mjs re-reads to prove it before
// deploying.
export const CLOUDFLARE_FORBIDDEN_KEYS = new Set([
  'PROJECT_CATALOG_DATABASE_URL',
  'DATABASE_URL',
  'VERCEL_TOKEN',
  'VERCEL_PROJECT_CATALOG_ACCOUNTS',
  'VERCEL_ACCOUNT_NAME',
  'VERCEL_TEAM_ID',
  'VERCEL_TEAM_SLUG',
])

export const CLOUDFLARE_LOCAL_ONLY_KEYS = LOCAL_ONLY_ENV_KEYS

export function splitCloudflareEnv(raw = {}, { forbidden = CLOUDFLARE_FORBIDDEN_KEYS } = {}) {
  const project = String(raw?.CLOUDFLARE_PROJECT || '').trim()
  const vars = {}
  const secrets = {}
  for (const [key, value] of Object.entries(raw)) {
    // Forbidden keys are neither vars nor secrets: a Neon URL or Vercel
    // credential left in the overlay must never be written to the project.
    // The set is injectable so Neon-backed apps (no D1) can forbid only
    // Vercel credentials; the default is the full isolation set.
    if (!value || CLOUDFLARE_LOCAL_ONLY_KEYS.has(key) || forbidden.has(key)) continue
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
export function renderWranglerConfig({ project, vars = {}, d1 = null }) {
  const lines = [`name = ${JSON.stringify(project)}`, ...WRANGLER_STATIC_STANZA, '[vars]']
  for (const [key, value] of Object.entries(vars)) {
    lines.push(`${key} = ${JSON.stringify(String(value))}`)
  }
  if (d1) {
    // The binding name is per-app (callers pass it explicitly); no default
    // lives in shared code. Fail closed on a partial descriptor rather than
    // rendering `binding = undefined` into a config wrangler would push.
    for (const key of ['binding', 'databaseName', 'databaseId']) {
      if (!d1[key]) {
        throw new Error(`renderWranglerConfig: d1.${key} is required.`)
      }
    }
    lines.push(
      '',
      '[[d1_databases]]',
      `binding = ${JSON.stringify(d1.binding)}`,
      `database_name = ${JSON.stringify(d1.databaseName)}`,
      `database_id = ${JSON.stringify(d1.databaseId)}`,
    )
  }
  return `${lines.join('\n')}\n`
}

// D1 database name for the target overlay: CLOUDFLARE_D1_DATABASE, or '' when
// unset (callers fail loudly or apply their own default; shared code owns no
// per-app database name).
export function resolveD1DatabaseName(merged = {}) {
  return String(merged?.CLOUDFLARE_D1_DATABASE || '').trim()
}

function parseD1Databases(output) {
  try {
    const parsed = JSON.parse(String(output || ''))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// D1 database id from `wrangler d1 list --json`; '' when absent. Field names
// vary across wrangler versions (uuid vs database_id), so accept both.
export function findD1DatabaseId(listOutput, name) {
  const entry = parseD1Databases(listOutput).find(db => String(db?.name || '').trim() === name)
  return entry ? String(entry.uuid || entry.database_id || '').trim() : ''
}

// Idempotent D1 provisioning: list, create when missing, re-list for the id
// (wrangler's create output is not machine-readable). Mirrors
// `ensurePagesProject`; the runner is injectable so tests stub wrangler.
export function ensureD1Database(name, runner = defaultWranglerRunner, cwd = process.cwd()) {
  const list = () => runner(['d1', 'list', '--json'], { cwd, capture: true })
  const listed = list()
  if (listed.status !== 0) {
    const detail = tailWranglerOutput(listed.output)
    throw new Error(`wrangler d1 list failed (exit ${listed.status})${detail ? `: ${detail}` : '.'}`)
  }
  const existing = findD1DatabaseId(listed.output, name)
  if (existing) {
    return { status: 'exists', databaseId: existing }
  }
  console.log(`-> Creating Cloudflare D1 database ${name}...`)
  const created = runner(['d1', 'create', name], { cwd })
  if (created.status !== 0) {
    const detail = tailWranglerOutput(created.output)
    throw new Error(`Failed to create D1 database ${name} (exit ${created.status})${detail ? `: ${detail}` : '.'} Create it in the dashboard and retry.`)
  }
  const relisted = list()
  const createdId = findD1DatabaseId(relisted.output, name)
  if (!createdId) {
    throw new Error(`Created D1 database ${name} but could not resolve its id; run \`wrangler d1 list\` and retry.`)
  }
  return { status: 'created', databaseId: createdId }
}
