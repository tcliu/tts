#!/usr/bin/env node
// Production deploy to Vercel or Cloudflare Pages: syncs the target env
// (.env.prod overlaid by .env.vercel / .env.cloudflare), optionally applies
// Neon schema, deploys with `vercel deploy --prod`, waits for READY, then
// points the Vercel project's production domain at APP_BASE_URL (the
// Cloudflare live URL derives from CLOUDFLARE_PROJECT instead).
//
// Usage:
//   node scripts/deploy.mjs [--profile dev|prod] [--target vercel|cloudflare] [--project <name>]
//     [--sync-env|--no-sync-env] [--apply-schema|--no-apply-schema]
//     [--heartbeat cron-job|none]
// --heartbeat syncs the cron-job.org auto-scan heartbeat (default cron-job);
// none disables the scan job.
// A missing .vercel/project.json is linked automatically, and a --project /
// VERCEL_PROJECT value that differs from the linked project switches the
// link (confirmed interactively): --project, VERCEL_PROJECT in .env.vercel,
// or an interactive prompt (persisted to .env.vercel before the env sync).
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseEnvFile } from './env-file.mjs'
import { errorMessage, logEvent } from './log-event.mjs'
import { hasNeonSchema } from './db-config.mjs'
import {
  applyHeartbeat,
  HEARTBEAT_CHOICES,
  HEARTBEAT_PROVIDERS,
  renderOptionPicker,
  shouldAskHeartbeat,
} from './lib/heartbeat.mjs'
import {
  CLOUDFLARE_FORBIDDEN_KEYS,
  desiredPagesVars,
  ensureD1Database,
  ensurePagesProject,
  GENERATED_WRANGLER_CONFIG,
  getPagesProjectDomain,
  renderWranglerConfig,
  resolveCloudflareProjectName,
  resolveD1DatabaseName,
  splitCloudflareEnv,
  wranglerBin,
} from './lib/cloudflare.mjs'
import { loadTargetEnv, loadTargetFileEnv } from './lib/target-env.mjs'
import { diffDesiredVars, fetchPagesEnvState } from './lib/cloudflare-pages-env.mjs'
import { withPrompt } from './lib/prompt-queue.mjs'
import { ask, c, formatCommand, promptYesNo } from './_terminal.mjs'
import { interactiveShell } from './_interactive-shell.mjs'
import {
  decideLinkAction,
  defaultProjectName,
  normalizeProjectName,
  resolveProjectName,
  upsertEnvLine,
} from './vercel-project.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = join(SCRIPT_DIR, '..')
const DOMAIN_STATE_FILE = join(ROOT_DIR, '.vercel', 'domain-state.json')
const DEPLOY_MAX_ATTEMPTS = 3
const DEPLOY_RETRY_DELAY_MS = 5000
const DEPLOY_WAIT_TIMEOUT = '5m'

const PROFILES = [
  { value: 'dev', description: 'Local SQLite backend (ephemeral storage on Vercel)' },
  { value: 'prod', description: 'Neon Postgres via DATABASE_URL (syncs the target env first)' },
]

const TARGETS = [
  { value: 'vercel', description: 'Deploy the app to Vercel' },
  { value: 'cloudflare', description: 'Deploy the app to Cloudflare Pages (live URL derived from CLOUDFLARE_PROJECT; D1 backend + Cloudflare scan)' },
]

// Vercel stays the default target so existing invocations behave as before.
const DEFAULT_TARGET = 'vercel'

function fail(message) {
  console.error(message)
  process.exit(1)
}

function formatElapsedTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) {
    return `${minutes}m${String(seconds).padStart(2, '0')}s`
  }
  return `${seconds}s`
}

function usage() {
  console.log(`Usage:
  node scripts/deploy.mjs [--profile dev|prod] [--target vercel|cloudflare|all] [--project <name>] [--sync-env|--no-sync-env] [--apply-schema|--no-apply-schema] [--heartbeat cron-job|none]

Targets (--target, prod profile only; repeatable, comma-separated, or all):
  vercel       Deploy the app to Vercel.
  cloudflare   Deploy the app to Cloudflare Pages (reads .env.prod +
               .env.cloudflare, syncs vars/secrets via wrangler,
               removes forbidden keys, builds with CF_PAGES=1).
               Runs on D1 when CLOUDFLARE_D1_DATABASE is set (provisioned,
               bound, and bootstrapped by the flow), otherwise on the
               existing Neon backend.
  all          Deploy to every target in parallel (schema applies once;
               heartbeat choice applies per target).

Options:
  --profile dev|prod   Backend profile to deploy (also read from $PROFILE).
                       Missing and interactive: arrow-key picker (default prod).
                       Missing and non-interactive: abort.
  --target vercel|cloudflare|all
                        Deploy targets; only valid with the prod profile
                       (dev has no deploy target). Defaults to vercel.
  --project <name>     Vercel-only: project to link when .vercel/project.json is
                       missing or names a different project (also read from
                       $VERCEL_PROJECT and .env.vercel). A mismatch switches
                       the link interactively after confirmation; in a
                       non-interactive run the flag itself is the opt-in.
                       Missing and interactive: prompt (default package
                       name), persisted to .env.vercel (.env.local when the
                       link lives there) before the env sync.
                       Missing and non-interactive: abort.
  --sync-env           Sync the target env file before a prod deploy.
  --no-sync-env        Skip the env sync. prod without a flag asks interactively
                       (default yes); non-interactive defaults to skip.
  --apply-schema       Apply sql/schema.sql to the Neon database before a prod deploy.
  --no-apply-schema    Skip the schema apply (same interactive/non-interactive
                       defaults as --sync-env).
  --heartbeat cron-job|none
                       Prod auto-scan heartbeat: cron-job upserts + enables
                       the target's scan job (needs CRONJOB_API_KEY; one
                       job per target, each hitting its own /api/cron/scan);
                       none disables the target's scan job.
                       Missing and interactive: picker (default cron-job),
                       skipped without prompting when the app has no cron
                       heartbeat endpoint or CRONJOB_API_KEY is unset.
                       Missing and non-interactive: skip wiring (job untouched).

Step isolation: each target runs as named steps (vercel: link, auth,
env-sync, schema, domains, heartbeat, deploy, ready; cloudflare: auth,
project, env-sync, isolation, d1, schema, heartbeat, build, deploy). A step
failure no longer aborts the run: interactive callers are asked whether to
continue (default No); non-interactive callers fail fast.
Parallel runs are not transactional: a fatal error or a declined prompt
in one target stops the whole run.

Examples:
  npm run deploy -- --profile prod --target vercel --sync-env
  npm run deploy -- --profile prod --target vercel --sync-env --apply-schema
  npm run deploy -- --profile prod --target vercel --sync-env --apply-schema --heartbeat cron-job
  npm run deploy -- --target cloudflare --sync-env --apply-schema --heartbeat cron-job
  npm run deploy -- --target all --sync-env --apply-schema --heartbeat cron-job
  npm run deploy -- --project project-catalog
  PROFILE=prod node scripts/deploy.mjs --target vercel --no-sync-env`)
}

let resolvedVercelBin = null
let vercelBinResolved = false
function vercelBin() {
  // One `command -v` probe per process; every CLI call below reuses it.
  if (!vercelBinResolved) {
    const found = spawnSync('command -v vercel', { shell: true, encoding: 'utf8' })
    resolvedVercelBin = found.status === 0 && found.stdout.trim() ? 'vercel' : null
    vercelBinResolved = true
  }
  return resolvedVercelBin
}

