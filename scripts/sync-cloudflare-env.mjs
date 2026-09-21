#!/usr/bin/env node
// Syncs `.env.prod` overlaid by `.env.cloudflare` to the Cloudflare Pages
// project (CLOUDFLARE_PROJECT owns the project name, APP_BASE_URL the live
// URL). Generates the gitignored root `wrangler.toml` (name + static Pages
// stanza + `[vars]`) that `wrangler pages deploy` auto-discovers, and pushes
// secrets via `wrangler pages secret put` (value on stdin, never argv).
//
// `wrangler pages deploy` treats `[vars]` as the complete managed plain-var
// set: a config-managed plain var absent from it is DELETED from the project.
// The sync therefore always writes the full desired set — an early version
// wrote only the drifted subset and wiped every plain var, because the deploy
// replaces rather than merges. The remote read still reports
// missing/changed/unchanged and drives `--prune`:
//   * vars    — report drift, then write every desired var.
//   * secrets — put only with `--secrets=missing`, which skips the names
//               already present. Cloudflare never returns secret values, so an
//               updated value is undetectable; the default `always` re-puts
//               every secret so rotations always land.
//   * `--prune` removes remote keys absent from the .env files (plain vars and
//               secrets alike), mirroring `sync-vercel-env.mjs --prune`.
// `--dry-run` reports the plan without writing. Empty local values are skipped
// (the remote value survives); local-only keys are never synced.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnvFile } from './env-file.mjs'
import {
  CLOUDFLARE_LOCAL_ONLY_KEYS,
  desiredPagesVars,
  ensurePagesProject,
  GENERATED_WRANGLER_CONFIG,
  renderWranglerConfig,
  splitCloudflareEnv,
  wranglerBin,
} from './lib/cloudflare.mjs'
import {
  diffDesiredSecrets,
  diffDesiredVars,
  fetchPagesEnvState,
  findOrphanKeys,
  patchPagesEnvVars,
} from './lib/cloudflare-pages-env.mjs'
import { runWithConcurrency } from './lib/concurrency.mjs'
import { loadTargetFileEnv } from './lib/target-env.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = join(SCRIPT_DIR, '..')
// Shared prod values (.env.prod) overlaid by Cloudflare-only values
// (.env.cloudflare); the overlay wins on conflict. Files-only merge: shell
// never invents synced keys (see loadTargetFileEnv).
const SOURCE_FILES = ['.env.prod', '.env.cloudflare']
const GENERATED_FILE = join(ROOT_DIR, GENERATED_WRANGLER_CONFIG)
const SECRET_CONCURRENCY = 4
const SECRET_MODES = ['always', 'missing']

function fail(message) {
  console.error(message)
  process.exit(1)
}

function parseFlags(argv) {
  const dryRun = argv.includes('--dry-run')
  const prune = argv.includes('--prune')
  const secretFlags = argv.filter(arg => arg.startsWith('--secrets='))
  const unknown = argv.filter(
    arg => arg !== '--dry-run' && arg !== '--prune' && !arg.startsWith('--secrets='),
  )
  if (unknown.length > 0) {
    fail(`Unknown option: ${unknown.join(', ')} (expected --dry-run, --prune, --secrets=always|missing).`)
  }
  // A repeated flag with conflicting values is a mistake, not last-wins.
  const modes = new Set(secretFlags.map(arg => arg.slice('--secrets='.length)))
  if (modes.size > 1) {
    fail(`Conflicting --secrets values: ${[...modes].join(', ')}.`)
  }
  const secrets = secretFlags.length > 0 ? secretFlags[0].slice('--secrets='.length) : 'always'
  if (!SECRET_MODES.includes(secrets)) {
    fail(`Unknown --secrets mode: ${secrets} (expected ${SECRET_MODES.join('|')}).`)
  }
  return { dryRun, prune, secrets }
}

