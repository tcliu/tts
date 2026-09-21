#!/usr/bin/env node

// Pure helpers for Vercel project auto-link. `deploy.mjs` imports these; the
// CLI prompting and `vercel` invocations stay there so this module has no
// side effects and is unit-testable.
const PROJECT_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/

export function isValidProjectName(name) {
  return PROJECT_NAME_PATTERN.test(String(name || ''))
}

export function normalizeProjectName(value) {
  const name = String(value ?? '')
    .trim()
    .toLowerCase()
  return isValidProjectName(name) ? name : ''
}

// Precedence: explicit CLI flag, then the merged env (shell + .env files).
// A present-but-invalid value throws so typos fail loudly instead of
// falling through to an interactive prompt; absent values resolve to ''.
export function resolveProjectName({ flag = '', env = {} } = {}) {
  const rawFlag = String(flag ?? '').trim()
  if (rawFlag) {
    const name = normalizeProjectName(rawFlag)
    if (!name) {
      throw new Error(`Invalid Vercel project name: ${rawFlag}`)
    }
    return name
  }
  const rawEnv = String(env?.VERCEL_PROJECT ?? '').trim()
  if (rawEnv) {
    const name = normalizeProjectName(rawEnv)
    if (!name) {
      throw new Error(`Invalid VERCEL_PROJECT: ${rawEnv}`)
    }
    return name
  }
  return ''
}

export function defaultProjectName(packageName) {
  return normalizeProjectName(packageName)
}

// Link decision for a checkout: `linked` is the project already recorded in
// .vercel/project.json ('' when unlinked), `requested` the resolved
// --project / VERCEL_PROJECT value ('' when none). Returns one of:
// keep (linked and nothing new, or already matching), link (unlinked with a
// name), switch (linked but a different name was requested), or
// missing (unlinked with no name — prompt or abort upstream).
export function decideLinkAction({ linked = '', requested = '' } = {}) {
  const current = normalizeProjectName(linked)
  const want = normalizeProjectName(requested)
  if (!want) {
    return current ? { action: 'keep', name: current } : { action: 'missing', name: '' }
  }
  if (!current) {
    return { action: 'link', name: want }
  }
  if (want === current) {
    return { action: 'keep', name: current }
  }
  return { action: 'switch', name: want, from: current }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Line-preserving KEY=value upsert for a dotenv file: an existing
// uncommented entry is replaced in place (comments and ordering untouched),
// otherwise the entry is appended. Always ends the file with exactly one
// newline.
export function upsertEnvLine(content, key, value) {
  const lines = String(content ?? '').split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`)
  let done = false
  const out = lines.map(line => {
    if (!done && pattern.test(line) && !line.trimStart().startsWith('#')) {
      done = true
      return `${key}=${value}`
    }
    return line
  })
  if (!done) {
    out.push(`${key}=${value}`)
  }
  return `${out.join('\n')}\n`
}
