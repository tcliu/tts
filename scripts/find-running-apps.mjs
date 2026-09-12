#!/usr/bin/env node

// List running dev-server apps by probing GET /api/catalog across a port
// range and reporting every responder as a JSON array.
//
// Usage:
//   node scripts/find-running-apps.mjs [--project tts] [--branch main]
//     [--port-start 5173] [--max-ports 10]
//
// Prints `[{ project, branch, port }]`. With no --project/--branch filter,
// every port whose GET /api/catalog returns 200 OK with a parsable body is
// listed. Range honors the scanner env overrides CATALOG_SCAN_DEV_BASE_PORT
// (5173) and CATALOG_SCAN_DEV_PORT_COUNT (10); explicit flags win over env.
// Timeout honors CATALOG_SCAN_REQUEST_TIMEOUT_MS (1500).
import { parseArgs as parseCliArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

const DEFAULT_PORT_START = 5173
const DEFAULT_MAX_PORTS = 10
const DEFAULT_TIMEOUT_MS = 1500

function numEnv(name, fallback, min, max) {
  const raw = Number(process.env[name])
  if (!Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, Math.floor(raw)))
}

/**
 * Probe `GET /api/catalog` from portStart through
 * `portStart + maxPorts - 1` and return every responder as
 * `{ project, branch, port }`, filtered by `project`/`branch` when given.
 */
export async function findRunningApps({
  project = null,
  branch = null,
  portStart = numEnv('CATALOG_SCAN_DEV_BASE_PORT', DEFAULT_PORT_START, 1, 65535),
  maxPorts = numEnv('CATALOG_SCAN_DEV_PORT_COUNT', DEFAULT_MAX_PORTS, 1, 100),
  timeoutMs = numEnv('CATALOG_SCAN_REQUEST_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 100, 30000),
  host = '127.0.0.1',
  fetchImpl = fetch,
} = {}) {
  const apps = []
  for (let i = 0; i < maxPorts; i++) {
    const port = portStart + i
    let payload
    try {
      const res = await fetchImpl(`http://${host}:${port}/api/catalog`, {
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) continue
      payload = await res.json().catch(() => null)
    } catch {
      continue
    }
    if (payload == null || typeof payload !== 'object') continue
    if (typeof payload.id !== 'string') continue
    if (project != null && payload.id !== project) continue
    if (branch != null && payload.branch !== branch) continue
    apps.push({
      project: payload.id,
      branch: payload.branch ?? null,
      port,
    })
  }
  return apps
}

function parseArgs(argv) {
  const { values } = parseCliArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      project: { type: 'string' },
      branch: { type: 'string' },
      'port-start': { type: 'string' },
      'max-ports': { type: 'string' },
    },
  })
  const opts = {}
  if (values.project !== undefined) opts.project = values.project
  if (values.branch !== undefined) opts.branch = values.branch
  for (const [flag, key] of [
    ['port-start', 'portStart'],
    ['max-ports', 'maxPorts'],
  ]) {
    if (values[flag] === undefined) continue
    const n = Number(values[flag])
    if (!Number.isInteger(n) || n < 1) throw new Error(`flag --${flag} needs a positive integer`)
    opts[key] = n
  }
  return opts
}

const isCli = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCli) {
  try {
    console.log(JSON.stringify(await findRunningApps(parseArgs(process.argv.slice(2)))))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