// Project name from the last generated config: fallback so a checkout that
// predates CLOUDFLARE_PROJECT keeps working.
function generatedProjectName() {
  if (!existsSync(GENERATED_FILE)) {
    return ''
  }
  const match = /^name\s*=\s*"([^"]+)"/m.exec(readFileSync(GENERATED_FILE, 'utf8'))
  return match ? match[1] : ''
}

function runWranglerAsync(args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const bin = wranglerBin()
    const fullArgs = bin === 'npx' ? ['wrangler', ...args] : args
    // No command echo here: the only caller passes the secret on stdin, and
    // per-key completion lines below carry the progress signal instead.
    const child = spawn(bin, fullArgs, { cwd: ROOT_DIR, stdio: ['pipe', 'inherit', 'inherit'] })
    const stdin = child.stdin
    stdin.on('error', () => {
      // The child can exit before draining stdin (EPIPE on early failure);
      // the close handler below reports the real exit status.
    })
    stdin.end(input)
    child.on('error', reject)
    child.on('close', code => {
      if ((code ?? 1) === 0) {
        resolve()
      } else {
        reject(new Error(`wrangler ${fullArgs.join(' ')} failed (exit ${code ?? 1}).`))
      }
    })
  })
}

async function putSecret(project, key, value) {
  await runWranglerAsync(['pages', 'secret', 'put', key, '--project', project], { input: value })
  console.log(`synced secret ${key}`)
}

