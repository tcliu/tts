import { describe, expect, it } from 'vitest'

import { branchCommitRange, parseNameStatusZ } from '../scripts/_worktrees.mjs'

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
