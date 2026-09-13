#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { parseEnvFile } from './env-file.mjs'

export function getWorktreesRoot(root = process.cwd()) {
  return path.join(root, '.worktrees')
}

export function getMainRoot(root = process.cwd()) {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: root,
    encoding: 'utf-8',
    stdio: 'pipe',
  }).trim()
}

export function getGitWorktrees(root = process.cwd()) {
  const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: root,
    encoding: 'utf-8',
    stdio: 'pipe',
  })
  const worktrees = []
  let current = null

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current?.path) worktrees.push(current)
      current = { path: line.slice('worktree '.length) }
      continue
    }
    if (!current) continue
    if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace('refs/heads/', '')
      continue
    }
    if (line === '') {
      if (current.path) worktrees.push(current)
      current = null
    }
  }

  if (current?.path) worktrees.push(current)
  return worktrees.map(worktree => ({
    ...worktree,
    path: path.resolve(worktree.path),
    name: path.relative(getWorktreesRoot(root), path.resolve(worktree.path)),
  }))
}

export function hasGitEntry(dir) {
  return existsSync(path.join(dir, '.git'))
}

export function listNestedGitDirs(root = process.cwd()) {
  const worktreesRoot = getWorktreesRoot(root)
  if (!existsSync(worktreesRoot)) return []

  const results = []

  function scan(dir) {
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (
        entry === 'node_modules' ||
        entry === '.vercel' ||
        entry === '.svelte-kit' ||
        entry.startsWith('.fuse_hidden')
      )
        continue
      const full = path.join(dir, entry)
      let stat
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (!stat.isDirectory()) continue
      if (hasGitEntry(full)) {
        results.push({
          path: path.resolve(full),
          name: path.relative(worktreesRoot, path.resolve(full)),
        })
        continue
      }
      scan(full)
    }
  }

  scan(worktreesRoot)
  return results.sort((a, b) => a.name.localeCompare(b.name))
}

export function listCopyTargets(root = process.cwd()) {
  return listNestedGitDirs(root)
}

export function listDeleteTargets(root = process.cwd()) {
  const registered = new Map(getGitWorktrees(root).map(worktree => [worktree.path, worktree]))
  return listNestedGitDirs(root).map(item => {
    const registeredEntry = registered.get(item.path)
    if (registeredEntry) return registeredEntry
    return {
      ...item,
      branch: readBranchFromGitDir(item.path),
      registered: false,
    }
  })
}

// Every checkout except the main one, each annotated with its commit diffs
// relative to the base branch. This is the single implementation of the
// worktree inventory — `~/.agents/references/worktrees.mjs` is a CLI wrapper
// over it, so the harness and every scaffolded project share one contract:
// `{ base, entries }` with entries `[{ name, path, branch, registered, ahead,
// behind, lastCommitTime }]` newest-first. Uses the local exported primitives
// (`listNestedGitDirs`, `getGitWorktrees`) so there is exactly one
// implementation of each git query in this file.
export function listWorktrees(root = process.cwd()) {
  const mainRoot = path.resolve(getMainRoot(root))
  const base = resolveBaseBranch(root)
  const registered = new Map(getGitWorktrees(root).map(worktree => [worktree.path, worktree]))
  const entries = []
  for (const item of listNestedGitDirs(root)) {
    if (item.path === mainRoot) continue
    const registeredEntry = registered.get(item.path)
    const branch = registeredEntry?.branch ?? readBranchFromGitDir(item.path)
    const counts = getAheadBehind(root, base, branch, registeredEntry ? true : false)
    entries.push({
      name: item.name,
      path: item.path,
      branch,
      registered: Boolean(registeredEntry),
      ahead: counts?.ahead ?? null,
      behind: counts?.behind ?? null,
      lastCommitTime: getLastCommitTime(item.path),
    })
  }
  entries.sort((a, b) => (b.lastCommitTime ?? -1) - (a.lastCommitTime ?? -1))
  return { base, entries }
}

export function listRegisterTargets(root = process.cwd()) {
  const registered = new Set(getGitWorktrees(root).map(worktree => worktree.path))
  return listNestedGitDirs(root).filter(item => !registered.has(item.path))
}

export function readBranchFromGitDir(worktreePath) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: worktreePath,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim()
  } catch {
    return null
  }
}

export function resolveBaseBranch(root = process.cwd()) {
  try {
    const ref = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
      cwd: root,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim()
    const name = ref.replace('refs/remotes/origin/', '')
    if (name && name !== 'HEAD' && name !== ref) return name
  } catch {}
  for (const cand of ['main', 'master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', `refs/heads/${cand}`], {
        cwd: root,
        encoding: 'utf-8',
        stdio: 'pipe',
      })
      return cand
    } catch {}
  }
  return null
}

