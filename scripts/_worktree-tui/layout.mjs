// Pure layout, geometry, and menu model for scripts/worktree-manager.mjs.
//
// Everything here is a function of its arguments: no terminal I/O, no shared
// mutable state, so it is unit-testable (test/worktree-tui-layout.test.ts) and
// the full-screen TUI keeps only the stateful wiring. Terminal size and the
// live `state` reach these functions through the adapters in
// worktree-manager.mjs.
//
// The row constants are shared by the renderers and the mouse hit-test so the
// two cannot drift apart.
import { buildDialogBox, c, charWidth, displayWidth, padRight, takeRight, truncate, wrapText } from '../_tui.mjs'

export const PRESET_COMMANDS = [
  { label: 'npm install', value: 'npm install' },
  { label: 'npm run dev', value: 'npm run dev' },
  { label: 'npm run check', value: 'npm run check' },
  { label: 'npm test', value: 'npm test' },
  { label: 'git status', value: 'git status' },
  { label: 'git log --oneline -15', value: 'git log --oneline -15' },
  { label: 'git branch --show-current', value: 'git branch --show-current' },
]

export const MODES = ['Actions', 'Command']

// Control hints, compact enough to stay within HELP_MAX_LINES on a normal
// terminal (narrow terminals trim the tail via `fitHelpLines`). The full
// command surface lives in the menu, so the footer only names what is not
// discoverable there.
export const HELP_TEXT =
  '↑↓ move · Space select · u changes · w dir · Tab menu · c cmd · s shell · Del delete · ' +
  'n new · d deprecated · x stop bg · r refresh · PgUp scroll · q quit'
export const HELP_MAX_LINES = 2

// Wrap the control hints into at most `maxLines` rows, marking a trimmed tail
// with an ellipsis so a narrow terminal shows that hints were dropped instead
// of silently hiding controls. Every returned line fits `cols`.
export function fitHelpLines(text, cols, maxLines = HELP_MAX_LINES) {
  const all = wrapText(text, cols)
  if (all.length <= maxLines) return all
  const kept = all.slice(0, maxLines)
  // Reserve the two columns the marker needs, so a line that already filled
  // the width still shows that hints were dropped.
  kept[maxLines - 1] = `${truncate(kept[maxLines - 1], Math.max(0, cols - 2))} …`
  return kept
}

export const DIALOG_OPTION_START = 3 // border, tabs line, separator precede options
export const CONFIRM_NO_ROW = 4 // border, message, detail, separator precede "No"
export const CONFIRM_YES_ROW = 5
export const LIST_TOP_ROW = 3 // header, subheader, box top border precede rows

// List-row chrome columns (1-based): `│`(1) + space(2), then content starting
// with the `▸`/space marker(3) + space(4) + the `[ ]`/`[x]` checkbox(5-7).
// The marker is single-cell in practice (▸ is outside WIDE_CHAR_RE in
// _tui.mjs), so the checkbox columns are stable.
export const CHECKBOX_FIRST_COL = 5
export const CHECKBOX_LAST_COL = 7

// Rows the frame spends outside the worktrees box: header + subheader above
// it, the focused-row detail line, and status below it. The box adds its own
// two borders, and `frameSplit()` reserves the pane's list/output divider
// inside `boxH`, so one constant covers both pane states. `layout()` derives
// the box budget from it and `frameHeight()` re-adds it, so the budget and the
// drawn frame cannot drift apart (an overflowing frame is clipped from the
// tail, which silently eats the help block).
const CHROME_ROWS = 6

export function layout({ termRows, termCols }) {
  const rows = Math.max(20, termRows || 24)
  const cols = Math.max(60, termCols || 80)
  const helpLines = fitHelpLines(HELP_TEXT, cols)
  const boxH = Math.max(3, rows - CHROME_ROWS - helpLines.length)
  const boxW = cols // the frame always uses the entire console width
  return { rows, cols, boxH, helpLines, boxW }
}

// Total lines the frame occupies, box contents included. Callers and tests use
// it to prove the frame fits the terminal height.
/**
 * @param {{ boxH: number, helpLines?: string[] }} frame
 * @returns {number}
 */
export function frameHeight({ boxH, helpLines = [] }) {
  return boxH + CHROME_ROWS + helpLines.length
}

// When a command pane is open the frame splits: list on top, divider, then the
// command output pane. Returns the row budget for each part.
export function frameSplit({ boxH, paneOpen }) {
  if (!paneOpen) return { listH: boxH, cmdH: 0 }
  const cmdH = Math.max(5, Math.min(Math.floor(boxH / 3), boxH - 9))
  return { listH: boxH - cmdH - 1, cmdH }
}

