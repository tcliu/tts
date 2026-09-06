#!/usr/bin/env node
// Production deploy to Vercel: syncs .env.vercel, optionally applies the
// Neon schema, deploys with `vercel deploy --prod`, waits for READY, then
// points the project's production domain at APP_BASE_URL.
//
// Usage:
//   node scripts/deploy.mjs [--profile dev|prod] [--target vercel]
//     [--sync-env|--no-sync-env] [--apply-schema|--no-apply-schema]
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseEnvFile } from './env-file.mjs'
import { c } from './_terminal.mjs'
import { interactiveShell } from './_interactive-shell.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = join(SCRIPT_DIR, '..')
const DOMAIN_STATE_FILE = join(ROOT_DIR, '.vercel', 'domain-state.json')
const DEPLOY_MAX_ATTEMPTS = 3
const DEPLOY_RETRY_DELAY_MS = 5000
const DEPLOY_WAIT_TIMEOUT = '5m'

const PROFILES = [
  { value: 'dev', description: 'Local SQLite backend (ephemeral storage on Vercel)' },
  { value: 'prod', description: 'Neon Postgres via DATABASE_URL (syncs .env.vercel first)' },
]

const TARGETS = [{ value: 'vercel', description: 'Deploy the app to Vercel' }]

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
  node scripts/deploy.mjs [--profile dev|prod] [--target vercel] [--sync-env|--no-sync-env] [--apply-schema|--no-apply-schema]

Targets (--target, prod profile only):
  vercel   Deploy the app to Vercel.

Options:
  --profile dev|prod   Backend profile to deploy (also read from $PROFILE).
                       Missing and interactive: arrow-key picker (default prod).
                       Missing and non-interactive: abort.
  --target vercel      Deploy target; only valid with the prod profile
                       (dev has no deploy target). Defaults to vercel.
  --sync-env           Sync .env.vercel to Vercel production env before a prod deploy.
  --no-sync-env        Skip the env sync. prod without a flag asks interactively
                       (default yes); non-interactive defaults to skip.
  --apply-schema       Apply sql/schema.sql to the Neon database before a prod deploy.
  --no-apply-schema    Skip the schema apply (same interactive/non-interactive
                       defaults as --sync-env).

