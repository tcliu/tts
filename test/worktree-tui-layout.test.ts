import { describe, expect, it } from 'vitest'

import {
  CHANGES_BODY_START,
  CHANGES_TAB_ROW,
  CHANGES_TABS,
  HELP_MAX_LINES,
  buildChangesDetail,
  buildChangesDialog,
  buildCreateDialog,
  buildPromptDialog,
  buildWorktreesDirDialog,
  changesEntryLabel,
  changesFullscreenGeometry,
  changesTabHitColumns,
  changesTabLine,
  colorizeDiffLine,
  currentOptions,
  dialogGeometry,
  dialogTop,
  fitHelpLines,
  frameHeight,
  frameSplit,
  layout,
  listWindow,
  paneWidthsForLabels,
} from '../scripts/_worktree-tui/layout.mjs'

type LayoutResult = { rows: number; cols: number; boxH: number; helpLines: string[]; boxW: number }
type SplitResult = { listH: number; cmdH: number }
type Dialog = { lines: string[]; start: number; total: number }

const ansi = /\x1b\[[0-9;]*m/g

// Terminal sizes a TUI is realistically run at, including the small end where
// the minimum box height clamps.
const SIZES: Array<[number, number]> = [
  [24, 80],
  [20, 60],
  [30, 100],
  [40, 120],
  [50, 200],
  [24, 120],
  [30, 80],
]

// Rebuild the exact line sequence `draw()` emits in worktree-manager.mjs:
// header, subheader, box (borders + boxH rows, plus the divider and pane rows
// when open), the focused-row detail line, then status and the help block.
// Keep this in step with `draw()`; `frameHeight` is the same count computed
// from the layout budget, so a drift between budget and renderer fails here.
function drawnLineCount({
  rows,
  cols,
  paneOpen,
}: {
  rows: number
  cols: number
  paneOpen: boolean
}) {
  const { boxH, helpLines } = layout({ termRows: rows, termCols: cols }) as LayoutResult
  const { listH, cmdH } = frameSplit({ boxH, paneOpen }) as SplitResult
  let lines = 2 // header + subheader
  lines += 1 + listH + 1 // box top border + box rows + bottom border
  if (paneOpen) lines += 1 + cmdH // divider + command output (prompt included in cmdH)
  lines += 1 // focused-row detail line
  lines += 1 // status
  lines += helpLines.length
  return { lines, budget: frameHeight({ boxH, helpLines }), boxH, helpLines, listH }
}

describe('layout frame budget', () => {
  for (const [rows, cols] of SIZES) {
    for (const paneOpen of [false, true]) {
      it(`fits ${rows}x${cols} with paneOpen=${paneOpen}`, () => {
        const drawn = drawnLineCount({ rows, cols, paneOpen })
        // The renderer's own count and the budget must agree.
        expect(drawn.lines).toBe(drawn.budget)
        // Nothing is clipped from the tail, so the help block survives.
        expect(drawn.budget).toBeLessThanOrEqual(rows)
        expect(drawn.helpLines.length).toBeGreaterThan(0)
        // An unclamped box means the budget itself is correct, not the clamp.
        expect(drawn.boxH).toBeGreaterThan(3)
      })
    }
  }

  it('reserves the pane divider inside the box budget', () => {
    const { boxH } = layout({ termRows: 24, termCols: 80 }) as LayoutResult
    const { listH, cmdH } = frameSplit({ boxH, paneOpen: true }) as SplitResult
    expect(listH + cmdH + 1).toBe(boxH)
    const win = listWindow({ count: 9, cursor: 8, listH }) as { first: number; last: number }
    expect(win.last).toBeLessThanOrEqual(8)
    expect(win.last - win.first + 1).toBeLessThanOrEqual(listH)
  })

  it('still fits the clamped minimum terminal instead of a negative box height', () => {
    const small = layout({ termRows: 10, termCols: 60 }) as LayoutResult
    expect(small.rows).toBe(20) // rows is floored at 20
    expect(small.boxH).toBeGreaterThanOrEqual(3)
    expect(frameHeight({ boxH: small.boxH, helpLines: small.helpLines })).toBe(small.rows)
  })
})

describe('control hints', () => {
  for (const [rows, cols] of SIZES) {
    it(`stays within ${HELP_MAX_LINES} lines at ${cols} cols`, () => {
      const { helpLines } = layout({ termRows: rows, termCols: cols }) as LayoutResult
      expect(helpLines.length).toBeLessThanOrEqual(HELP_MAX_LINES)
      for (const line of helpLines) expect(line.length).toBeLessThanOrEqual(cols)
    })
  }

  it('fits two lines untrimmed on an 80-column terminal', () => {
    const { helpLines } = layout({ termRows: 24, termCols: 80 }) as LayoutResult
    expect(helpLines).toHaveLength(2)
    expect(helpLines.join(' ')).not.toContain('…')
  })

  it('marks a trimmed tail on a narrow terminal', () => {
    const lines = fitHelpLines('one two three four five six seven eight nine ten', 20, 2) as string[]
    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith('…')).toBe(true)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(20)
  })
})