export function listWindow({ count, cursor, listH }) {
  if (count === 0) return { first: 0, last: -1, boxH: 0 }
  let first = Math.max(0, cursor - Math.floor(listH / 2))
  first = Math.min(first, Math.max(0, count - listH))
  const last = Math.min(count - 1, first + listH - 1)
  return { first, last, boxH: listH }
}

// A worktree is only a delete candidate when its HEAD is already in the base
// branch *and* its working tree is clean: the delete path is
// `git worktree remove --force`, so a checkout holding uncommitted work must
// never read as deprecated. `dirty === null` means git could not report the
// status, which counts as unsafe rather than clean. Pure predicate, so the
// badge and the deprecated scan cannot drift apart.
export function isDeprecated(row) {
  return row.merged === true && row.dirty === 0
}

// Tags rendered after the branch. `[merged]` is the deprecation badge; a dirty
// or unreadable status is called out instead of silently dropping the badge.
// The main row reports its dirty state too so uncommitted work in the
// default checkout is never invisible.
function rowTags(row) {
  const tags = []
  if (row.dirty > 0) tags.push(`${c.yellow}[uncommitted:${row.dirty}]${c.reset}`)
  else if (row.dirty === null) tags.push(`${c.yellow}[status unknown]${c.reset}`)
  if (isDeprecated(row)) tags.push(`${c.yellow}[merged]${c.reset}`)
  return tags.length ? ` ${tags.join(' ')}` : ''
}

// One-line summary of the focused row's uncommitted files for the detail line
// under the list box (raw `git status --porcelain` entries, e.g.
// `M src/foo.ts`, `?? new.ts`). Always returns one line so the frame keeps
// a stable height while the cursor moves between clean and dirty rows.
// Pure: the caller truncates to its own width.
export function buildDirtyDetail({ row } = {}) {
  if (!row) return ''
  const label = row.main ? '(main)' : row.name
  if (row.dirty === null || row.dirtyFiles == null) {
    return `${c.yellow}Uncommitted in ${label}: status unreadable${c.reset}`
  }
  if (row.dirty === 0) return `${c.dim}Working tree clean in ${label}${c.reset}`
  const files = row.dirtyFiles ?? []
  const shown = files.map(f => diffFileLabel(f)).join(', ')
  const extra = row.dirty - files.length
  const more = extra > 0 ? ` +${extra} more` : ''
  return `${c.yellow}Uncommitted in ${label} (${row.dirty}):${c.reset} ${shown}${c.dim}${more}${c.reset}`
}

// ---- uncommitted-changes viewer ----

// Narrowest column a two-pane viewer allows the entries list; the diff keeps
// the larger share of the width.
const DIFF_LEFT_MIN = 20

// `code path` label of a dirty file, as the viewer and the detail line show it.
export function diffFileLabel(file) {
  return file ? `${file.code} ${file.path}` : ''
}

// Additions, removals, and hunk headers carry the diff's meaning, so they keep
// their conventional colors; the diff/index preamble stays dim.
export function colorizeDiffLine(line) {
  if (line.startsWith('@@')) return `${c.cyan}${line}${c.reset}`
  if (line.startsWith('+++') || line.startsWith('---')) return `${c.dim}${line}${c.reset}`
  if (line.startsWith('diff ') || line.startsWith('index ')) return `${c.dim}${line}${c.reset}`
  if (line.startsWith('+')) return `${c.green}${line}${c.reset}`
  if (line.startsWith('-')) return `${c.red}${line}${c.reset}`
  return line
}

// One shared width policy for every two-pane viewer: the narrowest left
// column that fits the corpus (capped at 40% of the width), one separator
// column, one space, then the diff. Labels arrive pre-styled-free so every
// caller measures plain text.
/**
 * @param {{ contentW: number, labels?: string[] }} pane
 * @returns {{ leftW: number, rightW: number }}
 */
export function paneWidthsForLabels({ contentW, labels = [] }) {
  const wanted = labels.reduce((n, label) => Math.max(n, displayWidth(label) + 2), 0)
  const cap = Math.max(DIFF_LEFT_MIN, Math.floor(contentW * 0.4))
  const leftW = Math.max(DIFF_LEFT_MIN, Math.min(wanted, cap, contentW - DIFF_LEFT_MIN - 2))
  return { leftW, rightW: Math.max(1, contentW - leftW - 2) }
}

// ---- changes overlay (`u`: uncommitted + ahead + behind in one dialog) ----

