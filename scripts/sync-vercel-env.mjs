#!/usr/bin/env node
// Syncs the keys in SOURCE_FILES (.env.vercel) to the Vercel production env.
// An empty local value is skipped so the remote value survives — blank a key
// in the Vercel dashboard instead. Pass --prune to remove remote keys that
// are absent from .env.vercel.
//
// Trade-off: values are passed with `--value`, so they appear in the process
// argv while the command runs. `vercel env add` also accepts the value on
// stdin, but the CLI always stores secrets encrypted, so that form cannot be
// verified to preserve the value byte-for-byte (a trailing newline would
// silently break password/session secrets). Keep --value; this script runs
// interactively on the operator's machine, not in CI.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatCommand } from './_terminal.mjs'

const TARGET = 'production'
const SOURCE_FILES = ['.env.vercel']

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {}

  const values = {}
  const content = readFileSync(filePath, 'utf8')

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) continue

    const key = trimmed.slice(0, separatorIndex).trim()
    let value = trimmed.slice(separatorIndex + 1).trim()
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
    if (quoted) {
      value = value.slice(1, -1)
    } else {
      value = value.split(/\s+#/, 1)[0].trim()
    }

    values[key] = value
  }

  return values
}

function loadDesiredEnv() {
  return SOURCE_FILES.reduce((merged, file) => ({ ...merged, ...parseEnvFile(join(process.cwd(), file)) }), {})
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

  let syncedCount = 0
  for (const [key, value] of Object.entries(desiredEnv)) {
    // Empty local values never blank the remote: fill the key in
    // .env.vercel and re-run the sync.
    if (!value) {
      console.log(`skipped ${key} (empty in .env.vercel; remote value kept)`)
      continue
    }
    await upsertVercelEnv(key, value)
    console.log(`synced ${key}`)
    syncedCount += 1
  }

  const orphans = [...existingKeys].filter(key => !desiredKeys.has(key))

  if (process.argv.includes('--prune')) {
    for (const key of orphans) {
      await removeVercelEnv(key)
      console.log(`removed ${key}`)
    }
  } else if (orphans.length > 0) {
    console.log(
      `Skipped ${orphans.length} unmanaged env var(s) (${orphans.join(', ')}). ` +
        'Re-run with --prune to remove them.',
    )
  }

  console.log(`Synced ${syncedCount} of ${desiredKeys.size} env vars to Vercel ${TARGET}`)
}

main().catch(error => {
  console.error(error?.message || error)
  process.exit(1)
})
