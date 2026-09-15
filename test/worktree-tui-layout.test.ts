import { describe, expect, it } from 'vitest'

import {
  HELP_MAX_LINES,
  buildCreateDialog,
  buildDiffDetail,
  buildPromptDialog,
  buildWorktreesDirDialog,
  colorizeDiffLine,
  currentOptions,
  dialogGeometry,
  dialogTop,
  diffPaneWidths,
  fitHelpLines,
  frameHeight,
  frameSplit,
  layout,
  listWindow,
  renderDiffView,
} from '../scripts/_worktree-tui/layout.mjs'

type LayoutResult = { rows: number; cols: number; boxH: number; helpLines: string[]; boxW: number }
type SplitResult = { listH: number; cmdH: number }
type DiffView = {
  lines: string[]
  leftW: number
  rightW: number
  first: number
  bodyH: number
  diffTotal: number
  scroll: number
  activePane: 'files' | 'diff'
}
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

  it('offers the uncommitted-changes viewer and keeps settings off the menu', () => {
    expect(options).toContain('Show uncommitted changes…')
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

describe('uncommitted-changes viewer', () => {
  const files = [
    { code: 'M', path: 'src/lib/app.ts' },
    { code: 'M', path: 'scripts/very/long/path/to/a/file/name/that/should/not/eat/the/diff.ts' },
    { code: '??', path: 'notes.md' },
  ]
  const diffLines = [
    'diff --git a/src/lib/app.ts b/src/lib/app.ts',
    'index 111..222 100644',
    '--- a/src/lib/app.ts',
    '+++ b/src/lib/app.ts',
    '@@ -1,4 +1,5 @@',
    ' context',
    '-removed',
    '+added',
  ]

  it('colors additions, removals, hunks, and the preamble distinctly', () => {
    expect(colorizeDiffLine('+added')).toContain('added')
    expect(colorizeDiffLine('+added')).not.toBe(colorizeDiffLine('-removed'))
    expect(colorizeDiffLine('@@ -1 +1 @@')).not.toBe(colorizeDiffLine('+added'))
    expect(colorizeDiffLine(' context')).toBe(' context')
  })

  it('keeps the diff column usable next to a very long file name', () => {
    const { leftW, rightW } = diffPaneWidths({ boxW: 80, files }) as { leftW: number; rightW: number }
    expect(leftW + rightW + 2).toBe(76) // boxW - 4 chrome
    expect(rightW).toBeGreaterThanOrEqual(leftW)
  })

  it('renders boxH rows of exactly the box interior width', () => {
    for (const boxW of [60, 80, 120]) {
      const view = renderDiffView({
        files,
        cursor: 0,
        diffLines,
        scroll: 0,
        boxW,
        boxH: 10,
      }) as DiffView
      const contentW = boxW - 4
      expect(view.lines).toHaveLength(10)
      for (const line of view.lines) {
        // Strip ANSI and box-drawing separators to measure visible columns.
        expect(line.replace(ansi, '').length).toBeLessThanOrEqual(contentW + 2)
      }
      expect(view.lines[0].replace(ansi, '')).toContain('FILES (3)')
      expect(view.lines[0].replace(ansi, '')).toContain('DIFF ·')
    }
  })

  it('selects a file row and shows its path in the header', () => {
    // Row 0 is the pane header, so the file rows start at index 1.
    const view = renderDiffView({ files, cursor: 2, diffLines, scroll: 0, boxW: 80, boxH: 6 }) as DiffView
    expect(view.lines[0].replace(ansi, '')).toContain('notes.md')
    expect(view.lines[3].replace(ansi, '')).toContain('notes.md')
  })

  it('explains an entry with no text diff instead of rendering nothing', () => {
    const view = renderDiffView({ files, cursor: 0, diffLines: null, scroll: 0, boxW: 80, boxH: 6 }) as DiffView
    expect(view.lines[1].replace(ansi, '')).toContain('No text diff')
  })

  it('opens at the top of the diff and clamps scrolling to the end', () => {
    const top = renderDiffView({ files, cursor: 0, diffLines, scroll: 0, boxW: 80, boxH: 4 }) as DiffView
    expect(top.scroll).toBe(0)
    expect(top.lines[1].replace(ansi, '')).toContain('diff --git')
    const clamped = renderDiffView({ files, cursor: 0, diffLines, scroll: 999, boxW: 80, boxH: 4 }) as DiffView
    expect(clamped.scroll).toBe(Math.max(0, clamped.diffTotal - clamped.bodyH))
    // The last visible row holds the last diff line once scrolled to the end.
    const visible = clamped.lines.join('\n').replace(ansi, '')
    expect(visible).toContain('+added')
  })

  it('marks the focused pane in the header row', () => {
    const filesPane = renderDiffView({
      files,
      cursor: 0,
      diffLines,
      boxW: 100,
      boxH: 6,
      activePane: 'files',
    }) as DiffView
    expect(filesPane.activePane).toBe('files')
    expect(filesPane.lines[0].replace(ansi, '').startsWith('▸ FILES')).toBe(true)
    expect(filesPane.lines[0].replace(ansi, '')).toContain('  DIFF ·')

    const diffPane = renderDiffView({
      files,
      cursor: 0,
      diffLines,
      boxW: 100,
      boxH: 6,
      activePane: 'diff',
    }) as DiffView
    expect(diffPane.activePane).toBe('diff')
    expect(diffPane.lines[0].replace(ansi, '').startsWith('  FILES')).toBe(true)
    expect(diffPane.lines[0].replace(ansi, '')).toContain('▸ DIFF ·')
    // Focus never changes what the panes show, only how the header reads.
    expect(diffPane.lines.slice(1)).toEqual(filesPane.lines.slice(1))
  })

  it('reports the focused file and its diff size on the detail line', () => {
    const detail = String(buildDiffDetail({ files, cursor: 0, lineCount: 8, truncated: false }))
    expect(detail.replace(ansi, '')).toContain('M src/lib/app.ts')
    expect(detail.replace(ansi, '')).toContain('8 diff lines')
    const none = String(buildDiffDetail({ files, cursor: 0, lineCount: null }))
    expect(none.replace(ansi, '')).toContain('no text diff')
    expect(String(buildDiffDetail({ files: [], cursor: 0 }))).toBe('')
  })
})