// Tab order inside the changes overlay. Counts render beside each label; a
// null corpus (unreadable status, unresolvable side) renders as `?`.
export const CHANGES_TABS = ['Uncommitted', 'Ahead', 'Behind']

// Dialog-line rows (0-based) of the tab line and the first two-pane body row:
// title(0), context(1), tabs(2), separator(3), pane header(4), entries(5+).
export const CHANGES_TAB_ROW = 2
export const CHANGES_BODY_START = 4

// Display label of one overlay entry: `code path` on every tab, since all
// three corpora are file lists (dirty files, branch-vs-base files,
// base-vs-branch files).
/**
 * @param {{ entry?: { code?: string, path?: string }, tab?: number }} label
 * @returns {string}
 */
export function changesEntryLabel({ entry } = {}) {
  return diffFileLabel(entry)
}

// Tab line of the changes overlay, with the active tab highlighted. Counts
// follow each label; null corpora show `?` instead of a number.
/**
 * @param {{ tab?: number, counts?: Array<number|null> }} view
 * @returns {string}
 */
export function changesTabLine({ tab = 0, counts = [] } = {}) {
  const parts = CHANGES_TABS.map((label, i) => {
    const count = counts[i]
    const text = `${label} (${count == null ? '?' : count})`
    return i === tab ? `${c.cyan}${c.bold}${c.reverse}${text}${c.reset}` : `${c.gray}${text}${c.reset}`
  })
  return parts.join('  ')
}

// Column ranges of the tab labels inside the dialog's content area (relative
// to the content start, after the frame's `│ `). The renderer and the mouse
// hit test both derive from this, so a click always lands on the label it
// appears to cover.
/**
 * @param {{ counts?: Array<number|null> }} view
 * @returns {Array<{ tab: number, start: number, end: number }>}
 */
export function changesTabHitColumns({ counts = [] } = {}) {
  const columns = []
  let start = 0
  CHANGES_TABS.forEach((label, i) => {
    const count = counts[i]
    const text = `${label} (${count == null ? '?' : count})`
    columns.push({ tab: i, start, end: start + text.length - 1 })
    start += text.length + 2
  })
  return columns
}

// Empty-state note per tab: only unreadable corpora report why (an empty tab
// stays blank — there is nothing to explain when the other tabs hold the
// worktree's changes).
/**
 * @param {{ tab?: number, entries?: Array<{ code?: string, path?: string }>|null }} view
 * @returns {string}
 */
function changesEmptyNote({ tab = 0, entries }) {
  if (entries === null) {
    return tab === 0 ? 'Status unreadable (press r to retry).' : 'Branch range unresolvable.'
  }
  return ''
}

// Fullscreen geometry for the changes dialog: it stacks over the whole
// terminal instead of floating centered like the menu. Title + context + tabs
// + separator + footer separator + footer + bottom border take seven rows;
// the rest is the body (one pane-header row plus the entry rows).
export function changesFullscreenGeometry({ cols, rows }) {
  const dialogW = Math.max(60, cols || 80)
  const listH = Math.max(3, (rows || 24) - 7)
  return { dialogW, listH }
}

// ---- side-by-side diff pairs (`v` in the changes dialog) ----

// Minimum right-pane width worth splitting: below this each subpane would be
// too narrow to read, so the dialog falls back to the unified view.
export const SIDE_BY_SIDE_MIN_RIGHT_W = 24

// One before/after row pair of a unified diff. Kinds drive the cell colors:
// `del`/`add` for changed lines, `context` for shared lines, `meta` for
// headers (`diff`, `index`, `---`/`+++`, `@@`), `blank` for the empty half of
// an unpaired change.
function isDelLine(line) {
  return line.startsWith('-') && !line.startsWith('--- ')
}

function isAddLine(line) {
  return line.startsWith('+') && !line.startsWith('+++ ')
}

// Pair unified diff lines into before/after rows: context lines render on
// both sides, del/add runs zip pairwise (unpaired halves stay blank), the
// `---`/`+++` pair splits across the sides, and every other header lands on
// the before side. Pure, so the pairing is unit-testable on its own.
/**
 * @param {string[]} diffLines
 * @returns {Array<{ before: string, after: string, beforeKind: string, afterKind: string }>}
 */
