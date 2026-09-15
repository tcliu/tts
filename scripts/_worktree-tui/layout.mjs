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

// Narrowest column the two-pane viewer allows the file list; the diff keeps
// the larger share of the box.
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

// Column widths of the two-pane viewer, inside the box's `│ ` chrome: the
// narrowest left column that fits the corpus (capped at 40% of the width), one
// separator column, one space, then the diff.
/**
 * @param {{ boxW: number, files?: Array<{ code: string, path: string }> }} pane
 * @returns {{ leftW: number, rightW: number }}
 */
export function diffPaneWidths({ boxW, files = [] }) {
  const contentW = boxW - 4
  const wanted = files.reduce((n, file) => Math.max(n, displayWidth(diffFileLabel(file)) + 2), 0)
  const cap = Math.max(DIFF_LEFT_MIN, Math.floor(contentW * 0.4))
  const leftW = Math.max(DIFF_LEFT_MIN, Math.min(wanted, cap, contentW - DIFF_LEFT_MIN - 2))
  return { leftW, rightW: Math.max(1, contentW - leftW - 2) }
}

// The two-pane body: a FILES/DIFF header row, then one row per visible pair of
// worktree-file and wrapped diff line. The active pane's header carries the
// focus marker and accent, so it is always clear whether ↑/↓ moves the file
// selection or the diff. The file list and the diff scroll independently (the
// list follows the cursor, the diff follows `scroll`), so a long diff never
// moves the selected file out of view. Pure and ANSI-aware; returns `boxH` rows
// each exactly `boxW - 4` visible columns wide.
/**
 * @param {{ files?: Array<{ code: string, path: string }>, cursor?: number, diffLines?: string[]|null, scroll?: number, boxW: number, boxH: number, activePane?: 'files'|'diff' }} view
 * @returns {{ lines: string[], leftW: number, rightW: number, first: number, bodyH: number, diffTotal: number, scroll: number, activePane: 'files'|'diff' }}
 */
export function renderDiffView({
  files = [],
  cursor = 0,
  diffLines = null,
  scroll = 0,
  boxW,
  boxH,
  activePane = 'files',
}) {
  const contentW = boxW - 4
  const { leftW, rightW } = diffPaneWidths({ boxW, files })
  const separator = `${c.cyan}│${c.reset}`
  const focused = files[cursor]
  const active = activePane === 'diff' ? 'diff' : 'files'
  const lines = []

  const header = (text, pane) =>
    pane === active
      ? `▸ ${c.bold}${c.cyan}${text}${c.reset}`
      : `  ${c.dim}${text}${c.reset}`
  const leftHeader = truncate(header(`FILES (${files.length})`, 'files'), leftW)
  const rightHeader = truncate(header(`DIFF · ${diffFileLabel(focused) || 'none'}`, 'diff'), rightW)
  lines.push(`${padRight(leftHeader, leftW)}${separator} ${padRight(rightHeader, rightW)}`)

  const bodyH = Math.max(0, boxH - 1)
  const wrapped = []
  if (diffLines === null) wrapped.push(`${c.yellow}No text diff for this entry.${c.reset}`)
  else for (const line of diffLines) wrapped.push(...wrapPaneLine(colorizeDiffLine(line), rightW))
  const total = wrapped.length
  // `scroll` is the distance from the top of the diff (0 = the first line), so
  // opening a file starts at its beginning — unlike the command pane, where a
  // live process wants the newest output.
  const maxScroll = Math.max(0, total - bodyH)
  const safeScroll = Math.max(0, Math.min(scroll, maxScroll))
  const start = safeScroll
  const window = listWindow({ count: files.length, cursor, listH: Math.max(1, bodyH) })

  for (let i = 0; i < bodyH; i++) {
    const fileIndex = window.first + i
    const file = files[fileIndex]
    let left = ''
    if (file) {
      const selected = fileIndex === cursor
      const marker = selected ? `${c.cyan}▸${c.reset}` : ' '
      const label = `${marker} ${c.gray}${file.code}${c.reset} ${file.path}`
      left = selected ? truncate(label, leftW) : truncate(`${c.dim}${label}${c.reset}`, leftW)
    }
    const diffIndex = start + i
    const right = diffIndex < total ? wrapped[diffIndex] : ''
    lines.push(`${padRight(left, leftW)}${separator} ${padRight(truncate(right, rightW), rightW)}`)
  }

  while (lines.length < boxH) lines.push(padRight('', leftW) + separator + ' ' + padRight('', rightW))
  if (lines.length > boxH) lines.length = boxH
  return { lines, leftW, rightW, first: window.first, bodyH, diffTotal: total, scroll: safeScroll, activePane: active }
}

// Focused-file summary for the detail line under the box: the diff size, or
// why there is none. The key hints live in the status line, which knows which
// pane is active.
/**
 * @param {{ files?: Array<{ code: string, path: string }>, cursor?: number, lineCount?: number|null, truncated?: boolean }} view
 * @returns {string}
 */
export function buildDiffDetail({ files = [], cursor = 0, lineCount = null, truncated = false } = {}) {
  const file = files[cursor]
  if (!file) return ''
  const label = `${c.cyan}${diffFileLabel(file)}${c.reset}`
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
      'Show uncommitted changes…',
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