Examples:
  npm run deploy -- --profile prod --target vercel --sync-env
  npm run deploy -- --profile prod --target vercel --sync-env --apply-schema
  PROFILE=prod node scripts/deploy.mjs --target vercel --no-sync-env`)
}

function vercelBin() {
  const found = spawnSync('command -v vercel', { shell: true, encoding: 'utf8' })
  if (found.status === 0 && found.stdout.trim()) {
    return 'vercel'
  }
  return null
}

function runVercelCli(args, { cwd = ROOT_DIR, capture = false } = {}) {
  const bin = vercelBin()
  const command = bin ?? 'npx'
  const fullArgs = bin ? args : ['vercel@latest', ...args]
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
    fail('Vercel CLI is not authenticated. Run `vercel login` and retry the deploy.')
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

async function waitForReadyDeployment(deploymentUrl) {
  console.log('-> Waiting for Vercel deployment to become ready...')
  console.log(`-> Vercel deployment log command: vercel inspect ${deploymentUrl} --logs --wait --timeout ${DEPLOY_WAIT_TIMEOUT}`)
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

  if (inspectStatus !== 0) {
    process.exit(inspectStatus)
  }

  if (logStatus !== 0) {
    process.exit(logStatus)
  }

  process.exit(1)
}

async function runDeployWithRetry(appVersion) {
  let output = ''
  let status = 1

  for (let attempt = 1; attempt <= DEPLOY_MAX_ATTEMPTS; attempt++) {
    const bin = vercelBin()
    const result = spawnSync(bin ?? 'npx', [...(bin ? [] : ['vercel@latest']), 'deploy', '--prod', '--yes', '--no-wait', '--format', 'json'], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      env: { ...process.env, APP_VERSION: appVersion },
    })
    status = result.status ?? 1
    output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    process.stderr.write(output)

    if (status === 0) {
      return output
    }

    if (attempt < DEPLOY_MAX_ATTEMPTS) {
      console.error(`-> Deploy attempt ${attempt}/${DEPLOY_MAX_ATTEMPTS} failed (exit ${status}). Retrying in ${DEPLOY_RETRY_DELAY_MS / 1000}s...`)
      await sleep(DEPLOY_RETRY_DELAY_MS)
    }
  }

  process.exit(status)
}
function configuredBaseUrl() {
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.trim()
  }
  const merged = {
    ...parseEnvFile(join(ROOT_DIR, '.env')),
    ...parseEnvFile(join(ROOT_DIR, '.env.vercel')),
  }
  return String(merged.APP_BASE_URL || '').trim()
}

function configuredDomain() {
  const baseUrl = configuredBaseUrl()
  if (!baseUrl) {
    fail('Missing APP_BASE_URL in shell env, .env, or .env.vercel.')
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
    fail('Failed to list Vercel project domains. Check `vercel whoami` auth and network, then retry.')
  }
  let payload = {}
  try {
    payload = JSON.parse(output || '{}')
  } catch {
    fail('Failed to parse Vercel project domains output. Re-run with a working `vercel` CLI and retry.')
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

function ensureProjectDomain(projectIdValue, domain) {
  const { status } = runVercelApi(`/v9/projects/${projectIdValue}/domains/${domain}`)
  if (status === 0) {
    return
  }
  console.log(`-> Adding project production domain ${domain}...`)
  runVercelApi(`/v10/projects/${projectIdValue}/domains`, ['-X', 'POST', '-f', `name=${domain}`], { capture: false })
}

function removeProjectDomain(projectIdValue, domain) {
  if (!domain) {
    return
  }
  const { status } = runVercelApi(`/v9/projects/${projectIdValue}/domains/${domain}`)
  if (status !== 0) {
    return
  }
  console.log(`-> Removing previous production domain ${domain}...`)
  runVercelApi(`/v9/projects/${projectIdValue}/domains/${domain}`, ['-X', 'DELETE', '--dangerously-skip-permissions'], {
    capture: false,
  })
}

function syncProjectDomains() {
  const configuredDomainValue = configuredDomain()
  const projectIdValue = projectId()
  if (!projectIdValue) {
    fail('Failed to determine the Vercel project ID from .vercel/project.json.')
  }

  ensureProjectDomain(projectIdValue, configuredDomainValue)

  for (const obsoleteDomain of listOtherVercelAppDomains(projectIdValue, configuredDomainValue)) {
    if (!obsoleteDomain) continue
    removeProjectDomain(projectIdValue, obsoleteDomain)
  }

  writeManagedDomainState(configuredDomainValue)
}

// Interactive defaults: every interview question resolves on Enter.
const DEFAULT_PROFILE = 'prod'
const DEFAULT_CONFIRM = 'yes'

const SYNC_ENV_CHOICES = [
  { value: 'yes', label: 'Yes', description: 'sync .env.vercel first' },
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

function renderConfirmPicker() {
  return (entries, state) => {
    const lines = []
    for (let i = 0; i < entries.length; i++) {
      const item = entries[i]
      const cursor = i === state.cursor ? `${c.cyan}>${c.reset}` : ' '
      lines.push(` ${cursor} ${c.green}${item.label}${c.reset} ${c.gray}(${item.description})${c.reset}`)
    }
    lines.push('', `${c.dim}Up/Down: move | Enter: confirm (default yes) | q: cancel${c.reset}`)
    return lines
  }
}

// Linear interview: profile -> sync-env -> apply-schema -> exit. Flag/env
// seeds skip their node; q/Ctrl-C aborts via fail. Non-interactive callers
// never enter the graph (see deployVercelWithTarget branch below).
function buildDeployGraph() {
  const graph = {
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
          fail("Target 'vercel' supports only the prod profile; dev has no deploy target.")
        }
        return graph.syncEnv
      },
    },
    syncEnv: {
      message: 'Sync .env.vercel to Vercel production env before deploy?',
      async process(ctx) {
        if (ctx.syncEnv !== 'yes' && ctx.syncEnv !== 'no') {
          const picked = await ctx.selectOne(SYNC_ENV_CHOICES, {
            defaultValue: DEFAULT_CONFIRM,
            render: renderConfirmPicker(),
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
          const picked = await ctx.selectOne(APPLY_SCHEMA_CHOICES, {
            defaultValue: DEFAULT_CONFIRM,
            render: renderConfirmPicker(),
          })
          if (!picked) {
            fail('Deploy cancelled.')
          }
          ctx.applySchema = picked.value
        }
        return null
      },
    },
  }
  return graph
}

async function runDeployInterview(options) {
  const graph = buildDeployGraph()
  return interactiveShell(graph.profile, {
    options: {
      ctx: {
        profile: options.profileFlag || process.env.PROFILE || '',
        syncEnv: options.syncEnvFlag || '',
        applySchema: options.applySchemaFlag || '',
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


function parseArgs(argv) {
  const options = { profileFlag: '', targetFlag: '', syncEnvFlag: '', applySchemaFlag: '' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg.startsWith('--profile=')) {
      options.profileFlag = arg.slice('--profile='.length)
    } else if (arg === '--profile') {
      options.profileFlag = next || ''
      if (next !== undefined) i++
    } else if (arg.startsWith('--target=')) {
      options.targetFlag = arg.slice('--target='.length)
    } else if (arg === '--target') {
      options.targetFlag = next || ''
      if (next !== undefined) i++
    } else if (arg === '--sync-env') {
      options.syncEnvFlag = 'yes'
    } else if (arg === '--no-sync-env') {
      options.syncEnvFlag = 'no'
    } else if (arg === '--apply-schema') {
      options.applySchemaFlag = 'yes'
    } else if (arg === '--no-apply-schema') {
      options.applySchemaFlag = 'no'
    } else if (arg === '-h' || arg === '--help' || arg === 'help') {
      usage()
      process.exit(0)
    } else if (arg === 'vercel' && !options.targetFlag) {
      // Legacy `deploy.sh vercel` positional: treat as --target vercel.
      options.targetFlag = 'vercel'
    } else {
      fail(`Unknown option: ${arg}`)
    }
  }
  return options
}

function runScript(script, env = process.env) {
  const result = spawnSync('node', [join(SCRIPT_DIR, script)], { cwd: ROOT_DIR, stdio: 'inherit', env })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  // Unknown --target fails fast, before any prompt; the prod-only gate runs
  // after profile resolution inside deployVercelWithTarget.
  if (options.targetFlag && options.targetFlag !== 'vercel') {
    fail(`Unknown target: ${options.targetFlag}`)
  }
  await deployVercelWithTarget(options)
}


async function deployVercelWithTarget(options) {
  const target = options.targetFlag || 'vercel'
  if (target !== 'vercel') {
    fail(`Unknown target: ${target}`)
  }
  // Explicit invalid sources fail fast; the interview only fills gaps.
  if (options.profileFlag && options.profileFlag !== 'dev' && options.profileFlag !== 'prod') {
    fail('PROFILE is mandatory: pass --profile dev|prod, set $PROFILE, or run interactively.')
  }
  const envProfile = options.profileFlag ? '' : process.env.PROFILE || ''
  if (envProfile && envProfile !== 'dev' && envProfile !== 'prod') {
    fail('PROFILE is mandatory: pass --profile dev|prod, set $PROFILE, or run interactively.')
  }
  const seededProfile = options.profileFlag || process.env.PROFILE || ''
  if (process.stdin.isTTY && seededProfile !== 'dev' && (seededProfile === '' || !options.syncEnvFlag || !options.applySchemaFlag)) {
    const answers = await runDeployInterview(options)
    await runDeployFlow(answers.profile, answers.syncEnv, answers.applySchema)
    return
  }
  const profileValue = resolveProfileSync(options.profileFlag)
  if (profileValue !== 'prod') {
    fail("Target 'vercel' supports only the prod profile; dev has no deploy target.")
  }
  const syncEnv = resolveProdConfirmSync(
    profileValue,
    options.syncEnvFlag,
    '-> Non-interactive prod deploy without --sync-env: skipping Vercel env sync.',
  )
  const applySchema = resolveProdConfirmSync(
    profileValue,
    options.applySchemaFlag,
    '-> Non-interactive prod deploy without --apply-schema: skipping schema apply.',
  )
  await runDeployFlow(profileValue, syncEnv, applySchema)
}

async function runDeployFlow(profileValue, syncEnv, applySchema) {
  let appVersion = 'unknown'
  try {
    const result = spawnSync('git', ['-C', ROOT_DIR, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
    if (result.status === 0 && result.stdout.trim()) {
      appVersion = result.stdout.trim()
    }
  } catch {
    // keep 'unknown'
  }
  const baseUrl = configuredBaseUrl()
  const startedAt = Date.now()

  if (!existsSync(join(ROOT_DIR, '.vercel', 'project.json'))) {
    fail(`Missing .vercel/project.json in ${ROOT_DIR}. Run 'vercel link' from the repo root first.`)
  }

  checkVercelAuth()

  console.log(`-> Profile: ${profileValue}`)
  if (syncEnv === 'yes') {
    console.log('-> Syncing .env.vercel to Vercel production env...')
    runScript('sync-vercel-env.mjs')
  } else {
    console.log('-> Skipping Vercel env sync; the dashboard env must already carry PROFILE=prod.')
  }
  if (applySchema === 'yes') {
    console.log('-> Applying sql/schema.sql to the Neon database...')
    runScript('apply-schema.mjs', { ...process.env, PROFILE: 'prod' })
  } else {
    console.log('-> Skipping schema apply; sql/schema.sql must already be applied to Neon.')
  }
  console.log('-> Deploying to Vercel...')
  const deployOutput = await runDeployWithRetry(appVersion)

  const deploymentUrl = extractDeploymentUrl(deployOutput)
  if (!deploymentUrl) {
    console.error('Failed to determine the Vercel deployment URL.')
    console.error(deployOutput)
    process.exit(1)
  }

  await waitForReadyDeployment(deploymentUrl)

  syncProjectDomains()

  const elapsed = Math.floor((Date.now() - startedAt) / 1000)
  console.log(`OK Vercel deploy complete -> ${baseUrl} (${formatElapsedTime(elapsed)})`)
}

main().catch(error => {
  console.error(error?.message || error)
  process.exit(1)
})