export function pairDiffLines(diffLines = []) {
  const rows = []
  let i = 0
  while (i < diffLines.length) {
    const line = diffLines[i]
    if (line.startsWith('--- ') && i + 1 < diffLines.length && diffLines[i + 1].startsWith('+++ ')) {
      rows.push({ before: line, after: diffLines[i + 1], beforeKind: 'meta', afterKind: 'meta' })
      i += 2
    } else if (
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('@@') ||
      line.startsWith('Binary ')
    ) {
      rows.push({ before: line, after: '', beforeKind: 'meta', afterKind: 'blank' })
      i += 1
    } else if (isDelLine(line) || isAddLine(line)) {
      const dels = []
      while (i < diffLines.length && isDelLine(diffLines[i])) {
        dels.push(diffLines[i].slice(1))
        i += 1
      }
      const adds = []
      while (i < diffLines.length && isAddLine(diffLines[i])) {
        adds.push(diffLines[i].slice(1))
        i += 1
      }
      const n = Math.max(dels.length, adds.length)
      for (let k = 0; k < n; k++) {
        rows.push({
          before: dels[k] ?? '',
          after: adds[k] ?? '',
          beforeKind: k < dels.length ? 'del' : 'blank',
          afterKind: k < adds.length ? 'add' : 'blank',
        })
      }
    } else {
      const text = line.startsWith(' ') ? line.slice(1) : line
      rows.push({ before: text, after: text, beforeKind: 'context', afterKind: 'context' })
      i += 1
    }
  }
  return rows
}

function colorizeSideCell(text, kind) {
  if (kind === 'del') return `${c.red}${text}${c.reset}`
  if (kind === 'add') return `${c.green}${text}${c.reset}`
  if (kind === 'meta') return colorizeDiffLine(text)
  return text
}

// Subpane widths inside a `rightW`-wide side-by-side diff pane: the before
// cell, one separator column, one space, then the after cell. Shared by the
// row renderer and the branch-label row so the labels sit over their subpane.
export function sidePaneWidths({ rightW }) {
  const beforeW = Math.max(1, Math.floor((rightW - 3) / 2))
  const afterW = Math.max(1, rightW - 3 - beforeW)
  return { beforeW, afterW }
}

// Center plain text in `width` columns (branch names over their subpane).
// Truncates first so an overlong name cannot push the row wide.
function centerText(text, width) {
  const label = truncate(String(text ?? ''), Math.max(0, width))
  const pad = Math.max(0, width - displayWidth(label))
  const left = Math.floor(pad / 2)
  return ' '.repeat(left) + label + ' '.repeat(pad - left)
}

// Wrap one raw unified diff line, repainting the line's color on every visual
// row: colorizing before wrapping would leave the SGR opener in the first row
// and the continuation rows uncolored (same fix as the side-by-side cells).
// Single-row lines keep the exact `colorizeDiffLine` rendering.
function wrapUnifiedLine(line, width) {
  const rows = wrapPaneLine(line, width)
  if (rows.length <= 1) {
    return [colorizeDiffLine(line)]
  }
  let paint = ''
  if (line.startsWith('@@')) {
    paint = c.cyan
  } else if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
    paint = c.dim
  } else if (isAddLine(line)) {
    paint = c.green
  } else if (isDelLine(line)) {
    paint = c.red
  }
  if (!paint) {
    return rows
  }
  return rows.map(row => `${paint}${row}${c.reset}`)
}

// One pair as aligned visual rows inside a `rightW`-wide diff pane: each cell
// wraps to its subpane and the pair emits as many rows as the taller side, so
// before/after lines never drift apart. Every returned row is exactly
// `rightW` visible columns wide.
/**
 * @param {{ pairs?: Array<{ before: string, after: string, beforeKind: string, afterKind: string }>, rightW: number }} pane
 * @returns {{ rows: string[], beforeW: number, afterW: number }}
 */
export function renderSideBySideRows({ pairs = [], rightW }) {
  const { beforeW, afterW } = sidePaneWidths({ rightW })
  const separator = `${c.cyan}│${c.reset}`
  const rows = []
  for (const pair of pairs) {
    // Wrap the raw text first, then colorize every visual row: colorizing
    // before wrapping would leave the SGR opener in the first row and the
    // continuation rows uncolored (`wrapPaneLine` carries escapes forward but
    // never re-emits the active style).
    const before = wrapPaneLine(pair.before, beforeW).map(line => colorizeSideCell(line, pair.beforeKind))
    const after = wrapPaneLine(pair.after, afterW).map(line => colorizeSideCell(line, pair.afterKind))
    const n = Math.max(before.length, after.length)
    for (let k = 0; k < n; k++) {
      rows.push(
        `${padRight(before[k] ?? '', beforeW)}${separator} ${padRight(after[k] ?? '', afterW)}`,
      )
    }
  }
  return { rows, beforeW, afterW }
}