// Commits the branch is ahead of / behind the base (both repo-global names,
// resolved in root). Null when unresolvable; skipped for the main row,
// detached HEAD, and unregistered dirs (foreign .git names may collide).
export function getAheadBehind(root, base, branch, registered = true) {
  if (!base || !branch || branch === base || branch === 'HEAD') return null
  if (registered === false) return null
  try {
    const out = execFileSync('git', ['rev-list', '--left-right', '--count', `${base}...${branch}`], {
      cwd: root,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim()
    const [behind, ahead] = out.split(/\s+/).map(Number)
    if (Number.isNaN(behind) || Number.isNaN(ahead)) return null
    return { ahead, behind }
  } catch {
    return null
  }
}

// Unix timestamp of a worktree's HEAD commit, resolved inside its own path
// (correct for unregistered dirs too). Null when unresolvable.
export function getLastCommitTime(worktreePath) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct'], {
      cwd: worktreePath,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim()
    const t = Number(out)
    return Number.isNaN(t) ? null : t
  } catch {
    return null
  }
}

// SHA of a worktree's HEAD, resolved inside its own path (correct for
// detached HEAD and unregistered dirs too). Null when unresolvable.
export function getWorktreeHead(worktreePath) {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: worktreePath,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim()
    if (/^[0-9a-f]{4,40}$/i.test(out)) {
      return out
    }
    return null
  } catch {
    return null
  }
}

// True when the worktree's HEAD is already contained in the base branch, so
// the worktree is deprecated (removable modulo dirty files). False when it
// holds commits the base lacks; null when unresolvable. A checkout tracking
// the base itself is never deprecated. SHA-based (`merge-base --is-ancestor`)
// so detached HEAD and unregistered dirs resolve too, unlike ahead/behind
// which needs a registered branch name.
export function isMergedToBase(options) {
  const { root, base, worktreePath, branch } = options
  if (!root || !base || !worktreePath) {
    return null
  }
  if (!branch || branch === base) {
    return false
  }
  const head = getWorktreeHead(worktreePath)
  if (!head) {
    return null
  }
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', head, base], {
      cwd: root,
      encoding: 'utf-8',
      stdio: 'pipe',
    })
    return true
  } catch (error) {
    if (error && error.status === 1) {
      return false
    }
    return null
  }
}

// Read-only scan for deprecated worktrees: every non-main checkout whose HEAD
// is already contained in the base branch. Entries mirror `listWorktrees`
// (newest-first) plus `merged: true` and the `dirty` file count so callers
// can skip worktrees with uncommitted work. Never throws for unresolvable
// rows; they are omitted.
export function listDeprecatedWorktrees(root = process.cwd()) {
  const { base, entries } = listWorktrees(root)
  const deprecated = []
  for (const entry of entries) {
    if (!entry.branch || entry.branch === base) {
      continue
    }
    const merged = isMergedToBase({ root, base, worktreePath: entry.path, branch: entry.branch })
    if (merged !== true) {
      continue
    }
    deprecated.push({ ...entry, merged: true, dirty: countDirtyFiles(entry.path) })
  }
  return { base, entries: deprecated }
}

// Number of entries `git status --porcelain` reports for a worktree (0 =
// clean), or null when git cannot answer. Delete flows surface this before
// acting because `git worktree remove --force` discards uncommitted work.
export function countDirtyFiles(worktreePath) {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], {
      cwd: worktreePath,
      encoding: 'utf-8',
      stdio: 'pipe',
    })
    return out.split('\n').filter(line => line.trim()).length
  } catch {
    return null
  }
}

export function registerWorktree(root, worktreePath, branch) {
  execFileSync('git', ['worktree', 'add', worktreePath, '-b', branch], {
    cwd: root,
    stdio: 'pipe',
  })
}

export function removeWorktree(root, worktree) {
  const mainRoot = getMainRoot(root)
  if (path.resolve(worktree.path) === mainRoot) {
    return false
  }

  try {
    execFileSync('git', ['worktree', 'remove', '--force', worktree.path], {
      cwd: root,
      encoding: 'utf-8',
      stdio: 'pipe',
    })
    return true
  } catch {
    try {
      rmSync(worktree.path, { recursive: true, force: true })
      return true
    } catch {
      return false
    }
  }
}

export function deleteBranch(root, branch) {
  if (!branch) return false
  try {
    execFileSync('git', ['branch', '-D', branch], {
      cwd: root,
      encoding: 'utf-8',
      stdio: 'pipe',
    })
    return true
  } catch {
    return false
  }
}

// Create a worktree and run the standard post-create setup shared by
// scripts/create-worktree.mjs and the worktree-manager TUI: register the
// branch, copy gitignored dev files, write DEV_TAG, and carry the main
// checkout's uncommitted work. Throws with `phase: 'register' | 'setup'` so
// callers can report the failing step; a setup failure leaves the partial
// worktree for the caller to roll back via `removeWorktreeAndBranch`, since
// only the caller knows how to surface the rollback.
export function setupWorktree({ root, worktreePath, branch }) {
  try {
    registerWorktree(root, worktreePath, branch)
  } catch (error) {
    throw Object.assign(error, { phase: 'register' })
  }
  try {
    copyDevFiles(root, worktreePath)
    setDevTag(worktreePath, branch)
    return { carried: copyUncommittedChanges(root, worktreePath) }
  } catch (error) {
    throw Object.assign(error, { phase: 'setup' })
  }
}

