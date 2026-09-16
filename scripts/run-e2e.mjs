#!/usr/bin/env node

// Unified e2e entry point: `npm run e2e [-- [project] [branch] [-- <playwright args>]]`
//
// 1. Scan for a running dev server via find-running-apps.mjs (identity + branch).
// 2. If none matches, start `npm run dev` on the first free port in range and
//    wait until its /api/catalog answers.
// 3. Run Playwright against the resolved URL (E2E_BASE_URL), then stop the
//    server only when this script started it.
//
// Defaults: project from package.json `name` (/api/catalog id),
// branch = this checkout's git branch.

import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import net from 'node:net'
import { pathToFileURL } from 'node:url'
import { findRunningApps } from './find-running-apps.mjs'

const START_TIMEOUT_MS = 120_000
const POLL_MS = 500

// App props from the manifest: the default e2e project is this package's
// `name` (it matches the app's /api/catalog id), and `e2eEnv` carries extra
// environment for a spawned dev server. session-catalog ships
// `SESSIONS_LIVE=0` there so e2e serves the deterministic bundled payload
// instead of whatever sessions exist on the machine; the hook is inert for
// apps that do not read those vars.
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const defaultProject = typeof manifest.name === 'string' && manifest.name ? manifest.name : null
const extraSpawnEnv = manifest.e2eEnv != null && typeof manifest.e2eEnv === 'object' ? manifest.e2eEnv : {}

function currentBranch() {
  try {
    const out = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim()
    return out && out !== 'HEAD' ? out : null
  } catch {
    return null
  }
}

function isPortFree(port, host) {
  return new Promise(resolve => {
    const socket = net.connect(port, host)
    socket.once('connect', () => {
      socket.end()
      resolve(false)
    })
    // Only a refused connection proves the port is free; any other error
    // (permission, address, timeout) must not be treated as an open slot.
    socket.once('error', error => resolve(error.code === 'ECONNREFUSED'))
  })
}

async function waitForCatalog(url, project, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const res = await fetch(`${url}/api/catalog`, { signal: AbortSignal.timeout(1500) })
      if (res.ok) {
        const payload = await res.json().catch(() => null)
        if (payload && typeof payload === 'object' && payload.id === project) return payload
      }
    } catch {
      // Not up yet.
    }
    if (Date.now() >= deadline) return null
    await new Promise(r => setTimeout(r, POLL_MS))
  }
}

function stopServer(child) {
  // The child is `npm run dev` (npm → sh → vite): signal the whole process
  // group so the vite grandchild dies too, never just the npm wrapper.
  return new Promise(resolve => {
    if (child.exitCode !== null || child.pid == null) return resolve()
    const kill = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }, 5000)
    child.once('exit', () => {
      clearTimeout(kill)
      resolve()
    })
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  })
}

// Resolve the dev server to test: reuse the running one for this
// project+branch, otherwise start the first free port in range and wait for
// its /api/catalog to answer. Returns { url, branch, server } where `server`
// is non-null only when this script started it (and must stop it again).
async function resolveBaseUrl({ project, branch, host }) {
  const apps = await findRunningApps({ project, branch, host })
  if (apps.length > 0) {
    const url = `http://${host}:${apps[0].port}`
    console.log(`e2e: ${project}@${apps[0].branch ?? '?'} -> ${url} (running)`)
    return { url, branch: apps[0].branch, server: null }
  }
  if (branch && branch !== currentBranch()) {
    console.error(
      `e2e: no dev server for project=${project} branch=${branch}; start it from that branch's worktree first`,
    )
    process.exit(1)
  }
  const base = Number(process.env.CATALOG_SCAN_DEV_BASE_PORT) || 5173
  const count = Number(process.env.CATALOG_SCAN_DEV_PORT_COUNT) || 10
  for (let i = 0; i < count; i++) {
    const port = base + i
    if (!(await isPortFree(port, host))) continue
    const url = `http://${host}:${port}`
    console.log(`e2e: no match, starting dev server on ${port} …`)
    const child = spawn('npm', ['run', 'dev', '--', '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      // Deterministic-e2e hook: extra env comes from the manifest (see above).
      env: { ...process.env, ...extraSpawnEnv },
    })
    child.stdout.on('data', d => process.stdout.write(`[dev:${port}] ${d}`))
    child.stderr.on('data', d => process.stderr.write(`[dev:${port}] ${d}`))
    const payload = await waitForCatalog(url, project, START_TIMEOUT_MS)
    if (!payload) {
      console.error(`e2e: dev server on ${port} did not answer in time`)
      await stopServer(child)
      process.exit(1)
    }
    console.log(`e2e: ${project}@${payload.branch ?? '?'} -> ${url} (started)`)
    return { url, branch: payload.branch, server: child }
  }
  console.error(`e2e: no free port in ${base}–${base + count - 1} and no match`)
  process.exit(1)
}

async function main() {
  const sep = process.argv.indexOf('--')
  const ownArgs = (sep === -1 ? process.argv.slice(2) : process.argv.slice(2, sep)).filter(a => !a.startsWith('-'))
  const playArgs = sep === -1 ? [] : process.argv.slice(sep + 1)
  const project = ownArgs[0] ?? defaultProject
  const branch = ownArgs[1] ?? currentBranch()
  const host = '127.0.0.1'

  const resolved = await resolveBaseUrl({ project, branch, host })
  const child = spawn('npx', ['playwright', 'test', ...playArgs], {
    stdio: 'inherit',
    env: { ...process.env, E2E_BASE_URL: resolved.url },
  })
  const code = await new Promise(resolve => child.on('exit', c => resolve(c ?? 1)))
  if (resolved.server) await stopServer(resolved.server)
  process.exit(code)
}

// Importing this module (for its helpers) must not start a Playwright run.
const isCli = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCli) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