// The changes dialog: the same cyan frame as every other overlay, a context
// line (worktree + branch + base), the tab line, then a two-pane body with
// the entries on the left and the focused entry's diff on the right. `entries` is the active tab's file corpus or null
// when it could not be read; `diffLines` is the focused entry's raw diff or
// null. `listH` counts the body rows including the pane header, so the dialog
// is `listH + 5` lines tall (title + context + tabs + separator + bottom),
// plus a separator and a footer row when `footer` is non-empty. `viewMode`
// selects the right pane's rendering: `unified` (one diff column) or `side`
// (before/after subpanes); narrow panes and changeless diffs fall back to
// unified, rendering byte-identically to it.
/**
 * @param {{ context?: string, tab?: number, counts?: Array<number|null>, entries?: Array<{ code?: string, path?: string }>|null, cursor?: number, diffLines?: string[]|null, scroll?: number, dialogW: number, listH: number, activePane?: 'entries'|'diff', footer?: string, viewMode?: 'unified'|'side', beforeLabel?: string, afterLabel?: string }} view
 * @returns {{ lines: string[], leftW: number, rightW: number, first: number, entryH: number, entryStart: number, diffTotal: number, scroll: number, activePane: 'entries'|'diff', total: number }}
 */
export function buildChangesDialog({
  context = '',
  tab = 0,
  counts = [],
  entries = [],
  cursor = 0,
  diffLines = null,
  scroll = 0,
  dialogW,
  listH,
  activePane = 'entries',
  footer = '',
  viewMode = 'unified',
  beforeLabel = '',
  afterLabel = '',
}) {
  const inner = dialogW - 2
  const contentW = inner - 2
  const border = s => `${c.cyan}${s}${c.reset}`
  const side = t => `${c.cyan}│${c.reset} ${t}${c.cyan} │${c.reset}`
  const labels = Array.isArray(entries) ? entries.map(entry => changesEntryLabel({ entry })) : []
  const { leftW, rightW } = paneWidthsForLabels({ contentW, labels })
  const separator = `${c.cyan}│${c.reset}`
  const active = activePane === 'diff' ? 'diff' : 'entries'

  const lines = [border(`┌ CHANGES ${'─'.repeat(Math.max(1, inner - 'CHANGES'.length - 2))}┐`)]
  lines.push(side(padRight(truncate(context, contentW), contentW)))
  lines.push(side(padRight(truncate(changesTabLine({ tab, counts }), contentW), contentW)))
  lines.push(side('─'.repeat(contentW)))

  const body = []
  const paneName = 'FILES'
  const header = (text, pane) =>
    pane === active ? `▸ ${c.bold}${c.cyan}${text}${c.reset}` : `  ${c.dim}${text}${c.reset}`
  const focusedLabel = Array.isArray(entries) && entries[cursor] ? labels[cursor] : 'none'
  // A changeless diff (headers only, or empty) renders exactly like unified —
  // there is nothing to split, so no border or subpane labels either.
  const pairs = viewMode === 'side' && diffLines !== null ? pairDiffLines(diffLines) : null
  const hasChanges = pairs !== null && pairs.some(p => p.beforeKind === 'del' || p.afterKind === 'add')
  const sideActive = pairs !== null && hasChanges && rightW >= SIDE_BY_SIDE_MIN_RIGHT_W
  const diffTitle = sideActive ? `DIFF · ${focusedLabel} (side-by-side)` : `DIFF · ${focusedLabel}`
  body.push(
    `${padRight(truncate(header(`${paneName} (${labels.length})`, 'entries'), leftW), leftW)}${separator} ` +
      padRight(truncate(header(diffTitle, 'diff'), rightW), rightW),
  )
  // Side-by-side inserts two fixed rows under the pane header — a full-width
  // border, then the centered branch names over their subpane — and the pairs
  // area shrinks by the same two rows, so the dialog keeps its exact height.
  // `entryStart` tells hit-testing how many rows past the pane header the
  // entry rows begin (1 unified, 3 side-by-side).
  const entryStart = sideActive ? 3 : 1
  if (sideActive) {
    const { beforeW, afterW } = sidePaneWidths({ rightW })
    body.push('─'.repeat(contentW))
    const labelCells = `${centerText(beforeLabel, beforeW)}${separator} ${centerText(afterLabel, afterW)}`
    body.push(`${padRight('', leftW)}${separator} ${padRight(labelCells, rightW)}`)
  }
  const entryH = Math.max(1, listH - 1)
  const pairsH = Math.max(1, entryH - (entryStart - 1))
  const wrapped = []
  if (diffLines === null) {
    wrapped.push(`${c.yellow}No text diff for this entry.${c.reset}`)
  } else if (sideActive) {
    wrapped.push(...renderSideBySideRows({ pairs, rightW }).rows)
  } else {
    for (const line of diffLines) wrapped.push(...wrapUnifiedLine(line, rightW))
  }
  const total = wrapped.length
  const maxScroll = Math.max(0, total - pairsH)
  const safeScroll = Math.max(0, Math.min(scroll, maxScroll))
  const window = listWindow({ count: labels.length, cursor, listH: Math.max(1, pairsH) })

  if (!Array.isArray(entries) || entries.length === 0) {
    const note = changesEmptyNote({ tab, entries })
    if (note) {
      // The note spans the whole dialog: there is no corpus to size the
      // entries pane from, so clipping it to the minimum column would cut
      // the explanation off mid-sentence.
      const tone = entries === null ? c.yellow : c.dim
      body.push(padRight(truncate(`${tone}${note}${c.reset}`, contentW), contentW))
    }
    for (let i = body.length - entryStart; i < pairsH; i++) {
      body.push(`${padRight('', leftW)}${separator} ${padRight('', rightW)}`)
    }
  } else {
    for (let i = 0; i < pairsH; i++) {
      const entryIndex = window.first + i
      const entry = entries[entryIndex]
      let left = ''
      if (entry) {
        const selected = entryIndex === cursor
        const marker = selected ? `${c.cyan}▸${c.reset}` : ' '
        const raw = `${marker} ${c.gray}${entry.code}${c.reset} ${entry.path}`
        left = selected ? truncate(raw, leftW) : truncate(`${c.dim}${raw}${c.reset}`, leftW)
      }
      const diffIndex = safeScroll + i
      const right = diffIndex < total ? wrapped[diffIndex] : ''
      body.push(`${padRight(left, leftW)}${separator} ${padRight(truncate(right, rightW), rightW)}`)
    }
  }

  while (body.length < listH) body.push(`${padRight('', leftW)}${separator} ${padRight('', rightW)}`)
  if (body.length > listH) body.length = listH
  for (const row of body) lines.push(side(row))
  // Fullscreen mode covers the frame's own status line, so the dialog carries
  // its key hints as a footer row behind a separator, like the tab line.
  if (footer) {
    lines.push(side('─'.repeat(contentW)))
    lines.push(side(padRight(truncate(footer, contentW), contentW)))
  }
  lines.push(border(`└${'─'.repeat(inner)}┘`))
  return {
    lines,
    leftW,
    rightW,
    first: window.first,
    entryH: pairsH,
    entryStart,
    diffTotal: total,
    scroll: safeScroll,
    activePane: active,
    total: Array.isArray(entries) ? entries.length : 0,
  }
}

