#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { parseEnvFile } from './env-file.mjs'

// Worktree location: `<project>/.worktrees` unless the project overrides it
// through `WORKTREES_DIR` in its gitignored `.env.local` (see
// `resolveWorktreesDir`). One named default keeps every script on the same
// directory instead of each one spelling out the literal.
export const DEFAULT_WORKTREES_DIR = '.worktrees'
export const WORKTREES_DIR_KEY = 'WORKTREES_DIR'

// Absolute path of the configured worktree directory: a relative value is
// resolved against the project root, an absolute one is used as given.
export function getWorktreesRoot(root = process.cwd(), worktreesDir = DEFAULT_WORKTREES_DIR) {
  if (!worktreesDir) return path.join(root, DEFAULT_WORKTREES_DIR)
  return path.isAbsolute(worktreesDir) ? worktreesDir : path.join(root, worktreesDir)
}

// The project's configured worktree directory (relative value as authored, so
// the prompt can show it back), falling back to the default.
export function resolveWorktreesDir(root = process.cwd()) {
  const value = parseEnvFile(path.join(root, '.env.local'))[WORKTREES_DIR_KEY]
  return value && value.trim() ? value.trim() : DEFAULT_WORKTREES_DIR
}

// Persist the worktree directory in the project's gitignored `.env.local`,
// clearing the key when the value is the default so the file keeps only real
// overrides. Returns the stored value (`null` once cleared).
export function setWorktreesDir(root, worktreesDir) {
  const value = String(worktreesDir ?? '').trim()
  const next = !value || value === DEFAULT_WORKTREES_DIR ? null : value
  setLocalEnvValue(path.join(root, '.env.local'), WORKTREES_DIR_KEY, next)
  return next
}

// True when git ignores `target` inside `root`; null when git cannot answer.
// A worktree directory must stay out of version control, so the manager warns
// when a new location is not covered by `.gitignore`.
export function isPathIgnored(root, target) {
  const relative = path.relative(root, path.resolve(target))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false
  try {
    execFileSync('git', ['check-ignore', '-q', '--', relative], { cwd: root, stdio: 'pipe' })
    return true
  } catch (error) {
    return error?.status === 1 ? false : null
  }
}

export function getMainRoot(root = process.cwd()) {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: root,
    encoding: 'utf-8',
    stdio: 'pipe',
  }).trim()
}

export function getGitWorktrees(root = process.cwd(), worktreesDir = DEFAULT_WORKTREES_DIR) {
  const worktreesRoot = getWorktreesRoot(root, worktreesDir)
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
    name: path.relative(worktreesRoot, path.resolve(worktree.path)),
  }))
}

export function hasGitEntry(dir) {
  return existsSync(path.join(dir, '.git'))
}