async function main() {
  const { dryRun, prune, secrets: secretsMode } = parseFlags(process.argv.slice(2))
  const missing = SOURCE_FILES.filter(file => !existsSync(join(ROOT_DIR, file)))
  if (missing.length > 0) {
    fail(`Missing ${missing.join(', ')}: shared prod values live in .env.prod, Cloudflare-only values in .env.cloudflare.`)
  }
  // Files-only merge for the key universe (shell never invents synced keys);
  // shell still seeds auth below via process.env.
  const raw = loadTargetFileEnv('cloudflare', ROOT_DIR)
  // Wrangler authenticates from the process env; the operator token lives in
  // `.env.local` (never synced — outside the file universe above). Seed it so
  // `secret put` and the remote read work standalone; shell always wins.
  const local = parseEnvFile(join(ROOT_DIR, '.env.local'))
  for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
    if (!process.env[key] && String(local[key] || '').trim()) {
      process.env[key] = String(local[key]).trim()
    }
  }
  // Split shared with deploy.mjs (splitCloudflareEnv): local-only keys log as
  // skipped, empty values keep the remote value, secrets go to the store.
  const { project: overlayProject, vars, secrets } = splitCloudflareEnv(raw)
  for (const key of Object.keys(raw)) {
    if (CLOUDFLARE_LOCAL_ONLY_KEYS.has(key)) {
      console.log(`skipped ${key} (local-only; never synced)`)
    } else if (!raw[key]) {
      console.log(`skipped ${key} (empty in .env files; remote value kept)`)
    }
  }
  const project = overlayProject || generatedProjectName()
  if (!project) {
    fail('Missing CLOUDFLARE_PROJECT in .env.cloudflare: set it to the Pages project name.')
  }

  // The desired set always carries the forced build vars, matching what
  // renderWranglerConfig would emit for a full write.
  const desiredVars = desiredPagesVars(vars)
  const desiredKeys = [...Object.keys(desiredVars), ...Object.keys(secrets)]

  // Remote state drives the missing/updated skip and --prune. A failed read
  // degrades vars to a full write; `--secrets=missing` cannot be honored
  // without it, so it fails loudly rather than silently overwriting.
  let remote = null
  try {
    remote = await fetchPagesEnvState({
      project,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_API_TOKEN,
    })
  } catch (error) {
    if (secretsMode === 'missing') {
      fail(`Cannot use --secrets=missing without remote env vars: ${error?.message || error}`)
    }
    console.error(`-> Could not read remote Pages env vars (${error?.message || error}); syncing all vars.`)
  }

  const varDiff = remote
    ? diffDesiredVars(desiredVars, remote.envVars)
    : { missing: Object.keys(desiredVars), changed: [], unchanged: [], drift: Object.keys(desiredVars) }
  const secretDiff = remote
    ? diffDesiredSecrets(secrets, remote.envVars)
    : { missing: Object.keys(secrets), present: [] }
  if (remote) {
    const drifted = varDiff.drift
    console.log(
      `-> vars: ${varDiff.missing.length} missing, ${varDiff.changed.length} changed, ${varDiff.unchanged.length} unchanged` +
        (drifted.length > 0 ? ` (${drifted.join(', ')})` : ''),
    )
    console.log(`-> secrets: ${secretDiff.missing.length} missing, ${secretDiff.present.length} present`)
  }

  // Always write the full desired set: the deploy replaces the managed plain
  // vars with exactly `[vars]`, so omitting unchanged keys deletes them. Drift
  // is reported above but never used to shrink the written set.
  const varsToWrite = { ...desiredVars }
  if (dryRun) {
    for (const key of Object.keys(varsToWrite)) {
      console.log(`would sync var ${key}`)
    }
  } else {
    writeFileSync(GENERATED_FILE, renderWranglerConfig({ project, vars: varsToWrite }))
    for (const key of Object.keys(varsToWrite)) {
      console.log(`synced var ${key}`)
    }
  }

  // Secrets: `always` re-puts every secret so a rotated value lands; `missing`
  // skips the names already present (values are write-only, so only existence
  // can be compared).
  const secretsToPut = secretsMode === 'missing' ? secretDiff.missing : Object.keys(secrets)
  for (const key of secretDiff.present) {
    if (!secretsToPut.includes(key)) {
      console.log(`kept secret ${key} (already present; --secrets=always to rotate)`)
    }
  }
  if (!dryRun && secretsToPut.length > 0 && process.env.PAGES_PROJECT_ASSURED !== '1') {
    // Secrets need the Pages project to exist; first sync creates it. The
    // deploy flow assures the project in its auth step and passes
    // PAGES_PROJECT_ASSURED=1, skipping this second listing.
    ensurePagesProject(project)
  }
  const pendingSecrets = secretsToPut.map(key => [key, secrets[key]])
  if (dryRun) {
    for (const [key] of pendingSecrets) {
      console.log(`would sync secret ${key}`)
    }
  } else {
    await runWithConcurrency(
      pendingSecrets.map(
        ([key, value]) =>
          async () => {
            await putSecret(project, key, value)
            return key
          },
      ),
      SECRET_CONCURRENCY,
    )
  }

  // Prune: remote secrets no longer in the .env universe. The deploy already
  // reconciles plain vars to `[vars]` (replace semantics), so only secrets need
  // an explicit delete. Opt-in, like the Vercel sync.
  const orphans = remote
    ? findOrphanKeys(remote.envVars, desiredKeys).filter(key => remote.envVars[key]?.type !== 'plain_text')
    : []
  if (orphans.length > 0) {
    if (!prune) {
      console.log(
        `Skipped ${orphans.length} unmanaged secret(s) (${orphans.join(', ')}). Re-run with --prune to remove them.`,
      )
    } else if (dryRun) {
      for (const key of orphans) {
        console.log(`would prune secret ${key}`)
      }
    } else {
      await patchPagesEnvVars({
        project,
        envVars: Object.fromEntries(orphans.map(key => [key, null])),
        configHash: remote.configHash,
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
        token: process.env.CLOUDFLARE_API_TOKEN,
      })
      for (const key of orphans) {
        console.log(`pruned secret ${key}`)
      }
    }
  }

  console.log(
    `Synced ${Object.keys(varsToWrite).length} var(s) to Cloudflare Pages (${project})` +
      (remote ? ` (${varDiff.missing.length} missing, ${varDiff.changed.length} changed)` : '') +
      ` and ${secretsToPut.length} of ${Object.keys(secrets).length} secret(s)`,
  )
}

main().catch(error => {
  console.error(error?.message || error)
  process.exit(1)
})