// Focused-entry summary for the detail line under the box while the overlay
// is open: the entry label plus its diff size, or why there is none.
/**
 * @param {{ tab?: number, entries?: Array<{ code?: string, path?: string }>|null, cursor?: number, lineCount?: number|null, truncated?: boolean }} view
 * @returns {string}
 */
export function buildChangesDetail({ tab = 0, entries = [], cursor = 0, lineCount = null, truncated = false } = {}) {
  const entry = Array.isArray(entries) ? entries[cursor] : null
  if (!entry) return ''
  const label = `${c.cyan}${changesEntryLabel({ entry })}${c.reset}`
  if (lineCount === null) return `${label}${c.dim} · no text diff${c.reset}`
  const size = truncated ? `first ${lineCount}` : `${lineCount}`
  return `${label}${c.dim} · ${size} diff lines${c.reset}`
}

// One visible list row per worktree, padded to the box width, plus scroll
// arrows on the window edges. Pure: the caller passes its state slices.
export function renderRows({ rows, cursor, checked, procs, boxW, first, last, boxH }) {
  const contentW = boxW - 4
  const lines = []
  for (let i = first; i <= last; i++) {
    const row = rows[i]
    const isCursor = i === cursor
    const marker = isCursor ? `${c.cyan}▸${c.reset}` : ' '
    const checkbox = checked.has(row.path) ? `${c.green}[x]${c.reset}` : '[ ]'
    const branch = row.branch ? `${c.gray}(${row.branch})${c.reset}` : `${c.gray}(detached)${c.reset}`
    const unregistered = row.registered === false ? ` ${c.yellow}[unregistered]${c.reset}` : ''
    const mainTag = row.main ? ` ${c.yellow}[main]${c.reset}` : ''
    const mergedTag = rowTags(row)
    const aheadBehind = row.aheadBehind
    const parts = []
    const proc = procs.get(row.path)
    if (proc?.running) parts.push(`${c.green}▶ ${proc.cmd || 'running'}${c.reset}`)
    else if (proc?.cmd && !proc.running && proc.exit !== 0) {
      parts.push(`${c.dim}exit ${proc.exit ?? 'signal'}${c.reset}`)
    }
    if (aheadBehind?.ahead > 0) parts.push(`${c.green}+${aheadBehind.ahead}${c.reset}`)
    if (aheadBehind?.behind > 0) parts.push(`${c.yellow}-${aheadBehind.behind}${c.reset}`)
    const age = formatRelativeTime(row.commitTime)
    if (age) {
      const fresh = Date.now() / 1000 - row.commitTime < 3600
      parts.push(`${fresh ? c.cyan : c.dim}${age}${c.reset}`)
    }
    const meta = parts.length ? ` ${c.dim}·${c.reset} ${parts.join(' ')}` : ''
    let cells = `${marker} ${checkbox} ${row.name} ${branch}${unregistered}${mainTag}${mergedTag}${meta}`
    if (!isCursor) cells = c.dim + cells + c.reset
    // Last two content columns are reserved for the scroll edge marker.
    let line = padRight(truncate(cells, contentW - 2), contentW - 2)
    if (i === first && first > 0) line += ` ${c.dim}▲${c.reset}`
    else if (i === last && last < rows.length - 1) line += ` ${c.dim}▼${c.reset}`
    else line += '  '
    lines.push(line)
  }
  while (lines.length < boxH) lines.push('')
  return { lines }
}

