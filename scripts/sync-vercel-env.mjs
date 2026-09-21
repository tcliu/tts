#!/usr/bin/env node
// Syncs the unified target env (.env.prod, overlaid by .env.vercel) to the
// Vercel production env.
// An empty merged value is skipped so the remote value survives — blank a key
// in the Vercel dashboard instead. Pass --prune to remove remote keys that
// are absent from both files.
//
// Trade-off: values are passed with `--value`, so they appear in the process
// argv while the command runs. `vercel env add` also accepts the value on
// stdin, but the CLI always stores secrets encrypted, so that form cannot be
// verified to preserve the value byte-for-byte (a trailing newline would
// silently break password/session secrets). Keep --value; this script runs
// interactively on the operator's machine, not in CI.

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LOCAL_ONLY_ENV_KEYS, parseEnvFile } from './env-file.mjs'
import { formatCommand } from './_terminal.mjs'
import { runWithConcurrency } from './lib/concurrency.mjs'
import { loadTargetFileEnv } from './lib/target-env.mjs'

const TARGET = 'production'
// Changed-key upserts are independent (one key per `env add`), so a small
// worker pool hides per-invocation CLI/API latency without hammering the API.
const UPSERT_CONCURRENCY = 4

function loadDesiredEnv() {
  // Files-only merge: `.env.prod` overlaid by `.env.vercel` (see
  // loadTargetFileEnv). `.env`/`.env.local`/shell are excluded so local keys
  // are never invented into the synced set.
  const merged = loadTargetFileEnv('vercel', process.cwd())
  // Local-only tooling keys are never managed: dropping them here also marks
  // them as prune candidates, so `--prune` cleans up values synced before
  // the exclusion existed.
  for (const key of LOCAL_ONLY_ENV_KEYS) {
    if (key in merged) {
      console.log(`skipped ${key} (local-only; never synced)`)
      delete merged[key]
    }
  }
  return merged
}

function spawnVercelBin(bin, args) {
  return new Promise((resolve, reject) => {
    console.log(formatCommand(bin, args))
    const child = spawn(bin, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })

    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) {
        resolve(stdout)
      } else {
        const message = stderr.trim() || stdout.trim() || `vercel exited with code ${code}`
        reject(new Error(message))
      }
    })
  })
}

async function runVercelCommand(args) {
  try {
    return await spawnVercelBin('vercel', args)
  } catch (error) {
    if (error.code === 'ENOENT') {
      const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
      return await spawnVercelBin(npx, ['vercel@latest', ...args])
    }
    throw error
  }
}

async function listVercelEnvKeys() {
  const output = await runVercelCommand(['env', 'ls', TARGET, '--format', 'json'])
  const parsed = JSON.parse(output)
  return new Set((parsed.envs || []).map(entry => entry.key))
}

// Decrypted remote values for the diff below. The pull file lives in a
// private temp dir and is removed before returning, so secrets only ever
// rest on the operator's machine next to the source .env files. Values are
// never printed; only key names reach the log.
async function pullVercelEnv() {
  const dir = mkdtempSync(join(tmpdir(), 'vercel-env-'))
  try {
    const file = join(dir, '.env.production.local')
    await runVercelCommand(['env', 'pull', file, '--environment', TARGET, '--yes'])
    return parseEnvFile(file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function upsertVercelEnv(key, value) {
  await runVercelCommand(['env', 'add', key, TARGET, '--value', value, '--force', '--yes'])
}

async function removeVercelEnv(key) {
  await runVercelCommand(['env', 'rm', key, TARGET, '--yes'])
}

async function main() {
  const desiredEnv = loadDesiredEnv()
  const desiredKeys = new Set(Object.keys(desiredEnv))
  const existingKeys = await listVercelEnvKeys()

  // Pull once and write only what drifted: a no-change deploy costs one
  // pull instead of N `env add` invocations. A failed pull falls back to
  // the legacy full upsert, so CLI differences never break the sync; a
  // parse miss on the pulled side only costs an extra upsert, never a skip
  // (a remotely-changed value always differs from the desired one).
  let remote = null
  try {
    remote = await pullVercelEnv()
  } catch (error) {
    console.error(`-> env pull failed (${error?.message || error}); syncing all keys instead.`)
  }

  const pending = []
  let unchangedCount = 0
  for (const [key, value] of Object.entries(desiredEnv)) {
    // Empty merged values never blank the remote: fill the key in
    // .env.prod (shared) or .env.vercel (Vercel-only) and re-run the sync.
    if (!value) {
      console.log(`skipped ${key} (empty in .env files; remote value kept)`)
      continue
    }
    if (remote && remote[key] === value) {
      unchangedCount += 1
      continue
    }
    pending.push([key, value])
  }
  await runWithConcurrency(
    pending.map(
      ([key, value]) =>
        async () => {
          await upsertVercelEnv(key, value)
          console.log(`synced ${key}`)
          return key
        },
    ),
    UPSERT_CONCURRENCY,
  )
  const syncedCount = pending.length

  const orphans = [...existingKeys].filter(key => !desiredKeys.has(key))

  if (process.argv.includes('--prune')) {
    await runWithConcurrency(
      orphans.map(
        key =>
          async () => {
            await removeVercelEnv(key)
            console.log(`removed ${key}`)
            return key
          },
      ),
      UPSERT_CONCURRENCY,
    )
  } else if (orphans.length > 0) {
    console.log(
      `Skipped ${orphans.length} unmanaged env var(s) (${orphans.join(', ')}). ` +
        'Re-run with --prune to remove them.',
    )
  }

  console.log(
    `Synced ${syncedCount} of ${desiredKeys.size} env vars to Vercel ${TARGET} (${unchangedCount} unchanged)`,
  )
}

main().catch(error => {
  console.error(error?.message || error)
  process.exit(1)
})