function runVercelCli(args, { cwd = ROOT_DIR, capture = false } = {}) {
  const bin = vercelBin()
  const command = bin ?? 'npx'
  const fullArgs = bin ? args : ['vercel@latest', ...args]
  console.log(formatCommand(command, fullArgs))
  if (!capture) {
    const result = spawnSync(command, fullArgs, { cwd, stdio: 'inherit' })
    return { status: result.status ?? 1, output: '' }
  }
  const result = spawnSync(command, fullArgs, { cwd, encoding: 'utf8' })
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

function runVercelApi(path, extraArgs = [], { capture = true } = {}) {
  const apiDir = mkdtempSync(join(tmpdir(), 'deploy-api-'))
  try {
    return runVercelCli(['api', path, ...extraArgs], { cwd: apiDir, capture })
  } finally {
    rmSync(apiDir, { recursive: true, force: true })
  }
}

function checkVercelAuth() {
  const { status } = runVercelCli(['whoami'], {
    capture: true,
  })
  // whoami prints the username on success; only the exit code matters here.
  if (status !== 0) {
    throw new Error('Vercel CLI is not authenticated. Run `vercel login` and retry the deploy.')
  }
}

function projectId() {
  try {
    const data = JSON.parse(readFileSync(join(ROOT_DIR, '.vercel', 'project.json'), 'utf8'))
    return String(data.projectId || '')
  } catch {
    return ''
  }
}

function linkedProjectName() {
  try {
    const data = JSON.parse(readFileSync(join(ROOT_DIR, '.vercel', 'project.json'), 'utf8'))
    return String(data.projectName || '')
  } catch {
    return ''
  }
}

function mergedProjectEnv() {
  // Unified load order via target-env (`.env` < `.env.local` < `.env.prod` <
  // `.env.vercel` < shell).
  return loadTargetEnv('vercel', ROOT_DIR)
}

function packageDefaultProjectName() {
  try {
    const data = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf8'))
    return defaultProjectName(data.name)
  } catch {
    return ''
  }
}

async function promptProjectName() {
  const fallback = packageDefaultProjectName()
  const hint = fallback ? ` [${fallback}]` : ''
  for (;;) {
    const answer = await withPrompt(() => ask(`${c.cyan}Vercel project name${c.reset}${hint}: `, process.stderr))
    const raw = String(answer ?? '').trim()
    if (raw.toLowerCase() === 'q') {
      fail('Deploy cancelled.')
    }
    const name = normalizeProjectName(raw || fallback)
    if (name) {
      return name
    }
    console.error(
      `Invalid project name ${JSON.stringify(raw)}: use lowercase letters, numbers, and hyphens.`,
    )
  }
}

function persistEnvValue(file, label, key, value) {
  let current = ''
  try {
    current = String(parseEnvFile(file)[key] || '').trim()
  } catch {
    current = ''
  }
  if (current === value) {
    return
  }
  let content = ''
  try {
    content = existsSync(file) ? readFileSync(file, 'utf8') : ''
  } catch {
    content = ''
  }
  writeFileSync(file, upsertEnvLine(content, key, value))
  logEvent({ action: 'env_saved', details: { key, label } })
}

function persistProjectName(name) {
  // Prefer the overlay that already carries VERCEL_PROJECT (.env.local in
  // apps that keep the link slug out of the synced env); default .env.vercel.
  // All syncs exclude the local-only link slug, so either file is safe.
  const vercelFile = join(ROOT_DIR, '.env.vercel')
  const localFile = join(ROOT_DIR, '.env.local')
  const hasKey = file => {
    try {
      return String(parseEnvFile(file).VERCEL_PROJECT || '').trim() !== ''
    } catch {
      return false
    }
  }
  const useLocal = hasKey(localFile) && !hasKey(vercelFile)
  persistEnvValue(useLocal ? localFile : vercelFile, useLocal ? '.env.local' : '.env.vercel', 'VERCEL_PROJECT', name)
}

// Prompt loop for a fresh APP_BASE_URL: validates the input as an absolute
// URL, persists it to the target overlay file, and returns the raw value.
// `q`/empty cancels the deploy. Serialized through withPrompt so parallel
// flows never share stdin. Vercel-only: the Cloudflare target derives its
// live URL from the Pages project and takes no APP_BASE_URL.
async function promptBaseUrl(label, file) {
  const answer = await withPrompt(() => ask(`New APP_BASE_URL for ${label} (full URL, q to cancel): `, process.stderr))
  const raw = String(answer ?? '').trim()
  if (!raw || raw.toLowerCase() === 'q') {
    fail('Deploy cancelled.')
  }
  let host = ''
  try {
    host = new URL(raw).hostname
  } catch {
    host = ''
  }
  if (!host) {
    console.error(`Invalid URL (need https://host/...): ${raw}`)
    return promptBaseUrl(label, file)
  }
  persistEnvValue(file, label, 'APP_BASE_URL', raw)
  return raw
}

function ensureRemoteProject(name) {
  const inspect = runVercelCli(['projects', 'inspect', name], { capture: true })
  if (inspect.status === 0) {
    return
  }
  const created = runVercelCli(['projects', 'add', name])
  if (created.status !== 0) {
    logEvent({ action: 'vercel_project_create_error', details: { project: name, exit_code: created.status } })
    throw new Error(`Failed to create Vercel project ${name}. Create it in the dashboard and retry.`)
  }
  logEvent({ action: 'vercel_project_create', details: { project: name } })
}

// Link a checkout with no .vercel/project.json, or switch the link when
// --project / VERCEL_PROJECT names a different project than the linked one:
// resolve the name (--project, then $VERCEL_PROJECT / .env files, then an
// interactive prompt persisted to .env.vercel ahead of the env sync), confirm
// a switch interactively, create the remote project when absent, and link.
// A matching link (or nothing requested on a linked checkout) keeps the
// existing link untouched.
async function ensureVercelLink(projectFlag) {
  const projectFile = join(ROOT_DIR, '.vercel', 'project.json')
  const linked = existsSync(projectFile) ? normalizeProjectName(linkedProjectName()) : ''
  let requested = ''
  try {
    requested = resolveProjectName({ flag: projectFlag, env: mergedProjectEnv() })
  } catch (error) {
    // A stale or malformed VERCEL_PROJECT must not block a checkout that is
    // already linked and was not explicitly targeted with --project.
    if (projectFlag || !linked) {
      throw new Error(error?.message || String(error))
    }
    logEvent({ action: 'vercel_link_stale', details: { error: error?.message || error, linked, level: 'WARN' } })
  }
  const decision = decideLinkAction({ linked, requested })
  if (decision.action === 'keep') {
    return
  }
  checkVercelAuth()
  if (decision.action === 'switch') {
    if (process.stdin.isTTY) {
      const ok = await withPrompt(() =>
        promptYesNo(`Switch Vercel link from ${decision.from} to ${decision.name}`, true, process.stderr),
      )
      if (!ok) {
        fail('Deploy cancelled: Vercel link unchanged.')
      }
    } else if (!projectFlag) {
      // An env-only change must not silently re-point production for
      // non-interactive callers; the explicit flag is the opt-in.
      fail(
        `Refusing to switch the Vercel link from ${decision.from} to ${decision.name} non-interactively. Re-run with --project ${decision.name} to confirm.`,
      )
    }
  }
  let name = decision.name
  if (!name && process.stdin.isTTY) {
    name = await promptProjectName()
  }
  if (!name) {
    throw new Error('Vercel project is not linked: pass --project <name>, set VERCEL_PROJECT in .env.vercel, or run interactively.')
  }
  persistProjectName(name)
  ensureRemoteProject(name)
  console.log(
    decision.action === 'switch'
      ? `-> Switching link to Vercel project ${name}...`
      : `-> Linking to Vercel project ${name}...`,
  )
  const linkedNow = runVercelCli(['link', '--yes', '--project', name])
  if (linkedNow.status !== 0 || !existsSync(projectFile)) {
    logEvent({ action: 'vercel_link_error', details: { project: name, exit_code: linkedNow.status } })
    throw new Error(`Failed to link Vercel project ${name}. Run 'vercel link' from the repo root and retry.`)
  }
  logEvent({ action: 'vercel_link', details: { project: name, switched: decision.action === 'switch' } })
}

function trimJsonPayload(value) {
  const lineStart = value.search(/(^|\r?\n)\s*\{/)
  const start = lineStart === -1 ? value.indexOf('{') : value.indexOf('{', lineStart)
  if (start === -1) return ''

  const end = value.lastIndexOf('}')
  return end >= start ? value.slice(start, end + 1) : value.slice(start)
}

function normalizeUrl(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^[\w.-]+\.vercel\.app$/i.test(trimmed)) return `https://${trimmed}`
  return ''
}

function extractDeploymentUrl(commandOutput) {
  const raw = String(commandOutput || '')
  const candidates = []
  const pushCandidate = value => {
    const normalized = normalizeUrl(value)
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized)
    }
  }

  const jsonPayload = trimJsonPayload(raw)
  if (jsonPayload) {
    try {
      const parsed = JSON.parse(jsonPayload)
      if (typeof parsed === 'string') {
        pushCandidate(parsed)
      } else if (parsed && typeof parsed === 'object') {
        pushCandidate(parsed.url)
        pushCandidate(parsed.inspectorUrl)
        if (Array.isArray(parsed.alias)) parsed.alias.forEach(pushCandidate)
        if (Array.isArray(parsed.aliases)) parsed.aliases.forEach(pushCandidate)
      }
    } catch (error) {
      console.error('Failed to parse deploy output JSON:', error?.message || error)
    }
  }

  for (const match of raw.match(/https?:\/\/[^\s"']+/g) || []) {
    pushCandidate(match)
  }
  for (const match of raw.match(/[\w.-]+\.vercel\.app/g) || []) {
    pushCandidate(match)
  }

  return candidates.length > 0 ? candidates[0] : ''
}

function extractDeploymentId(commandOutput) {
  const payload = trimJsonPayload(String(commandOutput || ''))
  if (!payload) {
    return ''
  }
  try {
    const id = String(JSON.parse(payload)?.id || '').trim()
    return /^dpl_[A-Za-z0-9]+$/.test(id) ? id : ''
  } catch {
    return ''
  }
}

function deploymentReadyState(inspectOutput) {
  const raw = String(inspectOutput || '')
  const lineStart = raw.search(/(^|\r?\n)\s*\{/)
  const index = lineStart === -1 ? raw.indexOf('{') : raw.indexOf('{', lineStart)
  const end = raw.lastIndexOf('}')

  if (index === -1) {
    return ''
  }

  try {
    const payload = end >= index ? raw.slice(index, end + 1) : raw.slice(index)
    const parsed = JSON.parse(payload)
    return String(parsed?.readyState || '').trim()
  } catch (error) {
    console.error('Failed to parse deployment inspect JSON:', error?.message || error)
    return ''
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// `vercel inspect --format json` omits the platform's block explanation, so
// pull it from the deployment API (diagnostics only; never fails the deploy).
function fetchDeploymentBlockDetail(deploymentId) {
  const empty = { reason: '', errorLink: '' }
  if (!deploymentId) {
    return empty
  }
  const { status, output } = runVercelApi(`/v13/deployments/${deploymentId}`)
  if (status !== 0) {
    return empty
  }
  try {
    const parsed = JSON.parse(output || '{}')
    return {
      reason: String(parsed?.readyStateReason || '').trim(),
      errorLink: String(parsed?.errorLink || '').trim(),
    }
  } catch {
    return empty
  }
}

async function waitForReadyDeployment(deploymentUrl, deploymentId = '') {
  logEvent({
    action: 'vercel_deploy_wait',
    details: {
      deployment_url: deploymentUrl,
      log_command: `vercel inspect ${deploymentUrl} --logs --wait --timeout ${DEPLOY_WAIT_TIMEOUT}`,
    },
  })
  let inspectOutput = ''
  let inspectStatus = 0
  let logStatus = 0
  let readyState = ''

  for (let attempt = 1; attempt <= DEPLOY_MAX_ATTEMPTS; attempt++) {
    const logResult = runVercelCli(['inspect', deploymentUrl, '--logs', '--wait', '--timeout', DEPLOY_WAIT_TIMEOUT])
    logStatus = logResult.status
    const inspectResult = runVercelCli(['inspect', deploymentUrl, '--format', 'json'], { capture: true })
    inspectOutput = inspectResult.output
    inspectStatus = inspectResult.status

    readyState = deploymentReadyState(inspectOutput)
    if (readyState === 'READY') {
      return
    }

    if ((logStatus === 0 && inspectStatus === 0) || attempt >= DEPLOY_MAX_ATTEMPTS) {
      break
    }

    console.error(
      `-> Inspect attempt ${attempt}/${DEPLOY_MAX_ATTEMPTS} did not reach READY (logs exit ${logStatus}, inspect exit ${inspectStatus}). Retrying in ${DEPLOY_RETRY_DELAY_MS / 1000}s...`,
    )
    await sleep(DEPLOY_RETRY_DELAY_MS)
  }

  if (readyState) {
    console.error(`Vercel deployment did not reach READY (state: ${readyState}) -> ${deploymentUrl}`)
  } else {
    console.error(`Vercel deployment did not reach READY -> ${deploymentUrl}`)
  }

  if (inspectOutput) {
    console.error(inspectOutput)
  }

  const { reason, errorLink } = fetchDeploymentBlockDetail(deploymentId)
  if (reason) {
    console.error(`Vercel block reason: ${reason}`)
  }
  if (errorLink) {
    console.error(`Reference: ${errorLink}`)
  }

  throw new Error(
    `Vercel deployment did not reach READY${readyState ? ` (state: ${readyState})` : ''} -> ${deploymentUrl}`,
  )
}

async function runDeployWithRetry(appVersion) {
  let output = ''
  let status = 1

  for (let attempt = 1; attempt <= DEPLOY_MAX_ATTEMPTS; attempt++) {
    const bin = vercelBin()
    const result = spawnSync(
      bin ?? 'npx',
      [...(bin ? [] : ['vercel@latest']), 'deploy', '--prod', '--yes', '--no-wait', '--format', 'json'],
      {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        env: { ...process.env, APP_VERSION: appVersion },
      },
    )
    status = result.status ?? 1
    output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    process.stderr.write(output)

    if (status === 0) {
      return output
    }

    if (attempt < DEPLOY_MAX_ATTEMPTS) {
      console.error(
        `-> Deploy attempt ${attempt}/${DEPLOY_MAX_ATTEMPTS} failed (exit ${status}). Retrying in ${DEPLOY_RETRY_DELAY_MS / 1000}s...`,
      )
      await sleep(DEPLOY_RETRY_DELAY_MS)
    }
  }

  throw new Error(`vercel deploy --prod failed after ${DEPLOY_MAX_ATTEMPTS} attempt(s) (exit ${status}).`)
}
function configuredBaseUrl() {
  // Unified load order via target-env (shell first, then `.env` <
  // `.env.local` < `.env.prod` < `.env.vercel`).
  return String(loadTargetEnv('vercel', ROOT_DIR).APP_BASE_URL || '').trim()
}

function configuredDomain() {
  const baseUrl = configuredBaseUrl()
  if (!baseUrl) {
    fail('Missing APP_BASE_URL in shell env, .env, .env.prod, or .env.vercel.')
  }
  try {
    return new URL(baseUrl).hostname
  } catch {
    fail(`APP_BASE_URL must be a valid absolute URL. Received: ${baseUrl}`)
  }
}

function readManagedDomainState() {
  if (!existsSync(DOMAIN_STATE_FILE)) {
    return ''
  }
  try {
    const state = JSON.parse(readFileSync(DOMAIN_STATE_FILE, 'utf8'))
    return String(state.managedDomain || '').trim()
  } catch (error) {
    console.error('Failed to read managed domain state:', error?.message || error)
    return ''
  }
}

function writeManagedDomainState(managedDomain) {
  mkdirSync(dirname(DOMAIN_STATE_FILE), { recursive: true })
  writeFileSync(DOMAIN_STATE_FILE, JSON.stringify({ managedDomain }, null, 2) + '\n')
}

function listOtherVercelAppDomains(projectIdValue, currentDomain) {
  const { status, output } = runVercelApi(`/v9/projects/${projectIdValue}/domains`)
  if (status !== 0) {
    throw new Error('Failed to list Vercel project domains. Check `vercel whoami` auth and network, then retry.')
  }
  let payload = {}
  try {
    payload = JSON.parse(output || '{}')
  } catch {
    throw new Error('Failed to parse Vercel project domains output. Re-run with a working `vercel` CLI and retry.')
  }
  const recordedDomain = readManagedDomainState()
  const domains = Array.isArray(payload) ? payload : Array.isArray(payload.domains) ? payload.domains : []
  const names = domains
    .map(entry => String(typeof entry === 'string' ? entry : entry?.name || '').trim())
    .filter(name => name && name.endsWith('.vercel.app') && name !== currentDomain)

  const prioritized =
    recordedDomain && names.includes(recordedDomain)
      ? [recordedDomain, ...names.filter(name => name !== recordedDomain)]
      : names

  return prioritized
}

// Attaches the production domain. Returns a discriminated status: 'attached'
// when the hostname is (or becomes) on the project, 'conflict' when the add
// was refused because the hostname is taken elsewhere (the caller retries with
// a fresh URL), 'error' for anything else (auth, network, rate limit) — a
// misclassified transport error must never masquerade as a taken hostname.
const DOMAIN_CONFLICT_PATTERN = /already|in use|is taken|unavailable|reserved|used by/i

function ensureProjectDomain(projectIdValue, domain) {
  const { status } = runVercelApi(`/v9/projects/${projectIdValue}/domains/${domain}`)
  if (status === 0) {
    return { status: 'attached' }
  }
  const added = runVercelApi(`/v10/projects/${projectIdValue}/domains`, ['-X', 'POST', '-f', `name=${domain}`], {
    capture: true,
  })
  if (added.status !== 0) {
    const detail = added.output.trim().split('\n').slice(-1)[0] || `vercel exited ${added.status}`
    if (DOMAIN_CONFLICT_PATTERN.test(added.output)) {
      logEvent({ action: 'vercel_domain_conflict', details: { project_id: projectIdValue, domain } })
      return { status: 'conflict' }
    }
    logEvent({ action: 'vercel_domain_add_error', details: { project_id: projectIdValue, domain, error: detail } })
    return { status: 'error', message: detail }
  }
  if (runVercelApi(`/v9/projects/${projectIdValue}/domains/${domain}`).status === 0) {
    logEvent({ action: 'vercel_domain_add', details: { project_id: projectIdValue, domain } })
    return { status: 'attached' }
  }
  return { status: 'error', message: 'added but not listed' }
}

function removeProjectDomain(projectIdValue, domain) {
  if (!domain) {
    return
  }
  const { status } = runVercelApi(`/v9/projects/${projectIdValue}/domains/${domain}`)
  if (status !== 0) {
    return
  }
  const removed = runVercelApi(
    `/v9/projects/${projectIdValue}/domains/${domain}`,
    ['-X', 'DELETE', '--dangerously-skip-permissions'],
    { capture: false },
  )
  if (removed.status === 0) {
    logEvent({ action: 'vercel_domain_remove', details: { project_id: projectIdValue, domain } })
  }
}

async function syncProjectDomains() {
  const projectIdValue = projectId()
  if (!projectIdValue) {
    throw new Error('Failed to determine the Vercel project ID from .vercel/project.json.')
  }

  // Domain claim with conflict retry: only a genuine "hostname taken"
  // refusal asks for a fresh APP_BASE_URL; any other failure (auth, network,
  // rate limit) throws immediately rather than looping on a prompt that
  // cannot help. configuredDomain() re-reads the files every iteration, so
  // the heartbeat/deploy steps that run after this one see the final URL.
  for (;;) {
    const configuredDomainValue = configuredDomain()
    const claimed = ensureProjectDomain(projectIdValue, configuredDomainValue)
    if (claimed.status === 'attached') {
      for (const obsoleteDomain of listOtherVercelAppDomains(projectIdValue, configuredDomainValue)) {
        if (!obsoleteDomain) continue
        removeProjectDomain(projectIdValue, obsoleteDomain)
      }
      writeManagedDomainState(configuredDomainValue)
      return
    }
    if (claimed.status === 'error') {
      throw new Error(`Failed to attach domain ${configuredDomainValue}: ${claimed.message}`)
    }
    logEvent({ action: 'vercel_domain_unavailable', details: { domain: configuredDomainValue, level: 'WARN' } })
    if (!process.stdin.isTTY) {
      throw new Error(
        `Domain ${configuredDomainValue} is unavailable; set APP_BASE_URL in .env.vercel to an available hostname and retry.`,
      )
    }
    await promptBaseUrl('.env.vercel', join(ROOT_DIR, '.env.vercel'))
  }
}

// Interactive defaults: every interview question resolves on Enter.
const DEFAULT_PROFILE = 'prod'
const DEFAULT_CONFIRM = 'yes'

const SYNC_ENV_CHOICES = [
  { value: 'yes', label: 'Yes', description: 'sync the target env file first' },
  { value: 'no', label: 'No', description: 'dashboard env already carries PROFILE=prod' },
]

const APPLY_SCHEMA_CHOICES = [
  { value: 'yes', label: 'Yes', description: 'apply sql/schema.sql to Neon' },
  { value: 'no', label: 'No', description: 'schema already applied to Neon' },
]

function renderProfilePicker() {
  return (entries, state) => {
    const lines = []
    for (let i = 0; i < entries.length; i++) {
      const item = entries[i]
      const cursor = i === state.cursor ? `${c.cyan}>${c.reset}` : ' '
      lines.push(` ${cursor} ${c.green}${item.value}${c.reset} ${c.gray}(${item.description})${c.reset}`)
    }
    lines.push('', `${c.dim}Up/Down: move | Enter: confirm (default prod) | q: cancel${c.reset}`)
    return lines
  }
}

function renderTargetsPicker() {
  return (entries, state) => {
    const lines = []
    for (let i = 0; i < entries.length; i++) {
      const item = entries[i]
      const cursor = i === state.cursor ? `${c.cyan}>${c.reset}` : ' '
      const mark = state.selected.has(i) ? `${c.green}[x]${c.reset}` : '[ ]'
      lines.push(` ${cursor} ${mark} ${c.green}${item.value}${c.reset} ${c.gray}(${item.description})${c.reset}`)
    }
    lines.push('', `${c.dim}Up/Down: move | Space: toggle | Enter: confirm | q: cancel${c.reset}`)
    return lines
  }
}

// Linear interview: target -> profile -> sync-env -> apply-schema -> heartbeat ->
// exit. Flag/env seeds skip their node; q/Ctrl-C aborts
// via fail. Non-interactive callers never enter the graph (see
// deployVercelWithTarget branch below).
function buildDeployGraph() {
  const graph = {
    target: {
      message: 'Select deploy targets (space to toggle, enter to confirm):',
      async process(ctx) {
        const valid = Array.isArray(ctx.targets) && ctx.targets.length > 0
        if (!valid || !ctx.targets.every(value => TARGETS.some(entry => entry.value === value))) {
          const picked = await ctx.selectMany(TARGETS, {
            initialSelected: [0],
            render: renderTargetsPicker(),
          })
          if (!picked || picked.length === 0) {
            fail('Deploy cancelled.')
          }
          ctx.targets = picked.map(item => item.value)
        }
        return graph.profile
      },
    },
    profile: {
      message: 'Select deploy profile:',
      async process(ctx) {
        if (ctx.profile !== 'dev' && ctx.profile !== 'prod') {
          const picked = await ctx.selectOne(PROFILES, {
            defaultValue: DEFAULT_PROFILE,
            render: renderProfilePicker(),
          })
          if (!picked) {
            fail('Deploy cancelled.')
          }
          ctx.profile = picked.value
        }
        if (ctx.profile !== 'prod') {
          fail(`Target '${(ctx.targets || [DEFAULT_TARGET]).join(',')}' supports only the prod profile; dev has no deploy target.`)
        }
        return graph.syncEnv
      },
    },
    syncEnv: {
      message: 'Sync the target env file before deploy?',
      async process(ctx) {
        if (ctx.syncEnv !== 'yes' && ctx.syncEnv !== 'no') {
          const picked = await ctx.selectOne(SYNC_ENV_CHOICES, {
            defaultValue: DEFAULT_CONFIRM,
            render: renderOptionPicker(),
          })
          if (!picked) {
            fail('Deploy cancelled.')
          }
          ctx.syncEnv = picked.value
        }
        return graph.applySchema
      },
    },
    applySchema: {
      message: 'Apply sql/schema.sql to the Neon database before deploy?',
      async process(ctx) {
        if (ctx.applySchema !== 'yes' && ctx.applySchema !== 'no') {
          // No schema file, no question: asking would offer a dead choice
          // (both apply flows read sql/schema.sql and fail without it).
          if (!hasNeonSchema(ROOT_DIR)) {
            ctx.applySchema = 'skip'
            logEvent({ action: 'neon_schema_skip', details: { reason: 'missing sql/schema.sql' } })
          } else {
            const picked = await ctx.selectOne(APPLY_SCHEMA_CHOICES, {
              defaultValue: DEFAULT_CONFIRM,
              render: renderOptionPicker(),
            })
            if (!picked) {
              fail('Deploy cancelled.')
            }
            ctx.applySchema = picked.value
          }
        }
        // Bypass the heartbeat node when there is nothing to ask: the
        // interview chrome prints every entered node's message, so entering
        // it just to skip would show a phantom question. The node keeps its
        // own guard as a safety net.
        if (!shouldAskHeartbeat({ heartbeat: ctx.heartbeat })) {
          if (!ctx.heartbeat) {
            ctx.heartbeat = 'skip'
          }
          return null
        }
        return graph.heartbeat
      },
    },
    heartbeat: {
      message: 'Sync the cron-job.org auto-scan heartbeat?',
      async process(ctx) {
        // An explicit flag always reaches the step (which skips with a notice
        // on unsupported apps and throws on missing secrets). Otherwise skip
        // without prompting when there is nothing to wire: no cron endpoint
        // in the app, or no operator API key to manage the job with. (The
        // apply-schema node normally bypasses this node entirely in that
        // case so no phantom question prints; this guard is the safety net.)
        if (!shouldAskHeartbeat({ heartbeat: ctx.heartbeat })) {
          if (!ctx.heartbeat) {
            ctx.heartbeat = 'skip'
          }
          return null
        }
        const picked = await ctx.selectOne(HEARTBEAT_CHOICES, {
          defaultValue: 'cron-job',
          render: renderOptionPicker('default cron-job.org'),
        })
        if (!picked) {
          fail('Deploy cancelled.')
        }
        ctx.heartbeat = picked.value
        return null
      },
    },
  }
  return graph
}

async function runDeployInterview(options) {
  const graph = buildDeployGraph()
  return interactiveShell(graph.target, {
    options: {
      ctx: {
        targets: options.targetFlags.length > 0 ? [...options.targetFlags] : [],
        profile: options.profileFlag || process.env.PROFILE || '',
        syncEnv: options.syncEnvFlag || '',
        applySchema: options.applySchemaFlag || '',
        heartbeat: resolveHeartbeatFlag(options),
      },
      output: process.stderr,
    },
    chrome: { cancelText: `${c.yellow}Deploy cancelled.${c.reset}` },
  })
}

// Pure fallback for the non-interactive path (no TTY prompts here).
function resolveProfileSync(profileFlag) {
  const profile = profileFlag || process.env.PROFILE || ''
  if (profile !== 'dev' && profile !== 'prod') {
    fail('PROFILE is mandatory: pass --profile dev|prod, set $PROFILE, or run interactively.')
  }
  return profile
}

// Precedence: explicit flag, non-interactive skip with notice.
function resolveProdConfirmSync(profile, flag, skipNotice) {
  if (profile !== 'prod') {
    return 'no'
  }
  if (flag) {
    return flag
  }
  console.error(skipNotice)
  return 'no'
}

// Explicit --heartbeat flag, otherwise empty (caller prompts or skips).
function resolveHeartbeatFlag(options) {
  if (options?.heartbeatFlag) return options.heartbeatFlag
  return ''
}

function parseArgs(argv) {
  const options = {
    profileFlag: '',
    targetFlags: [],
    projectFlag: '',
    syncEnvFlag: '',
    applySchemaFlag: '',
    heartbeatFlag: '',
  }
  const pushTargets = raw => {
    for (const part of String(raw || '')
      .split(',')
      .map(piece => piece.trim().toLowerCase())
      .filter(Boolean)) {
      if (part === 'all') {
        for (const entry of TARGETS) {
          if (!options.targetFlags.includes(entry.value)) {
            options.targetFlags.push(entry.value)
          }
        }
      } else if (!options.targetFlags.includes(part)) {
        options.targetFlags.push(part)
      }
    }
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg.startsWith('--profile=')) {
      options.profileFlag = arg.slice('--profile='.length)
    } else if (arg === '--profile') {
      options.profileFlag = next || ''
      if (next !== undefined) i++
    } else if (arg.startsWith('--target=')) {
      pushTargets(arg.slice('--target='.length))
    } else if (arg === '--target') {
      pushTargets(next || '')
      if (next !== undefined) i++
    } else if (arg.startsWith('--project=')) {
      options.projectFlag = arg.slice('--project='.length)
    } else if (arg === '--project') {
      options.projectFlag = next || ''
      if (next !== undefined) i++
    } else if (arg === '--sync-env') {
      options.syncEnvFlag = 'yes'
    } else if (arg === '--no-sync-env') {
      options.syncEnvFlag = 'no'
    } else if (arg === '--apply-schema') {
      options.applySchemaFlag = 'yes'
    } else if (arg === '--no-apply-schema') {
      options.applySchemaFlag = 'no'
    } else if (arg.startsWith('--heartbeat=')) {
      options.heartbeatFlag = arg.slice('--heartbeat='.length)
    } else if (arg === '--heartbeat') {
      options.heartbeatFlag = next || ''
      if (next !== undefined) i++
    } else if (arg === '-h' || arg === '--help' || arg === 'help') {
      usage()
      process.exit(0)
    } else if (arg === 'vercel' && !options.targetFlags.includes('vercel')) {
      // Legacy `deploy.sh vercel` positional: treat as --target vercel.
      options.targetFlags.push('vercel')
    } else {
      fail(`Unknown option: ${arg}`)
    }
  }
  return options
}

function runScript(script, env = process.env) {
  console.log(formatCommand('node', [`scripts/${script}`]))
  const result = spawnSync('node', [join(SCRIPT_DIR, script)], { cwd: ROOT_DIR, stdio: 'inherit', env })
  if ((result.status ?? 1) !== 0) {
    throw new Error(`scripts/${script} failed (exit ${result.status ?? 1}).`)
  }
}

// Prompts share one stdin across parallel flows; the queue lives in a shared
// module so heartbeat prompts (heartbeat.mjs) use the same chain.

// Step isolation: each deploy step runs through here so one failure no longer
// aborts the whole run. Interactive callers are asked whether to continue
// (default No, preserving fail-fast unless opted in); non-interactive callers
// fail fast with the step name attached. Explicit cancellations (q answers)
// still exit immediately via fail() and never reach the prompt.
async function runSteps(target, steps) {
  for (const step of steps) {
    const startedAt = Date.now()
    logEvent({ action: 'deploy_step_start', details: { target, step: step.name } })
    try {
      await step.run()
      logEvent({
        action: 'deploy_step_end',
        details: { target, step: step.name, elapsed_ms: Date.now() - startedAt },
      })
    } catch (error) {
      const message = errorMessage(error)
      logEvent({
        action: 'deploy_step_error',
        details: { target, step: step.name, elapsed_ms: Date.now() - startedAt, error: message },
      })
      if (process.stdin.isTTY) {
        const proceed = await withPrompt(() =>
          promptYesNo(`Step "${step.name}" failed: ${message}. Continue anyway`, false, process.stderr),
        )
        if (!proceed) {
          fail(`Deploy cancelled after step "${step.name}" failed.`)
        }
        logEvent({ action: 'deploy_step_continue', details: { target, step: step.name, level: 'WARN' } })
      } else {
        fail(`Step "${step.name}" failed: ${message}`)
      }
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  // Unknown --target values fail fast, before any prompt; the prod-only gate
  // runs after profile resolution inside deployWithTarget.
  const unknown = options.targetFlags.filter(value => !TARGETS.some(entry => entry.value === value))
  if (unknown.length > 0) {
    fail(`Unknown target: ${unknown.join(', ')} (expected ${TARGETS.map(entry => entry.value).join('|')} or all).`)
  }
  await deployWithTarget(options)
}

async function deployWithTarget(options) {
  // One run can deploy both platforms: flags seed the interview (repeatable /
  // comma-separated `--target`, or `all`); an empty seed prompts a
  // multi-select; non-interactive without flags keeps the Vercel default.
  const seeded = [...options.targetFlags]
  const targets = seeded.length > 0 ? seeded : [DEFAULT_TARGET]
  // Explicit invalid sources fail fast; the interview only fills gaps. The
  // Vercel link (a side effect: project creation, .env.vercel write) is
  // deferred to runDeployFlow so no flag error can touch Vercel.
  if (options.profileFlag && options.profileFlag !== 'dev' && options.profileFlag !== 'prod') {
    fail('PROFILE is mandatory: pass --profile dev|prod, set $PROFILE, or run interactively.')
  }
  const envProfile = options.profileFlag ? '' : process.env.PROFILE || ''
  if (envProfile && envProfile !== 'dev' && envProfile !== 'prod') {
    fail('PROFILE is mandatory: pass --profile dev|prod, set $PROFILE, or run interactively.')
  }
  if (options.heartbeatFlag && !HEARTBEAT_PROVIDERS.includes(options.heartbeatFlag)) {
    fail(`Unknown heartbeat: ${options.heartbeatFlag} (expected cron-job|none).`)
  }
  // An explicit apply demand needs the file both apply flows read; without
  // it the schema step would crash on a missing sql/schema.sql.
  if (options.applySchemaFlag === 'yes' && !hasNeonSchema(ROOT_DIR)) {
    fail('sql/schema.sql not found: cannot apply the schema. Re-run with --no-apply-schema.')
  }
  const seededProfile = options.profileFlag || process.env.PROFILE || ''
  // The heartbeat answer only gates the interview when wiring is possible:
  // without an endpoint or an API key the node is bypassed silently.
  const needsHeartbeatAnswer = shouldAskHeartbeat({ heartbeat: resolveHeartbeatFlag(options) })
  if (
    process.stdin.isTTY &&
    seededProfile !== 'dev' &&
    (seededProfile === '' ||
      seeded.length === 0 ||
      !options.syncEnvFlag ||
      !options.applySchemaFlag ||
      needsHeartbeatAnswer)
  ) {
    const answers = await runDeployInterview(options)
    await runDeployTargets(answers.targets, {
      profile: answers.profile,
      syncEnv: answers.syncEnv,
      applySchema: answers.applySchema,
      heartbeat: answers.heartbeat,
      projectFlag: options.projectFlag,
    })
    return
  }
  const profileValue = resolveProfileSync(options.profileFlag)
  if (profileValue !== 'prod') {
    fail(`Target '${targets.join(',')}' supports only the prod profile; dev has no deploy target.`)
  }
  const syncEnv = resolveProdConfirmSync(
    profileValue,
    options.syncEnvFlag,
    '-> Non-interactive prod deploy without --sync-env: skipping target env sync.',
  )
  const applySchema = resolveProdConfirmSync(
    profileValue,
    options.applySchemaFlag,
    '-> Non-interactive prod deploy without --apply-schema: skipping schema apply.',
  )
  let heartbeat = resolveHeartbeatFlag(options)
  if (!heartbeat) {
    console.error(
      '-> Non-interactive prod deploy without --heartbeat: skipping heartbeat wiring (cron-job.org job untouched).',
    )
    heartbeat = 'skip'
  }
  await runDeployTargets(targets, {
    profile: profileValue,
    syncEnv,
    applySchema,
    heartbeat,
    projectFlag: options.projectFlag,
  })
}

// Runs each selected target. The Neon schema apply is shared, so it runs
// once up front whenever a Neon-backed flow needs it (Vercel always; the
// Cloudflare flow only outside D1 mode, where it runs on Neon); the D1 flow
// applies its own schema. Env sync and heartbeat are per target (each target
// owns its job URL — deploying both with `cron-job` creates one scan job per
// target).
// Multiple targets deploy concurrently (Promise.all): step-failure prompts
// are mutex-serialized through withPrompt, and no step mutates shared process
// state, so flows cannot cross-talk. A "no" at any prompt still aborts the
// whole run via fail().
async function runDeployTargets(targets, { profile, syncEnv, applySchema, heartbeat, projectFlag }) {
  const d1Mode = targets.includes('cloudflare') && isCloudflareD1Mode()
  let neonSchema = applySchema
  if (applySchema === 'yes' && (targets.includes('vercel') || (targets.includes('cloudflare') && !d1Mode))) {
    logEvent({ action: 'neon_schema_apply' })
    runScript('apply-schema.mjs', { ...process.env, PROFILE: 'prod' })
    neonSchema = 'done'
  }
  // One scan job per running app (per-target titles): each target wires its
  // own job, so every deployment owns its heartbeat and a platform outage
  // fails over to the surviving target's job. The shared minute-claim keeps
  // the two jobs mutually exclusive (one runs, the other exits on `guard`).
  const runOne = async target => {
    const startedAt = Date.now()
    logEvent({
      action: 'deploy_start',
      details: { target, profile, sync_env: syncEnv, apply_schema: applySchema, heartbeat },
    })
    try {
      const url =
        target === 'cloudflare'
          ? await runCloudflareFlow(syncEnv, d1Mode ? applySchema : neonSchema, heartbeat, d1Mode)
          : await runDeployFlow(profile, syncEnv, neonSchema, heartbeat, projectFlag)
      logEvent({ action: 'deploy_end', details: { target, url, elapsed_ms: Date.now() - startedAt } })
    } catch (error) {
      logEvent({
        action: 'deploy_error',
        details: { target, elapsed_ms: Date.now() - startedAt, error: errorMessage(error) },
      })
      throw error
    }
  }
  if (targets.length > 1) {
    logEvent({ action: 'deploy_parallel', details: { targets } })
    await Promise.all(targets.map(runOne))
  } else {
    await runOne(targets[0])
  }
}

// Cloudflare Pages target. Reads `.env.prod` overlaid by `.env.cloudflare`
// (never `.env.vercel`), so the two targets keep independent URLs; the Neon
// schema step is shared (see runDeployTargets). Load order matches
// loadTargetEnv: `.env` < `.env.local` < `.env.prod` < overlay < shell.
function cloudflareEnv() {
  return loadTargetEnv('cloudflare', ROOT_DIR)
}

async function cloudflareApi(path, { method = 'GET', body } = {}) {
  const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim()
  if (!token) {
    throw new Error('CLOUDFLARE_API_TOKEN is empty: cannot manage Pages custom domains.')
  }
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  return { ok: response.ok && payload.success !== false, payload }
}

// Production branch of the Pages project. `pages project list --json` omits
// it, so read the project object. Required because `wrangler pages deploy`
// defaults to the *checkout* branch: a deploy from a worktree (the default
// workflow) would otherwise land as a non-production preview while the run
// still reports success.
async function cloudflareProductionBranch(project) {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim()
  if (!accountId) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID is empty: cannot resolve the Pages production branch.')
  }
  const response = await cloudflareApi(`/accounts/${accountId}/pages/projects/${project}`)
  if (!response.ok) {
    throw new Error(`Failed to read Pages project ${project} (production branch).`)
  }
  return String(response.payload?.result?.production_branch || '').trim()
}

function cloudflareProjectName() {
  // Overlay owns the name (mirrors VERCEL_PROJECT); the generated config is
  // the fallback so a checkout that predates CLOUDFLARE_PROJECT keeps
  // working. Generated-file read compacted here because this is the only
  // caller that touches disk for it (sync-cloudflare-env.mjs has its own).
  let generatedName = ''
  try {
    const content = readFileSync(join(ROOT_DIR, GENERATED_WRANGLER_CONFIG), 'utf8')
    generatedName = /^name\s*=\s*"([^"]+)"/m.exec(content)?.[1] || ''
  } catch {
    generatedName = ''
  }
  const name = resolveCloudflareProjectName(cloudflareEnv(), generatedName)
  if (!name) {
    throw new Error('Missing CLOUDFLARE_PROJECT in .env.cloudflare: set it to the Pages project name.')
  }
  return name
}

function seedWranglerToken() {
  // Wrangler authenticates from the process env, but the operator token lives
  // in `.env.local` (never synced anywhere): seed it so `wrangler` children
  // see it. Shell values always win.
  const merged = loadTargetEnv('cloudflare', ROOT_DIR)
  for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
    if (!process.env[key] && String(merged[key] || '').trim()) {
      process.env[key] = String(merged[key]).trim()
    }
  }
}

// Regenerates the gitignored root `wrangler.toml` from the overlay
// (idempotent, so both the auth step and env-sync can call it): `--no-sync-env`
// runs still get a complete config for `pages deploy` (env-sync rewrites it to
// the drifted-only set when it runs). Split shared with
// sync-cloudflare-env.mjs so vars/secrets/local-only handling cannot drift.
function ensureGeneratedConfig(d1 = null) {
  const { vars } = splitCloudflareEnv(loadTargetFileEnv('cloudflare', ROOT_DIR))
  const project = cloudflareProjectName()
  writeFileSync(
    join(ROOT_DIR, GENERATED_WRANGLER_CONFIG),
    renderWranglerConfig({ project, vars: desiredPagesVars(vars), d1 }),
  )
  return project
}

// Auth + project assurance in a single `pages project list`: verifies the
// token (bad auth fails the list) and creates the Pages project when
// missing, so the env-sync child (PAGES_PROJECT_ASSURED) and the no-sync
// project step below never list a second time. The flag doubles as the
// success marker: when the auth step fails but an interactive caller
// continues anyway, the project step retries the assurance.
function ensureCloudflareProjectAssured() {
  seedWranglerToken()
  const project = cloudflareProjectName()
  const hasToken = Boolean(String(process.env.CLOUDFLARE_API_TOKEN || '').trim())
  const hasAccountId = Boolean(String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim())
  const context = `project "${project}", wrangler bin "${wranglerBin()}", token ${hasToken ? 'present' : 'missing'}, account ${hasAccountId ? 'present' : 'missing'}`
  try {
    ensurePagesProject(project)
  } catch (error) {
    throw new Error(
      `Cloudflare Pages project check failed (${context}): ${error?.message || error} ` +
        'Set CLOUDFLARE_API_TOKEN (+ CLOUDFLARE_ACCOUNT_ID for scoped tokens) in shell or .env.local and retry the deploy.',
    )
  }
  process.env.PAGES_PROJECT_ASSURED = '1'
}

function runCloudflareBuild() {
  console.log(`${formatCommand('npm', ['run', 'build'])} (CF_PAGES=1)`)
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: { ...process.env, CF_PAGES: '1' },
  })
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Cloudflare build failed (exit ${result.status ?? 1}).`)
  }
}

function runCloudflareDeploy(branch = '') {
  const project = cloudflareProjectName()
  const bin = wranglerBin()
  // No `--config`: Pages rejects custom config paths and auto-discovers the
  // generated root `wrangler.toml`; `--project-name` selects the Pages project
  // since the config carries no account binding. `--branch` pins the deploy to
  // the project's production branch so a worktree checkout still ships to prod.
  const args = ['pages', 'deploy', '.svelte-kit/cloudflare', '--project-name', project]
  if (branch) {
    args.push('--branch', branch)
  }
  const fullArgs = bin === 'npx' ? ['wrangler', ...args] : args
  const result = spawnSync(bin, fullArgs, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  process.stderr.write(output)
  if ((result.status ?? 1) !== 0) {
    throw new Error(`wrangler pages deploy failed (exit ${result.status ?? 1}).`)
  }
  const match = /https:\/\/[^\s"']+\.pages\.dev/.exec(output)
  return match ? match[0] : ''
}

// D1 mode is explicit: the Cloudflare flow provisions, binds, and bootstraps
// a D1 database only when CLOUDFLARE_D1_DATABASE names one; otherwise the
// target runs on the existing Neon backend (same file deploys both kinds).
function isCloudflareD1Mode() {
  return resolveD1DatabaseName(loadTargetEnv('cloudflare', ROOT_DIR)) !== ''
}

// D1 binding name derived from the package name (`project-catalog` ->
// `PROJECT_CATALOG_D1`), so the file carries no per-app literals. Callers in
// D1 mode always pass it explicitly to renderWranglerConfig.
function d1BindingName() {
  let pkg = ''
  try {
    pkg = String(JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf8')).name || '')
  } catch {
    pkg = ''
  }
  const slug = pkg
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .replace(/^PROJECT_/, '')
  return `PROJECT_${slug || 'APP'}_D1`
}

// Forbidden keys outside D1 mode: Vercel credentials must never exist on the
// Pages project, but the Neon URL is the backend there. Derived by suffix so
// no per-app database key name lives in shared code.
const NEON_MODE_FORBIDDEN_KEYS = new Set(
  [...CLOUDFLARE_FORBIDDEN_KEYS].filter(key => !key.endsWith('DATABASE_URL')),
)

// Hard isolation gate: forbidden keys on the Pages project are a fatal
// misconfiguration (in D1 mode a remote Neon URL silently wins over the D1
// binding; anywhere, Vercel credentials re-couple the target). The env sync
// removes them; this re-reads to prove it and aborts before build/deploy when
// one survives. A failed read is only a warning — the sync already did its
// best.
async function assertCloudflareIsolation(forbidden = CLOUDFLARE_FORBIDDEN_KEYS) {
  let envVars
  try {
    ;({ envVars } = await fetchPagesEnvState({
      project: cloudflareProjectName(),
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_API_TOKEN,
    }))
  } catch (error) {
    logEvent({ action: 'cloudflare_isolation_skip', details: { error: error?.message || error, level: 'WARN' } })
    return
  }
  const found = Object.keys(envVars).filter(key => forbidden.has(key))
  if (found.length > 0) {
    throw new Error(
      `Cloudflare Pages still carries forbidden key(s): ${found.join(', ')}. ` +
        'Re-run `npm run env:sync:cloudflare -- --prune` and retry.',
    )
  }
}

// Post-deploy safety net: `wrangler pages deploy` replaces the managed plain
// vars with the generated `[vars]` (which the sync always writes in full), so a
// missing key means the deploy dropped something. Re-read the remote plain vars
// and warn on any desired key that is missing or different; never fails the
// deploy.
async function verifyCloudflareEnvVars() {
  try {
    const { vars } = splitCloudflareEnv(loadTargetFileEnv('cloudflare', ROOT_DIR))
    const { envVars } = await fetchPagesEnvState({
      project: cloudflareProjectName(),
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_API_TOKEN,
    })
    const { missing, changed } = diffDesiredVars(desiredPagesVars(vars), envVars)
    const drifted = [...missing, ...changed]
    if (drifted.length > 0) {
      console.error(
        `-> WARNING: Cloudflare Pages does not match ${drifted.length} desired var(s) (${drifted.join(', ')}). ` +
          'Re-run the Cloudflare deploy to re-apply the full [vars] set.',
      )
    }
  } catch (error) {
    logEvent({ action: 'cloudflare_verify_skip', details: { error: error?.message || error, level: 'WARN' } })
  }
}

async function runCloudflareFlow(syncEnv, applySchema, heartbeat, d1Mode) {
  const startedAt = Date.now()
  const state = { appUrl: '', deploymentUrl: '', productionHost: '', productionBranch: '', d1: null }
  // The auth step resolves the live URL from the Pages project (below); no
  // APP_BASE_URL exists on this target.
  // The auth step caches the production host (one `pages project list
  // --json`) so the domain and deploy steps never list again.
  await runSteps('cloudflare', [
    {
      name: 'auth',
      run: async () => {
        // Generate first: the deploy and secret writes need the config at its
        // standard root path; this also makes --no-sync-env work on a fresh
        // checkout.
        ensureGeneratedConfig()
        ensureCloudflareProjectAssured()
        const project = cloudflareProjectName()
        state.productionHost = getPagesProjectDomain(project)
        if (!state.productionHost) {
          throw new Error(
            `Could not resolve the Pages production domain for project ${project}: check wrangler auth and retry.`,
          )
        }
        // The live URL is the production domain: derived, never configured —
        // heartbeat and the final report below use this. There is no
        // custom-domain claim step and no APP_BASE_URL on this target.
        state.appUrl = `https://${state.productionHost}`
        state.productionBranch = await cloudflareProductionBranch(project)
        if (!state.productionBranch) {
          logEvent({
            action: 'cloudflare_production_branch_unresolved',
            details: { level: 'WARN' },
          })
        }
      },
    },
    {
      name: 'project',
      run: () => {
        if (syncEnv === 'yes' || process.env.PAGES_PROJECT_ASSURED === '1') return
        ensurePagesProject(cloudflareProjectName())
      },
    },
    {
      name: 'env-sync',
      run: () => {
        if (syncEnv !== 'yes') {
          logEvent({ action: 'cloudflare_env_sync_skip' })
          return
        }
        logEvent({ action: 'cloudflare_env_sync' })
        runScript('sync-cloudflare-env.mjs')
        state.productionHost = state.productionHost || getPagesProjectDomain(cloudflareProjectName())
      },
    },
    {
      name: 'isolation',
      run: async () => {
        // Runs regardless of --sync-env: a surviving forbidden key would
        // silently re-couple the target (Neon URL over D1 in D1 mode,
        // Vercel credentials anywhere).
        await assertCloudflareIsolation(d1Mode ? CLOUDFLARE_FORBIDDEN_KEYS : NEON_MODE_FORBIDDEN_KEYS)
      },
    },
    {
      name: 'd1',
      run: () => {
        if (!d1Mode) {
          logEvent({ action: 'cloudflare_neon_backend' })
          return
        }
        const databaseName = resolveD1DatabaseName(cloudflareEnv())
        const { status, databaseId } = ensureD1Database(databaseName)
        state.d1 = { binding: d1BindingName(), databaseName, databaseId }
        logEvent({ action: status === 'created' ? 'd1_database_created' : 'd1_database_ready', details: { databaseName, databaseId } })
        // Regenerate the config with the binding: the env sync writes it without
        // one, and `wrangler pages deploy` reads the config at deploy time.
        ensureGeneratedConfig(state.d1)
      },
    },
    {
      name: 'schema',
      run: () => {
        if (d1Mode) {
          if (applySchema !== 'yes') {
            logEvent({ action: 'd1_schema_skip' })
            return
          }
          runScript('apply-d1-schema.mjs', { ...process.env, CLOUDFLARE_D1_DATABASE: state.d1.databaseName })
          return
        }
        if (applySchema === 'done') {
          logEvent({ action: 'neon_schema_applied' })
          return
        }
        if (applySchema !== 'yes') {
          logEvent({ action: 'neon_schema_skip' })
          return
        }
        logEvent({ action: 'neon_schema_apply' })
        runScript('apply-schema.mjs', { ...process.env, PROFILE: 'prod' })
      },
    },
    {
      // The scan job targets the derived production URL: heartbeatSecrets
      // has no APP_BASE_URL on this target, so pass it explicitly.
      name: 'heartbeat',
      run: async () => {
        if (heartbeat === 'skip') {
          logEvent({ action: 'heartbeat_skip', details: { target: 'cloudflare' } })
          return
        }
        await applyHeartbeat(heartbeat, undefined, 'cloudflare', { baseUrl: state.appUrl })
      },
    },
    {
      name: 'build',
      run: () => {
        runCloudflareBuild()
      },
    },
    {
      name: 'deploy',
      run: async () => {
        state.deploymentUrl = runCloudflareDeploy(state.productionBranch)
        // The deploy output carries the one-off preview URL; the stable site
        // is the production domain (the account may suffix the subdomain, so
        // re-resolve it from the project instead of trusting the auth step's
        // cached host).
        const productionHost = getPagesProjectDomain(cloudflareProjectName())
        if (productionHost) {
          state.productionHost = productionHost
          state.appUrl = `https://${productionHost}`
          logEvent({ action: 'cloudflare_production_domain', details: { domain: productionHost } })
        }
        await verifyCloudflareEnvVars()
      },
    },
  ])

  const elapsed = Math.floor((Date.now() - startedAt) / 1000)
  console.log(
    `OK Cloudflare deploy complete -> ${state.appUrl} (preview ${state.deploymentUrl || 'unknown'}, ${formatElapsedTime(elapsed)})`,
  )
  return state.appUrl
}