describe('menu dialog geometry', () => {
  const options = currentOptions({ menuTab: 0, checkedCount: 2 })

  it('offers the changes overlay and keeps settings off the menu', () => {
    expect(options).toContain('Show changes…')
    // Reachable with `w` in the list instead: the menu lists actions only.
    expect(options).not.toContain('Worktrees dir…')
  })

  it('shows the whole Actions list on a 24-row terminal', () => {
    const { listH } = dialogGeometry({ cols: 80, rows: 24 }) as { listH: number }
    expect(listH).toBeGreaterThanOrEqual(options.length)
  })

  it('places the dialog two rows above center and inside the frame', () => {
    const rows = 24
    const { listH } = dialogGeometry({ cols: 80, rows }) as { listH: number }
    const dialogH = listH + 4 // top border + tabs + separator + listH + bottom border
    const centered = Math.floor((rows - dialogH) / 2)
    expect(dialogTop({ rows, dialogH })).toBe(centered - 2)
    expect(dialogTop({ rows, dialogH }) + dialogH).toBeLessThanOrEqual(rows)
  })

  it('never pushes the dialog off the top of a short terminal', () => {
    expect(dialogTop({ rows: 20, dialogH: 30 })).toBe(0)
  })
})

describe('prompt dialogs', () => {
  it('shares one field renderer between the create and directory prompts', () => {
    const create = buildCreateDialog({ name: [...'feat/x'], caret: 6, error: null, dialogW: 60 }) as Dialog
    const dir = buildWorktreesDirDialog({
      value: [...'my-wts'],
      caret: 6,
      error: null,
      dialogW: 60,
      defaultDir: '.worktrees',
    }) as Dialog
    expect(create.lines.join('\n')).toContain('Branch name')
    expect(dir.lines.join('\n')).toContain('WORKTREES DIR')
    expect(dir.lines.join('\n')).toContain('Directory')
    expect(dir.lines.join('\n')).toContain('.worktrees') // reset target in the hint
    expect(dir.lines.join('\n')).toContain('my-wts')
  })

  it('shows the error in place of the key hints, and keeps the box shape', () => {
    const ok = buildPromptDialog({ title: 'T', label: 'L', hint: 'h', value: [], dialogW: 60 }) as Dialog
    const bad = buildPromptDialog({
      title: 'T',
      label: 'L',
      hint: 'h',
      value: [],
      dialogW: 60,
      error: 'bad value',
    }) as Dialog
    expect(ok.lines).toHaveLength(bad.lines.length)
    expect(ok.lines.join('\n')).toContain('Enter applies')
    expect(bad.lines.join('\n')).toContain('bad value')
    for (const line of [...ok.lines, ...bad.lines]) expect(line).toBeDefined()
  })
})

describe('diff coloring and pane widths', () => {
  const files = [
    { code: 'M', path: 'src/lib/app.ts' },
    { code: 'M', path: 'scripts/very/long/path/to/a/file/name/that/should/not/eat/the/diff.ts' },
    { code: '??', path: 'notes.md' },
  ]

  it('colors additions, removals, hunks, and the preamble distinctly', () => {
    expect(colorizeDiffLine('+added')).toContain('added')
    expect(colorizeDiffLine('+added')).not.toBe(colorizeDiffLine('-removed'))
    expect(colorizeDiffLine('@@ -1 +1 @@')).not.toBe(colorizeDiffLine('+added'))
    expect(colorizeDiffLine(' context')).toBe(' context')
  })

  it('keeps the diff column usable next to a very long file name', () => {
    const labels = files.map(entry => changesEntryLabel({ entry, tab: 0 }))
    const { leftW, rightW } = paneWidthsForLabels({ contentW: 76, labels }) as { leftW: number; rightW: number }
    expect(leftW + rightW + 2).toBe(76)
    expect(rightW).toBeGreaterThanOrEqual(leftW)
  })
})

