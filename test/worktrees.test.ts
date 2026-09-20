import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  branchCommitRange,
  listProtectedPids,
  parseNameStatusZ,
  terminateProcessesInPath,
} from '../scripts/_worktrees.mjs'

type Entry = { code: string; path: string }
type Range = { range: string | null }

describe('parseNameStatusZ', () => {
  it('pairs status and path records from git output', () => {
    // Real `git diff --no-renames --name-status -z` output: every field is
    // NUL-terminated, with a trailing NUL after the last path.
    const entries = parseNameStatusZ('M\0AGENTS.md\0A\0scripts/new file.mjs\0') as Entry[]
    expect(entries).toEqual([
      { code: 'M', path: 'AGENTS.md' },
      { code: 'A', path: 'scripts/new file.mjs' },
    ])
  })

  it('keeps paths that need quoting intact', () => {
    const entries = parseNameStatusZ('M\0a\tb\\c "d".ts\0') as Entry[]
    expect(entries).toEqual([{ code: 'M', path: 'a\tb\\c "d".ts' }])
  })

  it('drops malformed records and an empty path', () => {
    // Porcelain dirty codes (`??`) are not branch status codes.
    expect(parseNameStatusZ('??\0notes.md\0')).toEqual([])
    expect(parseNameStatusZ('M\0')).toEqual([])
    expect(parseNameStatusZ('')).toEqual([])
  })
})

describe('branchCommitRange', () => {
  it('builds a merge-base range per direction', () => {
    expect(branchCommitRange({ base: 'master', branch: 'feat/x', direction: 'ahead' }) as Range).toEqual({
      range: 'master...feat/x',
    })
    expect(branchCommitRange({ base: 'master', branch: 'feat/x', direction: 'behind' }) as Range).toEqual({
      range: 'feat/x...master',
    })
  })

  it('treats a branch on the base as an empty comparison, not a failure', () => {
    expect(branchCommitRange({ base: 'master', branch: 'master', direction: 'ahead' }) as Range).toEqual({
      range: 'master...master',
    })
  })

  it('is unresolvable without a base, on detached HEAD, unregistered, or unknown direction', () => {
    expect((branchCommitRange({ base: null, branch: 'feat/x', direction: 'ahead' }) as Range).range).toBeNull()
    expect((branchCommitRange({ base: 'master', branch: 'HEAD', direction: 'ahead' }) as Range).range).toBeNull()
    expect(
      (branchCommitRange({ base: 'master', branch: 'feat/x', direction: 'ahead', registered: false }) as Range).range,
    ).toBeNull()
    expect((branchCommitRange({ base: 'master', branch: 'feat/x', direction: 'sideways' }) as Range).range).toBeNull()
  })
})

describe('listProtectedPids', () => {
  it('always contains the current process', () => {
    expect((listProtectedPids() as Set<number>).has(process.pid)).toBe(true)
  })
})

type TerminateResult = { killed: { pid: number }[]; skipped: { pid: number | null; reason: string }[] }

// /proc-gated: the terminate helper resolves process roots through /proc,
// which only exists on Linux. Elsewhere the scan is unreadable by design.
const itLinux = existsSync('/proc') ? it : it.skip

describe('terminateProcessesInPath', () => {
  itLinux('terminates a spawned sleeper rooted in the target dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'terminate-probe-'))
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: dir })
    const pid = child.pid
    if (pid === undefined) {
      child.kill('SIGKILL')
      rmSync(dir, { recursive: true, force: true })
      throw new Error('sleeper failed to spawn')
    }
    try {
      const { killed, skipped } = (await terminateProcessesInPath(dir, { graceMs: 50 })) as TerminateResult
      expect(skipped).toEqual([])
      expect(killed.map(k => k.pid)).toContain(pid)
      let alive = true
      try {
        process.kill(pid, 0)
      } catch {
        alive = false
      }
      expect(alive).toBe(false)
    } finally {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Already terminated by the helper.
      }
      rmSync(dir, { recursive: true, force: true })
    }
  })

  itLinux('is a no-op when nothing is rooted in the target dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'terminate-empty-'))
    try {
      const { killed, skipped } = (await terminateProcessesInPath(dir, { graceMs: 10 })) as TerminateResult
      expect(killed).toEqual([])
      expect(skipped).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