async function runDeployFlow(profileValue, syncEnv, applySchema, heartbeat, projectFlag) {
  let appVersion = 'unknown'
  try {
    console.log(formatCommand('git', ['-C', ROOT_DIR, 'rev-parse', 'HEAD']))
    const result = spawnSync('git', ['-C', ROOT_DIR, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
    if (result.status === 0 && result.stdout.trim()) {
      appVersion = result.stdout.trim()
    }
  } catch {
    // keep 'unknown'
  }
  const baseUrl = configuredBaseUrl()
  const startedAt = Date.now()
  const state = { deployOutput: '' }

  await runSteps('vercel', [
    {
      // Link only after every flag is validated, and before the env sync so
      // a prompted project name is persisted to .env.vercel in time.
      name: 'link',
      run: () => ensureVercelLink(projectFlag),
    },
    { name: 'auth', run: () => checkVercelAuth() },
    {
      name: 'env-sync',
      run: () => {
        logEvent({ action: 'deploy_profile', details: { profile: profileValue } })
        if (syncEnv !== 'yes') {
          logEvent({ action: 'vercel_env_sync_skip' })
          return
        }
        logEvent({ action: 'vercel_env_sync' })
        runScript('sync-vercel-env.mjs')
      },
    },
    {
      name: 'schema',
      run: () => {
        if (applySchema === 'done') {
          logEvent({ action: 'neon_schema_applied' })
          return
        }
        if (applySchema !== 'yes') {
          logEvent({ action: 'neon_schema_skip' })
          return
        }
        logEvent({ action: 'neon_schema_apply' })
        runScript('apply-schema.mjs', { ...process.env, PROFILE: 'prod' })
      },
    },
    {
      // Domains claim before heartbeat: a conflict-corrected APP_BASE_URL is
      // persisted to .env.vercel by the claim loop, and the heartbeat step
      // below re-reads the files, so the scan job always targets the final URL.
      name: 'domains',
      run: () => syncProjectDomains(),
    },
    {
      name: 'heartbeat',
      run: async () => {
        if (heartbeat === 'skip') {
          logEvent({ action: 'heartbeat_skip', details: { target: 'vercel' } })
          return
        }
        await applyHeartbeat(heartbeat)
      },
    },
    {
      name: 'deploy',
      run: async () => {
        state.deployOutput = await runDeployWithRetry(appVersion)
        const deploymentUrl = extractDeploymentUrl(state.deployOutput)
        if (!deploymentUrl) {
          console.error(state.deployOutput)
          throw new Error('Failed to determine the Vercel deployment URL.')
        }
        state.deploymentUrl = deploymentUrl
        state.deploymentId = extractDeploymentId(state.deployOutput)
      },
    },
    {
      name: 'ready',
      run: () => waitForReadyDeployment(state.deploymentUrl, state.deploymentId),
    },
  ])

  const elapsed = Math.floor((Date.now() - startedAt) / 1000)
  // Re-read: the domains step may have corrected APP_BASE_URL after a conflict.
  const liveUrl = configuredBaseUrl() || baseUrl
  console.log(`OK Vercel deploy complete -> ${liveUrl} (${formatElapsedTime(elapsed)})`)
  return liveUrl
}

main().catch(error => {
  console.error(error?.message || error)
  process.exit(1)
})