type ChangesDialog = {
  lines: string[]
  leftW: number
  rightW: number
  first: number
  entryH: number
  diffTotal: number
  scroll: number
  activePane: 'entries' | 'diff'
  total: number
}

describe('changes overlay', () => {
  const files = [
    { code: 'M', path: 'src/lib/app.ts' },
    { code: '??', path: 'notes.md' },
  ]
  const branchFiles = [
    { code: 'M', path: 'src/hooks.server.ts' },
    { code: 'A', path: 'test/auto-scan.test.ts' },
  ]
  const diffLines = ['--- a/src/lib/app.ts', '+++ b/src/lib/app.ts', '+added']

  it('labels entries as code path on every tab', () => {
    expect(changesEntryLabel({ entry: files[0] })).toBe('M src/lib/app.ts')
    expect(changesEntryLabel({ entry: branchFiles[1] })).toBe('A test/auto-scan.test.ts')
    expect(changesEntryLabel({})).toBe('')
  })

  it('renders three tabs with counts, unknown as ?', () => {
    const line = String(changesTabLine({ tab: 1, counts: [2, 1, null] }))
    expect(CHANGES_TABS).toEqual(['Uncommitted', 'Ahead', 'Behind'])
    expect(line.replace(ansi, '')).toBe('Uncommitted (2)  Ahead (1)  Behind (?)')
    const cols = changesTabHitColumns({ counts: [2, 1, null] }) as Array<{ tab: number; start: number; end: number }>
    expect(cols).toHaveLength(3)
    expect(cols[1]).toEqual({ tab: 1, start: 'Uncommitted (2)  '.length, end: 'Uncommitted (2)  Ahead (1)'.length - 1 })
    // Adjacent columns never overlap, so a click maps to exactly one tab.
    expect(cols[0].end).toBeLessThan(cols[1].start)
    expect(cols[1].end).toBeLessThan(cols[2].start)
  })

  it('is listH + 5 lines tall with every row at the dialog width', () => {
    for (const dialogW of [64, 80, 96]) {
      const dialog = buildChangesDialog({
        context: 'wt (branch) vs master',
        tab: 0,
        counts: [2, 1, 0],
        entries: files,
        cursor: 0,
        diffLines,
        scroll: 0,
        dialogW,
        listH: 10,
      }) as ChangesDialog
      expect(dialog.lines).toHaveLength(15)
      for (const line of dialog.lines) expect(line.replace(ansi, '').length).toBe(dialogW)
      expect(dialog.total).toBe(2)
    }
  })

  it('places the tab line and pane header at the hit-test rows', () => {
    const dialog = buildChangesDialog({
      context: 'wt',
      tab: 0,
      counts: [2, 0, 0],
      entries: files,
      cursor: 0,
      diffLines,
      scroll: 0,
      dialogW: 80,
      listH: 8,
    }) as ChangesDialog
    expect(dialog.lines[CHANGES_TAB_ROW].replace(ansi, '')).toContain('Uncommitted (2)')
    expect(dialog.lines[CHANGES_BODY_START].replace(ansi, '')).toContain('FILES (2)')
    expect(dialog.lines[CHANGES_BODY_START].replace(ansi, '')).toContain('DIFF ·')
  })

  it('lists branch files on the ahead/behind tabs like uncommitted files', () => {
    for (const tab of [1, 2]) {
      const dialog = buildChangesDialog({
        context: 'wt',
        tab,
        counts: [0, 2, 0],
        entries: branchFiles,
        cursor: 1,
        diffLines,
        scroll: 0,
        dialogW: 80,
        listH: 8,
      }) as ChangesDialog
      expect(dialog.lines[CHANGES_BODY_START].replace(ansi, '')).toContain('FILES (2)')
      expect(dialog.lines[CHANGES_BODY_START].replace(ansi, '')).toContain('A test/auto-scan.test.ts')
      expect(dialog.lines.join('\n').replace(ansi, '')).toContain('M src/hooks.server.ts')
    }
  })

  it('leaves an empty corpus blank instead of explaining it', () => {
    const dialog = buildChangesDialog({
      context: 'wt',
      tab: 2,
      counts: [0, 0, 0],
      entries: [],
      cursor: 0,
      diffLines: [],
      scroll: 0,
      dialogW: 80,
      listH: 6,
    }) as ChangesDialog
    const visible = dialog.lines.join('\n').replace(ansi, '')
    expect(visible).not.toContain('No changed files')
    expect(visible).not.toContain('Working tree clean')
    const unreadable = buildChangesDialog({
      context: 'wt',
      tab: 0,
      counts: [null, 0, 0],
      entries: null,
      cursor: 0,
      diffLines: null,
      scroll: 0,
      dialogW: 80,
      listH: 6,
    }) as ChangesDialog
    expect(unreadable.lines.join('\n').replace(ansi, '')).toContain('Status unreadable')
  })

  it('marks the focused pane in the header row', () => {
    const base = { context: 'wt', tab: 0, counts: [2, 0, 0], entries: files, cursor: 0, diffLines, scroll: 0, dialogW: 100, listH: 6 }
    const left = buildChangesDialog({ ...base, activePane: 'entries' }) as ChangesDialog
    expect(left.lines[CHANGES_BODY_START].replace(ansi, '').startsWith('│ ▸ FILES')).toBe(true)
    const right = buildChangesDialog({ ...base, activePane: 'diff' }) as ChangesDialog
    expect(right.lines[CHANGES_BODY_START].replace(ansi, '')).toContain('▸ DIFF ·')
    expect(right.lines.slice(CHANGES_BODY_START + 1)).toEqual(left.lines.slice(CHANGES_BODY_START + 1))
  })

  it('opens at the top of the diff and clamps scrolling to the end', () => {
    const top = buildChangesDialog({
      context: 'wt',
      tab: 0,
      counts: [2, 0, 0],
      entries: files,
      cursor: 0,
      diffLines,
      scroll: 0,
      dialogW: 80,
      listH: 4,
    }) as ChangesDialog
    expect(top.scroll).toBe(0)
    const clamped = buildChangesDialog({
      context: 'wt',
      tab: 0,
      counts: [2, 0, 0],
      entries: files,
      cursor: 0,
      diffLines,
      scroll: 999,
      dialogW: 80,
      listH: 4,
    }) as ChangesDialog
    expect(clamped.scroll).toBe(Math.max(0, clamped.diffTotal - clamped.entryH))
  })

  it('reports the focused file and its diff size on the detail line', () => {
    const detail = String(buildChangesDetail({ tab: 1, entries: branchFiles, cursor: 0, lineCount: 8, truncated: false }))
    expect(detail.replace(ansi, '')).toContain('M src/hooks.server.ts')
    expect(detail.replace(ansi, '')).toContain('8 diff lines')
    expect(String(buildChangesDetail({ tab: 0, entries: [], cursor: 0 }))).toBe('')
  })

  it('sizes the fullscreen dialog to exactly the terminal', () => {
    for (const [rows, cols] of [[24, 80], [20, 60], [30, 100], [40, 120]] as Array<[number, number]>) {
      const { dialogW, listH } = changesFullscreenGeometry({ cols, rows }) as { dialogW: number; listH: number }
      expect(dialogW).toBe(Math.max(60, cols))
      const dialog = buildChangesDialog({
        context: 'wt',
        tab: 0,
        counts: [2, 0, 0],
        entries: files,
        cursor: 0,
        diffLines,
        scroll: 0,
        dialogW,
        listH,
        footer: 'keys',
      }) as ChangesDialog
      expect(dialog.lines).toHaveLength(rows)
      for (const line of dialog.lines) expect(line.replace(ansi, '').length).toBe(cols)
    }
  })

  it('renders the footer row behind a separator above the bottom border', () => {
    const dialog = buildChangesDialog({
      context: 'wt',
      tab: 0,
      counts: [2, 0, 0],
      entries: files,
      cursor: 0,
      diffLines,
      scroll: 0,
      dialogW: 80,
      listH: 8,
      footer: 'Esc or q closes',
    }) as ChangesDialog
    expect(dialog.lines).toHaveLength(8 + 7)
    const stripped = dialog.lines.map(line => line.replace(ansi, ''))
    expect(stripped[stripped.length - 3]).toContain('─'.repeat(8))
    expect(stripped[stripped.length - 2]).toContain('Esc or q closes')
    const plain = buildChangesDialog({
      context: 'wt',
      tab: 0,
      counts: [2, 0, 0],
      entries: files,
      cursor: 0,
      diffLines,
      scroll: 0,
      dialogW: 80,
      listH: 8,
    }) as ChangesDialog
    expect(plain.lines).toHaveLength(8 + 5)
  })
})