export function listNestedGitDirs(root = process.cwd(), worktreesDir = DEFAULT_WORKTREES_DIR) {
  const worktreesRoot = getWorktreesRoot(root, worktreesDir)
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

export function listCopyTargets(root = process.cwd(), worktreesDir = DEFAULT_WORKTREES_DIR) {
  return listNestedGitDirs(root, worktreesDir)
}

export function listDeleteTargets(root = process.cwd(), worktreesDir = DEFAULT_WORKTREES_DIR) {
  const registered = new Map(getGitWorktrees(root, worktreesDir).map(worktree => [worktree.path, worktree]))
  return listNestedGitDirs(root, worktreesDir).map(item => {
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
export function listWorktrees(root = process.cwd(), worktreesDir = DEFAULT_WORKTREES_DIR) {
  const mainRoot = path.resolve(getMainRoot(root))
  const base = resolveBaseBranch(root)
  const registered = new Map(getGitWorktrees(root, worktreesDir).map(worktree => [worktree.path, worktree]))
  const entries = []
  for (const item of listNestedGitDirs(root, worktreesDir)) {
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

export function listRegisterTargets(root = process.cwd(), worktreesDir = DEFAULT_WORKTREES_DIR) {
  const registered = new Set(getGitWorktrees(root, worktreesDir).map(worktree => worktree.path))
  return listNestedGitDirs(root, worktreesDir).filter(item => !registered.has(item.path))
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
export function listDeprecatedWorktrees(root = process.cwd(), worktreesDir = DEFAULT_WORKTREES_DIR) {
  const { base, entries } = listWorktrees(root, worktreesDir)
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
// Delegates to `getDirtyDetail` so the count and the preview always come from
// one porcelain read.
export function countDirtyFiles(worktreePath) {
  return getDirtyDetail(worktreePath).dirty
}

// Max dirty file lines kept per worktree for the manager's detail line.
// The full count comes from the same porcelain output, so refreshList makes
// one git call per checkout instead of two. `files` holds the first `limit`
// `{ code, path }` entries; both are null when git cannot answer, which
// callers treat as unsafe rather than clean.
export const DIRTY_FILES_PREVIEW = 5

// Every changed file in a worktree as `{ code, path }`, newest porcelain
// semantics: `code` is the two-letter status trimmed to its meaningful half
// (`M`, `A`, `??`). Parsed from the NUL-delimited form so paths that need
// quoting survive intact; a rename/copy entry carries its source path in the
// following record, which is skipped. Null when git cannot answer.
export function listDirtyFiles(worktreePath) {
  try {
    const out = execFileSync('git', ['status', '--porcelain=v1', '-z'], {
      cwd: worktreePath,
      encoding: 'utf-8',
      stdio: 'pipe',
    })
    const records = out.split('\0')
    const files = []
    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      if (!record) continue
      files.push({ code: record.slice(0, 2).trim() || '??', path: record.slice(3) })
      if (record[0] === 'R' || record[0] === 'C') i++ // rename/copy source record
    }
    return files
  } catch {
    return null
  }
}

export function getDirtyDetail(worktreePath, limit = DIRTY_FILES_PREVIEW) {
  const files = listDirtyFiles(worktreePath)
  if (!files) return { dirty: null, files: null }
  return { dirty: files.length, files: files.slice(0, limit) }
}

// Line cap for one file's diff in the manager's viewer; a vendored file or a
// generated bundle must not lock the TUI filling the pane.
export const FILE_DIFF_MAX_LINES = 2000

// Text diff of one changed file, for the uncommitted-changes viewer. Untracked
// entries have no committed counterpart, so they are diffed against /dev/null;
// git exits 1 when the files differ, which is the expected result and still
// carries the patch on stdout. Returns `{ lines, truncated }`, or null when the
// entry has no readable text diff (an untracked directory, a missing file).
export function getFileDiff({ worktreePath, file, maxLines = FILE_DIFF_MAX_LINES }) {
  // `--no-index` compares filesystem paths, so it must not be given the `--`
  // separator: git would treat `/dev/null` as relative to the entry's own
  // directory and fail to read anything.
  const args =
    file.code === '??'
      ? ['diff', '--no-index', '--binary', '/dev/null', file.path]
      : ['diff', 'HEAD', '--', file.path]
  let out
  try {
    out = execFileSync('git', args, {
      cwd: worktreePath,
      encoding: 'utf-8',
      stdio: 'pipe',
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch (error) {
    if (typeof error?.stdout !== 'string') return null
    out = error.stdout // --no-index exit 1: files differ, patch is still here
  }
  const lines = out.split('\n')
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const truncated = lines.length > maxLines
  return { lines: truncated ? lines.slice(0, maxLines) : lines, truncated }
}

// Processes whose current working directory lies inside `worktreePath`.
// Deleting a worktree out from under a running process half-removes it: the
// checkout is unregistered but its files, branch, and server are left behind
// (observed with a dev server running inside the target). Delete flows refuse
// guarded targets and name the PIDs instead. Linux-only (`/proc` cwd scan,
// self excluded); returns null where /proc is unavailable, and callers treat
// null as unsafe (refuse or fail the target) rather than proceeding unguarded.
export function findProcessesInPath(worktreePath) {
  const root = path.resolve(worktreePath)
  let entries
  try {
    entries = readdirSync('/proc')
  } catch {
    return null
  }
  const found = []
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    const pid = Number(entry)
    if (pid === process.pid) continue
    let cwd
    try {
      cwd = readlinkSync(`/proc/${pid}/cwd`)
    } catch {
      continue // exited, or another user's process
    }
    if (cwd === root || cwd.startsWith(root + path.sep)) {
      found.push({ pid, cmd: readProcessCmd(pid) })
    }
  }
  return found
}

function readProcessCmd(pid) {
  try {
    const parts = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
    if (parts.length === 0) return null
    parts[0] = path.basename(parts[0])
    // Strip control characters (including ESC): argv renders raw into the
    // TUI status line, so embedded escapes would act as terminal injection.
    const cmd = parts.join(' ').replace(/[\0-\x1F\x7F]/g, '')
    return cmd.length > 80 ? `${cmd.slice(0, 80)}\u2026` : cmd
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

// Upper bound for `git worktree remove --force` before the rmSync fallback
// takes over: a hung remove must never freeze the manager's synchronous batch
// delete with the confirm dialog still on screen.
export const REMOVE_TIMEOUT_MS = 120_000

export function removeWorktree(root, worktree, options = {}) {
  const { timeoutMs = REMOVE_TIMEOUT_MS } = options
  const mainRoot = getMainRoot(root)
  if (path.resolve(worktree.path) === mainRoot) {
    return false
  }

  try {
    execFileSync('git', ['worktree', 'remove', '--force', worktree.path], {
      cwd: root,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: timeoutMs,
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
  setLocalEnvValue(path.join(worktreeRoot, '.env.local'), 'DEV_TAG', tag)
}

// Set, replace, or clear one key in a gitignored dotenv file, preserving
// comments and unrelated lines. `value === null` removes the line; duplicate
// keys collapse to the last write. Creating the file is allowed — it is the
// project's local-only config surface.
function setLocalEnvValue(filePath, key, value) {
  const content = existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''
  const kept = []
  let replaced = false
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    const separatorIndex = trimmed && !trimmed.startsWith('#') ? trimmed.indexOf('=') : -1
    if (separatorIndex !== -1 && trimmed.slice(0, separatorIndex).trim() === key) {
      if (value === null) continue // cleared
      if (!replaced) {
        kept.push(`${key}=${value}`)
        replaced = true
      }
      continue // a duplicate key collapses into the first write
    }
    kept.push(line)
  }
  if (value !== null && !replaced) {
    // Collapse trailing blank lines first: `split` leaves an empty tail when
    // the file ends with a newline, so a plain join would append a blank line
    // on every rewrite and grow the file without bound.
    while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop()
    kept.push(`${key}=${value}`)
  }
  writeFileSync(filePath, `${kept.join('\n').replace(/\s*$/, '')}\n`)
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