export function dialogGeometry({ cols, rows }) {
  // Leave at least 8 columns of the list visible on each side so the menu
  // reads as an overlay instead of a full-width replacement.
  const dialogW = Math.min(cols - 16, 96)
  // Tall enough for the whole Actions list (12 entries) on a normal terminal.
  const listH = Math.max(3, Math.min(12, rows - 8))
  return { dialogW, listH, rows, cols }
}

// Top row of a centered dialog, raised two rows above the exact center so a
// tall menu clears the status and help lines at the bottom of the frame. Pure,
// so the renderer and the mouse hit test place the dialog identically.
export function dialogTop({ rows, dialogH }) {
  return Math.max(0, Math.floor((rows - dialogH) / 2) - 2)
}

// Composite one dialog row over the row it covers: the base keeps its own
// content (frame borders, list text) outside the dialog's columns, and only
// the dialog's own columns are overwritten. `padLeft`/`rightLen` come from
// dialogGeometry so renderers and the mouse hit test agree on the columns.
export function overlayRow({ base, dialogLine, padLeft, rightLen }) {
  const left = padRight(truncate(base, padLeft), padLeft)
  const right = padRight(takeRight(base, rightLen), rightLen)
  return `${left}${dialogLine}${right}`
}

export function dialogColumns({ cols, dialogW }) {
  const padLeft = Math.max(0, Math.floor((cols - dialogW) / 2))
  return { padLeft, rightLen: Math.max(0, cols - padLeft - dialogW) }
}

export function formatRelativeTime(epochSec, now = Date.now()) {
  if (epochSec == null) return ''
  const s = Math.max(0, now / 1000 - epochSec)
  if (s < 60) return `${Math.floor(s)}s ago`
  const m = s / 60
  if (m < 60) return `${Math.floor(m)}m ago`
  const h = m / 60
  if (h < 24) return `${Math.floor(h)}h ago`
  const d = h / 24
  if (d < 7) return `${Math.floor(d)}d ago`
  const w = d / 7
  if (w < 5) return `${Math.floor(w)}w ago`
  const mo = d / 30
  if (mo < 12) return `${Math.floor(mo)}mo ago`
  return `${Math.floor(d / 365)}y ago`
}

export function currentOptions({ menuTab, checkedCount }) {
  if (menuTab === 0) {
    return [
      'Run command…',
      'Show changes…',
      'Interactive shell',
      `Delete checked (${checkedCount})`,
      'Delete focused',
      'Stop background process',
      'Select all',
      'Clear selection',
      'Refresh',
      'Create worktree…',
      'Select deprecated…',
      'Quit',
    ]
  }
  return [...PRESET_COMMANDS.map(p => p.label), 'Custom command…']
}

export const TAB_LINE_PREFIX = 'Tabs:  '

