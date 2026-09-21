#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'

// Keys that are local tooling config and must never be synced to a deploy
// target: VERCEL_PROJECT is the CLI link slug (deploy.mjs only),
// CLOUDFLARE_PROJECT owns the Pages project name (generator input only),
// APP_BASE_URL is read by local scripts only (deploy domain sync, heartbeat
// job URL) — no server module reads any of them at runtime.
export const LOCAL_ONLY_ENV_KEYS = new Set(['APP_BASE_URL', 'VERCEL_PROJECT', 'CLOUDFLARE_PROJECT'])

// Dependency-free dotenv parser shared by CLI scripts. db-config.mjs pulls in
// the Neon driver at import time, which deploy-only scripts must not pay for.
export function parseEnvFile(filePath) {
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }

  return values
}
