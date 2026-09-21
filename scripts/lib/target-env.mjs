#!/usr/bin/env node
// Unified per-target env loader: `.env.prod` overlaid by the target file
// (`.env.vercel` / `.env.cloudflare`), so both deploy targets resolve the
// same way. Load order everywhere: `.env` < `.env.local` < `.env.prod` <
// overlay < shell. `.env.local` carries operator-only keys (tokens,
// CRONJOB_API_KEY) and is never synced; shell always wins.
//
// Deploy, heartbeat, and both env-sync scripts merge through
// `loadTargetEnv`/`loadTargetFileEnv`; the remaining read-only tooling loaders
// (`db-config.mjs`, `vercel.mjs`) keep their own Vercel-scoped merges.
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { parseEnvFile } from '../env-file.mjs'

const LIB_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = join(LIB_DIR, '..', '..')

export const TARGET_OVERLAYS = {
  vercel: '.env.vercel',
  cloudflare: '.env.cloudflare',
}

// Merged env for a target. `root` is injectable so tests can point at a
// fixture dir; production callers omit it (repo root).
export function loadTargetEnv(target = 'vercel', root = DEFAULT_ROOT) {
  const overlay = TARGET_OVERLAYS[target] || TARGET_OVERLAYS.vercel
  return {
    ...parseEnvFile(join(root, '.env')),
    ...parseEnvFile(join(root, '.env.local')),
    ...parseEnvFile(join(root, '.env.prod')),
    ...parseEnvFile(join(root, overlay)),
    ...process.env,
  }
}

// Files-only merge of the sync universe: `.env.prod` + overlay. `.env` and
// `.env.local` are deliberately excluded — they hold local/operator keys
// (dev overrides, tokens) that must never be pushed to a target. Shell never
// invents synced keys either.
export function loadTargetFileEnv(target = 'vercel', root = DEFAULT_ROOT) {
  const merged = {}
  for (const file of ['.env.prod', targetOverlayFile(target)]) {
    Object.assign(merged, parseEnvFile(join(root, file)))
  }
  return merged
}

// Overlay filename for a target (heartbeat + sync scripts).
export function targetOverlayFile(target = 'vercel') {
  return TARGET_OVERLAYS[target] || TARGET_OVERLAYS.vercel
}

// Source files merged into the remote target env, in order.
export function targetSourceFiles(target = 'vercel') {
  return ['.env.prod', targetOverlayFile(target)]
}