export function tabLine({ menuTab }) {
  const parts = MODES.map((t, i) =>
    i === menuTab ? `${c.cyan}${c.bold}${c.reverse}${t}${c.reset}` : `${c.gray}${t}${c.reset}`,
  )
  return `${TAB_LINE_PREFIX}${parts.join('  ')}`
}

// Column ranges of the tab labels inside the dialog's content area (i.e.
// relative to the row content start, after the frame's `│ `). The renderer and
// the mouse hit test both derive from this, so a click always lands on the
// label it appears to cover.
export function tabHitColumns() {
  const columns = []
  let start = TAB_LINE_PREFIX.length
  for (const [tab, label] of MODES.entries()) {
    columns.push({ tab, start, end: start + label.length - 1 })
    start += label.length + 2
  }
  return columns
}

// The action menu: tabs row, then the options for the active tab.
export function buildMenuDialog({ menuTab, selectedIndex, checkedCount, dialogW, listH }) {
  return buildDialogBox({
    title: 'MENU',
    dialogW,
    listH,
    options: currentOptions({ menuTab, checkedCount }),
    selectedIndex,
    headerLines: [tabLine({ menuTab })],
  })
}

// The destructive confirm: same box, red frame and red cursor. Two options
export function buildDeleteConfirmDialog({ message, detail, yes, dialogW, listH }) {
  return buildDialogBox({
    title: 'DELETE',
    dialogW,
    listH: Math.min(listH, 2),
    options: ['No', 'Yes'].map(label => `${c.bold}${label}${c.reset}`),
    selectedIndex: yes,
    headerLines: [message, detail],
    accent: c.red,
  })
}

// One text prompt: a label row, the value with a block cursor, then either the
// error or the key hints. Shared by the create-worktree and worktrees-dir
// prompts so both keep identical field behavior and frame.
// Pure: the caller owns the char array and caret in its state, mirroring the
// command-prompt input convention.
/**
 * @param {{ title: string, label: string, hint: string, value?: string[], caret?: number, error?: string|null, dialogW: number }} prompt
 * @returns {{ lines: string[], start: number, total: number }}
 */
export function buildPromptDialog({ title, label, hint, value = [], caret = 0, error, dialogW }) {
  const safeCaret = Math.max(0, Math.min(value.length, caret))
  const before = value.slice(0, safeCaret).join('')
  const at = value[safeCaret] ?? ' '
  const after = value.slice(safeCaret + 1).join('')
  const headerLines = [
    `${label} (${c.dim}${hint}${c.reset}):`,
    `${before}${c.reverse}${at}${c.reset}${after}`,
  ]
  headerLines.push(error ? `${c.red}${error}${c.reset}` : `${c.dim}Enter applies · Esc cancels${c.reset}`)
  return buildDialogBox({ title, dialogW, listH: 0, options: [], selectedIndex: 0, headerLines })
}

// The branch-name prompt for worktree creation: a text field with a block
// cursor plus an optional error line.
export function buildCreateDialog({ name, caret, error, dialogW }) {
  return buildPromptDialog({
    title: 'NEW WORKTREE',
    label: 'Branch name',
    hint: 'type/name · empty cancels',
    value: name,
    caret,
    error,
    dialogW,
  })
}

// The worktree-directory prompt: the value is relative to the project root
// (an absolute path is accepted) and an empty value restores `defaultDir`.
export function buildWorktreesDirDialog({ value, caret, error, dialogW, defaultDir }) {
  return buildPromptDialog({
    title: 'WORKTREES DIR',
    label: 'Directory',
    // Keep label + hint inside a 56-column dialog, the width a 72-column
    // terminal gives, so the reset target is never truncated away.
    hint: `relative · empty resets to ${defaultDir}`,
    value,
    caret,
    error,
    dialogW,
  })
}

// Split one ANSI-decorated pane line into width-sized rows, carrying escape
// sequences into the row that follows them.
export function wrapPaneLine(line, width) {
  if (width <= 0) return ['']
  if (displayWidth(line) <= width) return [line]
  const rows = []
  let cur = ''
  let curW = 0
  for (let i = 0; i < line.length;) {
    if (line[i] === '\x1b') {
      let j = i + 1
      if (line[j] === '[') {
        while (j < line.length && line[j] !== 'm') j++
        j++
      } else {
        j = i + 2
      }
      cur += line.slice(i, j)
      i = j
      continue
    }
    const ch = String.fromCodePoint(line.codePointAt(i))
    const cw = charWidth(ch)
    if (curW + cw > width) {
      rows.push(cur)
      cur = ''
      curW = 0
    }
    cur += ch
    curW += cw
    i += ch.length
  }
  rows.push(cur)
  return rows
}