// Best-effort rollback for a failed `setupWorktree`: remove the worktree and
// its branch, reporting which half succeeded so callers surface cleanup
// failures instead of assuming the rollback was complete. Both steps run even
// when the first fails, matching the CLI's previous behavior.
export function removeWorktreeAndBranch(root, worktreePath, branch) {
  return {
    removed: removeWorktree(root, { path: worktreePath }),
    branchDeleted: deleteBranch(root, branch),
  }
}

// Mirrors the `git check-ref-format --branch` rules that matter before the
// branch exists: charset first, then the separator/dot/`.lock` rules that git
// would otherwise reject only after `git worktree add` has already run.
export function isValidBranchName(name) {
  if (typeof name !== 'string' || !name) return false
  if (!/^[a-zA-Z0-9._/-]+$/.test(name)) return false
  if (name.includes('..') || name.includes('//') || name.includes('@{')) return false
  if (name.startsWith('/') || name.endsWith('/')) return false
  if (name.startsWith('.') || name.endsWith('.') || name.endsWith('.lock')) return false
  return name.split('/').every(part => part && !part.startsWith('.') && !part.endsWith('.lock'))
}

export function setDevTag(worktreeRoot, tag) {
  const filePath = path.join(worktreeRoot, '.env.local')
  const content = existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''
  // One dotenv parser for the whole script layer (env-file.mjs), so quoting
  // and comment handling cannot drift between scripts.
  const values = parseEnvFile(filePath)
  const entry = `DEV_TAG=${tag}`
  if (!Object.prototype.hasOwnProperty.call(values, 'DEV_TAG')) {
    writeFileSync(filePath, content.replace(/\s*$/, '') + (content.trim() ? '\n' : '') + `${entry}\n`)
    return
  }
  const output = content.split(/\r?\n/).map(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return line
    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) return line
    if (trimmed.slice(0, separatorIndex).trim() !== 'DEV_TAG') return line
    return entry
  })
  // Collapse trailing blank lines first: `split` leaves an empty tail when the
  // file ends with a newline, so a plain join would append a blank line on
  // every rewrite and grow the file without bound.
  writeFileSync(filePath, `${output.join('\n').replace(/\s*$/, '')}\n`)
}

export function copyDevFiles(sourceRoot, targetRoot) {
  // Returns the worktree-relative names of what was actually copied, so
  // callers can report it (skipped files are omitted, not listed).
  const copied = []
  for (const file of ['.env', '.env.local']) {
    if (copyEnvFile(path.join(sourceRoot, file), path.join(targetRoot, file))) {
      copied.push(file)
    }
  }
  return copied
}

// Copies only when the source exists and the target is missing (never
// overwrites). Returns true when a copy happened.
function copyEnvFile(sourceEnv, targetEnv) {
  if (existsSync(sourceEnv) && !existsSync(targetEnv)) {
    copyFileSync(sourceEnv, targetEnv)
    return true
  }
  return false
}

// Carries uncommitted work from the source checkout into a fresh worktree: a
// single `git diff HEAD` patch (staged + unstaged tracked changes together,
// so split patches can never disagree) plus untracked non-ignored files
// (copied). Returns { patched, copied } so callers can report it. Never
// touches the source checkout.
export function copyUncommittedChanges(sourceRoot, targetRoot) {
  const copied = []
  const notes = []
  const describe = (error) => (error instanceof Error ? error.message : String(error))
  let patched = false
  // A failure here means the source checkpoint could not be read, so the caller
  // must be told the carry-over is incomplete rather than silently reporting none.
  let patch = ''
  try {
    patch = execFileSync('git', ['diff', 'HEAD', '--binary'], {
      cwd: sourceRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
      maxBuffer: 256 * 1024 * 1024,
    })
  } catch (error) {
    notes.push(`could not read the tracked diff (${describe(error)})`)
  }
  if (patch.trim()) {
    try {
      execFileSync('git', ['apply', '--whitespace=nowarn', '-'], {
        cwd: targetRoot,
        input: patch,
        encoding: 'utf-8',
        stdio: 'pipe',
      })
      patched = true
    } catch (error) {
      notes.push(`could not apply the tracked diff (${describe(error)})`)
    }
  }
  // `-z` keeps paths NUL-delimited and unquoted, so untracked names that contain
  // non-ASCII or escaped characters are carried instead of silently skipped.
  let status = ''
  try {
    status = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
      cwd: sourceRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
    })
  } catch (error) {
    notes.push(`could not list untracked files (${describe(error)})`)
  }
  for (const record of status.split('\0')) {
    if (!record.startsWith('?? ')) continue
    const rel = record.slice(3)
    if (!rel) continue
    const source = path.join(sourceRoot, rel)
    const target = path.join(targetRoot, rel)
    if (existsSync(target) || !existsSync(source)) continue
    mkdirSync(path.dirname(target), { recursive: true })
    cpSync(source, target, { recursive: true })
    copied.push(rel)
  }
  return { patched, copied, notes }
}

export function readDevTag(worktreeRoot) {
  return parseEnvFile(path.join(worktreeRoot, '.env.local')).DEV_TAG ?? null
}
