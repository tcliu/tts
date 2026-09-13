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

export const HELP_TEXT =
  'Arrows: move · Space: select · a: all · Tab: menu · c: cmd · s: shell · ' +
  'Del: delete · n: new · d: deprecated · x: stop bg · r: refresh · PgUp/PgDn: cmd output · ' +
  'q: quit · Ctrl-C: stop cmd/quit · Mouse: click focus · [ ] select · right-click menu · wheel scroll'

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

export function layout({ termRows, termCols }) {
  const rows = Math.max(20, termRows || 24)
  const cols = Math.max(60, termCols || 80)
  const helpLines = wrapText(HELP_TEXT, cols).slice(0, 3)
  // header + subheader + box + status + blank + help
  const boxH = Math.max(3, rows - 4 - helpLines.length)
  const boxW = cols // the frame always uses the entire console width
  return { rows, cols, boxH, helpLines, boxW }
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
    const mergedTag = row.merged ? ` ${c.yellow}[merged]${c.reset}` : ''
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
  const listH = Math.max(3, Math.min(10, rows - 8))
  return { dialogW, listH, rows, cols }
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

// The branch-name prompt for worktree creation: a text field with a block
// cursor plus an optional error line. Pure: the caller owns the char array
// and caret in its state, mirroring the command-prompt input convention.
export function buildCreateDialog({ name, caret, error, dialogW }) {
  const safeCaret = Math.max(0, Math.min(name.length, caret))
  const before = name.slice(0, safeCaret).join('')
  const at = name[safeCaret] ?? ' '
  const after = name.slice(safeCaret + 1).join('')
  const headerLines = [
    `Branch name (${c.dim}type/name · empty cancels${c.reset}):`,
    `${before}${c.reverse}${at}${c.reset}${after}`,
  ]
  if (error) headerLines.push(`${c.red}${error}${c.reset}`)
  else headerLines.push(`${c.dim}Enter creates · Esc cancels${c.reset}`)
  return buildDialogBox({
    title: 'NEW WORKTREE',
    dialogW,
    listH: 0,
    options: [],
    selectedIndex: 0,
    headerLines,
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
