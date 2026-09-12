#!/usr/bin/env node
// worktree-manager — full-screen TUI for git worktree management.
//
// Styled after the established alternate-screen TUI convention: raw mode, box-drawn
// layout, diff-based line redraw, windowed cursor, centered dialog overlay, SGR
// mouse, and exact terminal restore on quit.
// Mouse: left-click focuses a row, the [ ] box toggles selection, right-click
// opens the menu, and the wheel scrolls the list, menus, and command output.
// The worktrees frame always uses
// the whole console and reflows on resize. Worktree data comes from the shared
// ./_worktrees.mjs library (no duplicated git logic); delete semantics mirror
// scripts/delete-worktrees.mjs (remove worktree, then delete its branch), with
// one safety divergence: unregistered dirs skip branch cleanup because their
// branch name comes from a foreign .git and may collide with a real main-repo
// branch.
//
// Command mode attaches a sub-pane to the focused row and works like an
// embedded shell session: the status line acts as the prompt, each entered
// command spawns as a child in the pane's worktree, and its (ANSI-stripped)
// output streams into the pane. Detached processes keep running with a row
// badge (green ▶); Esc detaches, Ctrl-D drops a finished proc, x kills the
// focused row's proc, Ctrl-C stops the attached command, PgUp/PgDn scrolls,
// quit stops everything. The interactive shell keeps the fullscreen
// suspend/resume flow because it needs a real TTY.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { stdin, stdout } from 'node:process'
import { StringDecoder } from 'node:string_decoder'

import {
  deleteBranch,
  getLastCommitTime,
  getMainRoot,
  listWorktrees,
  readBranchFromGitDir,
  removeWorktree,
} from './_worktrees.mjs'

import {
  DIALOG_SIDE_PAD_COLS,
  c,
  createScreenRenderer,
  createTerminalManager,
  displayWidth,
  padRight,
  truncate,
} from './_tui.mjs'

// Pure layout/menu model lives in _worktree-tui/layout.mjs; the adapters below
// bind terminal size and live state to it, so that module stays testable.
import { createInputParser } from './_worktree-tui/input.mjs'
import {
  CHECKBOX_FIRST_COL,
  CHECKBOX_LAST_COL,
  CONFIRM_NO_ROW,
  CONFIRM_YES_ROW,
  DIALOG_OPTION_START,
  LIST_TOP_ROW,
  PRESET_COMMANDS,
  currentOptions,
  dialogColumns,
  dialogGeometry,
  formatRelativeTime,
  frameSplit,
  layout,
  listWindow,
  buildDeleteConfirmDialog,
  buildMenuDialog,
  overlayRow,
  renderRows,
  tabHitColumns,
  wrapPaneLine,
} from './_worktree-tui/layout.mjs'

const DEFAULT_STATUS = `${c.green}Ready.${c.reset} Tab: menu · Space: select · Del: delete · c: cmd · s: shell · r: refresh · q: quit.`

const OUTPUT_MAX_LINES = 2000
const KILL_ESCALATE_MS = 2000
const MAX_BACKGROUND = 8 // oldest finished proc evicted past this

function currentLayout() {
  return layout({ termRows: stdout.rows, termCols: stdout.columns })
}

function currentDialogGeometry() {
  const { cols, rows } = currentLayout()
  return dialogGeometry({ cols, rows })
}

function currentFrameSplit(paneOpen = state.mode === 'run' && Boolean(state.pane)) {
  return frameSplit({ boxH: currentLayout().boxH, paneOpen })
}

function currentListWindow() {
  return listWindow({
    count: state.rows.length,
    cursor: state.cursor,
    listH: currentFrameSplit().listH,
  })
}

function currentMenuOptions() {
  return currentOptions({ menuTab: state.menuTab, checkedCount: state.checked.size })
}

// ---- screen (diff-based redraw owned by shared _tui.mjs) ----

const screen = createScreenRenderer()
const term = createTerminalManager()

function writeLines(lines) {
  screen.render(lines, { fullClear: state.fullClear })
  state.fullClear = false
}
// ---- domain ----
function refreshList() {
  const root = state.mainRoot
  const { entries } = listWorktrees(root)
  const rows = [
    {
      path: root,
      name: '(main)',
      branch: readBranchFromGitDir(root) ?? 'HEAD',
      registered: true,
      main: true,
      aheadBehind: null,
      commitTime: getLastCommitTime(root),
    },
  ]
  // listWorktrees returns newest-commit-first; rows without a
  // resolvable time sink to the bottom. Main stays pinned at the top.
  for (const e of entries) {
    rows.push({
      path: e.path,
      name: e.name,
      branch: e.branch,
      registered: e.registered,
      main: false,
      aheadBehind: e.ahead === null ? null : { ahead: e.ahead, behind: e.behind },
      commitTime: e.lastCommitTime,
    })
  }
  state.rows = rows
  // Re-key background procs to fresh rows; kill procs whose worktree vanished.
  const byPath = new Map(rows.map(r => [r.path, r]))
  for (const [key, proc] of state.procs) {
    const row = byPath.get(key)
    if (!row) {
      paneKillChild(proc)
      clearTimeout(proc.escalate)
      state.procs.delete(key)
    } else {
      proc.row = row
    }
  }
  // Keep surviving selections across refreshes; only vanished paths drop.
  state.checked = new Set([...state.checked].filter(p => byPath.has(p)))
  if (state.cursor >= state.rows.length) {
    state.cursor = Math.max(0, state.rows.length - 1)
  }
}

// ---- layout ----

// When a command pane is open the frame splits: list on top, divider, then the
// command output pane. Returns the row budget for each part.
function renderListRows() {
  const { boxW } = currentLayout()
  return renderRows({
    rows: state.rows,
    cursor: state.cursor,
    checked: state.checked,
    procs: state.procs,
    boxW,
    ...currentListWindow(),
  })
}

function buildDialog() {
  const { dialogW, listH } = currentDialogGeometry()
  return buildMenuDialog({
    menuTab: state.menuTab,
    selectedIndex: state.menuCursor,
    checkedCount: state.checked.size,
    dialogW,
    listH,
  })
}

function buildConfirm() {
  const { dialogW, listH } = currentDialogGeometry()
  return buildDeleteConfirmDialog({
    message: state.confirm.message,
    detail: state.confirm.detail,
    yes: state.confirm.yes,
    dialogW,
    listH,
  })
}

// ---- command pane ----

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[@-Z\\-_]/g
// Hard-wrap one pane line into visual rows of at most `width` columns.
// Word-agnostic (character/column based) so long unbroken output (paths,
// URLs, log blobs) still fits instead of truncating. ANSI-aware and
// CJK-aware; empty input yields one blank visual row to preserve spacing.
function procPushOutput(proc, chunk, decoder) {
  proc.pending += decoder.write(chunk)
  const parts = proc.pending.split(/[\r\n]/)
  proc.pending = parts.pop() ?? ''
  for (const raw of parts) {
    proc.lines.push(raw.replace(ANSI_RE, ''))
  }
  if (proc.lines.length > OUTPUT_MAX_LINES) {
    proc.lines.splice(0, proc.lines.length - OUTPUT_MAX_LINES)
  }
  proc.dirty = true
}

// One shared flush tick for every background proc; draws once if any arrived.
function flushProcs() {
  if (state.suspended) return // shell owns the terminal; dirty flags replay on resume via fullClear
  let dirty = false
  for (const proc of state.procs.values()) {
    if (proc.dirty) {
      proc.dirty = false
      dirty = true
    }
  }
  if (dirty) draw()
}

function paneKillChild(pane = state.pane) {
  if (!pane || !pane.running) return
  try {
    process.kill(-pane.child.pid, 'SIGTERM')
  } catch {}
  pane.escalate = setTimeout(() => {
    if (pane.running) {
      try {
        process.kill(-pane.child.pid, 'SIGKILL')
      } catch {}
    }
  }, KILL_ESCALATE_MS)
}

// Detach the pane, leaving its process running in the background. Reattach
// by focusing the row and pressing c.
function paneDetach() {
  if (!state.pane) return
  state.pane = null
  state.mode = 'list'
  state.fullClear = true
  redraw()
}

// Drop the attached pane's proc entirely. A running proc detaches instead.
function dropPane() {
  const pane = state.pane
  if (!pane) return
  if (pane.running) {
    paneDetach()
    return
  }
  clearTimeout(pane.escalate)
  state.procs.delete(pane.row.path)
  state.pane = null
  state.mode = 'list'
  state.fullClear = true
  redraw()
}

function killFocusedProc() {
  const r = state.rows[state.cursor]
  const proc = r && state.procs.get(r.path)
  if (!proc || !proc.cmd) {
    state.status = `${c.yellow}No background process on this row.${c.reset}`
    redraw()
    return
  }
  if (proc.running) {
    paneKillChild(proc)
    state.status = `${c.yellow}Stopping ${proc.cmd} in ${r.name}…${c.reset}`
  } else {
    clearTimeout(proc.escalate)
    state.procs.delete(r.path)
    if (state.pane === proc) {
      state.pane = null
      state.mode = 'list'
      state.fullClear = true
    }
    state.status = DEFAULT_STATUS
  }
  redraw()
}

function cmdPromptActive() {
  return state.mode === 'run' && !!state.pane && !state.pane.running
}

function paneStatusText() {
  const pane = state.pane
  if (pane.running) {
    return `${c.yellow}Running in ${c.gray}${pane.row.name}${c.reset}${c.yellow} · Ctrl-C stops · PgUp/PgDn scroll${c.reset}`
  }
  const exitTag =
    pane.cmd === ''
      ? ''
      : pane.exit === 0
        ? `${c.green}exit 0${c.reset} · `
        : `${c.red}exit ${pane.exit ?? 'signal'}${c.reset} · `
  return (
    `${exitTag}${c.gray}${pane.row.name}${c.reset}` +
    `${c.dim} · Enter runs · ↑ history · Ctrl-C kills · Esc detaches${c.reset}`
  )
}

function openPane(row) {
  let proc = state.procs.get(row.path)
  if (!proc) {
    // Evict the oldest finished proc past the background cap; running procs
    // are never evicted. A map full of running procs refuses with a hint.
    if (state.procs.size >= MAX_BACKGROUND) {
      let evicted = false
      for (const [key, p] of state.procs) {
        if (!p.running) {
          state.procs.delete(key)
          evicted = true
          break
        }
      }
      if (!evicted) {
        state.status = `${c.yellow}Background slots full; stop a process first (x).${c.reset}`
        redraw()
        return
      }
    }
    proc = {
      row,
      cmd: '',
      child: null,
      lines: [],
      pending: '',
      scroll: 0,
      running: false,
      exit: null,
      dirty: true,
      escalate: null,
    }
    state.procs.set(row.path, proc)
  }
  state.mode = 'run'
  state.pane = proc
  state.cmdInput = []
  state.cmdCaret = 0
  state.cmdHistIndex = -1
  redraw()
}

function runInWorktree(cmd, row) {
  if (!row) {
    state.status = `${c.red}No worktree selected.${c.reset}`
    redraw()
    return
  }
  if (state.pane?.row.path !== row.path) openPane(row)
  const pane = state.pane
  if (pane.running) return
  if (pane.lines.length) pane.lines.push('')
  pane.lines.push(`$ ${cmd}`)
  if (pane.lines.length > OUTPUT_MAX_LINES) {
    pane.lines.splice(0, pane.lines.length - OUTPUT_MAX_LINES)
  }
  pane.pending = ''
  pane.scroll = 0
  pane.exit = null
  pane.cmd = cmd
  const decoder = new StringDecoder('utf8')
  const child = spawn(cmd, {
    shell: true,
    cwd: pane.row.path,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // own process group so Ctrl-C can kill the whole tree
  })
  pane.child = child
  pane.running = true
  pane.dirty = true
  child.stdout.on('data', chunk => procPushOutput(pane, chunk, decoder))
  child.stderr.on('data', chunk => procPushOutput(pane, chunk, decoder))
  child.on('error', err => {
    if (state.pane?.child === child) {
      state.pane.lines.push(`${err.message}`)
      state.pane.dirty = true
    }
  })
  child.on('close', code => {
    const p = state.pane
    if (!p || p.child !== child) return
    p.running = false
    p.exit = code
    if (p.escalate) {
      clearTimeout(p.escalate)
      p.escalate = null
    }
    p.dirty = true
    draw()
  })
  redraw()
}

// ---- draw ----

function draw() {
  const { rows, cols, boxW, helpLines } = currentLayout()
  const { lines: listLines } = renderListRows()
  const { listH, cmdH } = currentFrameSplit()
  const border = s => `${c.cyan}${s}${c.reset}`
  const side = t => `${c.cyan}│${c.reset} ${t}${c.cyan} │${c.reset}`

  const header =
    `${c.bold}WORKTREE${c.reset} ${c.dim}· ${path.basename(state.mainRoot)}` +
    ` · ${state.rows.length} worktree(s)${c.reset}`
  const focused = state.rows[state.cursor]
  const subheader =
    `${c.dim}Focused:${c.reset} ${c.dim}${focused ? focused.path : ''}${c.reset}` +
    `  ${c.gray}checked: ${state.checked.size} · Ln ${state.cursor + 1}/${state.rows.length}${c.reset}`

  const lines = [header, subheader]
  lines.push(border(`┌ WORKTREES ${'─'.repeat(Math.max(1, boxW - 13))}┐`))
  for (let i = 0; i < listH; i++) {
    lines.push(side(padRight(listLines[i] ?? '', boxW - 4)))
  }
  if (cmdH > 0) {
    const pane = state.pane
    const dividerColor = pane.running ? c.cyan : c.gray
    const title = pane.cmd ? `─ COMMAND · ${pane.cmd} ` : '─ COMMAND '
    const fill = Math.max(1, boxW - 2 - displayWidth(title))
    lines.push(`${dividerColor}├${title}${'─'.repeat(fill)}┤${c.reset}`)
    const prompt = cmdPromptActive()
    const outH = prompt ? cmdH - 1 : cmdH // last pane row hosts the prompt
    const contentW = boxW - 4
    const wrapped = []
    for (const l of pane.lines) wrapped.push(...wrapPaneLine(l, contentW))
    const total = wrapped.length
    pane.scroll = Math.max(0, Math.min(pane.scroll, total))
    const end = total - pane.scroll
    const start = Math.max(0, end - outH)
    for (let i = 0; i < outH; i++) {
      const idx = start + i
      const out = idx >= 0 && idx < total ? wrapped[idx] : ''
      lines.push(side(padRight(truncate(out, contentW), contentW)))
    }
    if (prompt) {
      const before = state.cmdInput.slice(0, state.cmdCaret).join('')
      const after = state.cmdInput.slice(state.cmdCaret).join('')
      const line =
        `${c.gray}${pane.row.name}${c.reset}${c.cyan}$ ${c.reset}` + `${before}${c.reverse} ${c.reset}${after}`
      lines.push(side(padRight(truncate(line, boxW - 4), boxW - 4)))
    }
  }
  lines.push(border(`└${'─'.repeat(boxW - 2)}┘`))

  let status
  if (state.mode === 'run' && state.pane) {
    status = truncate(paneStatusText(), cols)
  } else {
    status = truncate(state.status, cols)
  }
  lines.push(status)
  lines.push('')
  for (const hl of helpLines) lines.push(`${c.dim}${hl}${c.reset}`)
  while (lines.length < rows) lines.push('')
  if (lines.length > rows) lines.length = rows

  if (state.mode === 'menu' || state.mode === 'confirm') {
    const { dialogW: dw } = currentDialogGeometry()
    const dg = state.mode === 'confirm' ? buildConfirm() : buildDialog()
    const dH = dg.lines.length
    const top = Math.max(0, Math.floor((rows - dH) / 2))
    const { padLeft, rightLen } = dialogColumns({ cols, dialogW: dw })
    for (let k = 0; k < dH; k++) {
      const r = top + k
      if (r >= rows) continue
      // Overlay, never replace: the covered row keeps its frame and list text
      // on both sides of the menu frame.
      lines[r] = overlayRow({ base: lines[r] ?? '', dialogLine: dg.lines[k], padLeft, rightLen })
    }
  }

  writeLines(lines)
}

function redraw() {
  draw()
}

// ---- modal navigation ----

function moveCursor(delta) {
  if (state.rows.length === 0) return
  state.cursor = (state.cursor + delta + state.rows.length) % state.rows.length
  redraw()
}

function toggleCheckbox() {
  const r = state.rows[state.cursor]
  if (r && !r.main) {
    if (state.checked.has(r.path)) state.checked.delete(r.path)
    else state.checked.add(r.path)
  }
  redraw()
}

function selectAll() {
  state.checked = new Set(state.rows.filter(r => !r.main).map(r => r.path))
  redraw()
}

function clearSelection() {
  state.checked = new Set()
  redraw()
}

function openMenu(tab = 0) {
  state.mode = 'menu'
  state.menuTab = tab
  state.menuCursor = 0
  redraw()
}

function closeMenu() {
  state.mode = 'list'
  redraw()
}

function startCommandInput() {
  const row = state.rows[state.cursor]
  if (row) openPane(row)
}

function moveCmdCaret(delta) {
  state.cmdCaret = Math.max(0, Math.min(state.cmdInput.length, state.cmdCaret + delta))
  redraw()
}

function historyUp() {
  const h = state.cmdHistory
  if (!h.length) return
  const idx = state.cmdHistIndex === -1 ? h.length - 1 : Math.max(0, state.cmdHistIndex - 1)
  state.cmdHistIndex = idx
  const val = h[idx]
  state.cmdInput = [...val]
  state.cmdCaret = val.length
  redraw()
}

function historyDown() {
  const h = state.cmdHistory
  if (!h.length) return
  if (state.cmdHistIndex === -1) {
    state.cmdInput = []
    state.cmdCaret = 0
    redraw()
    return
  }
  const idx = Math.min(h.length - 1, state.cmdHistIndex + 1)
  state.cmdHistIndex = idx
  const val = h[idx]
  state.cmdInput = [...val]
  state.cmdCaret = val.length
  redraw()
}

function startConfirm({ rows, message, detail }) {
  state.mode = 'confirm'
  state.confirm = { rows, message, detail, yes: 0 }
  redraw()
}

function executeBatchDelete(rows) {
  const targets = new Set(rows.map(r => r.path))
  let ok = 0
  let failed = 0
  const failedNames = []
  for (const wt of state.rows) {
    if (!targets.has(wt.path) || wt.main) continue
    // removeWorktree can throw before reaching its internal try (main-root
    // lookup); count that as a failed target so one bad row never aborts
    // the rest of the batch.
    try {
      if (removeWorktree(state.mainRoot, wt)) {
        // Skip branch cleanup for unregistered dirs: their branch name comes
        // from a foreign .git and may collide with a real main-repo branch.
        if (wt.registered !== false && wt.branch) {
          deleteBranch(state.mainRoot, wt.branch)
        }
        ok++
      } else {
        failed++
        failedNames.push(wt.name)
      }
    } catch {
      failed++
      failedNames.push(wt.name)
    }
  }
  let status = `${c.green}Deleted ${ok} worktree(s)${c.reset}`
  if (failed) status += `${c.red} · ${failed} failed: ${failedNames.join(', ')}${c.reset}`
  try {
    refreshList()
  } catch (e) {
    // The list stays stale but the TUI stays alive; the user retries with r.
    status += `${c.red} · list refresh failed (${e?.message ?? e}), press r to retry${c.reset}`
  }
  state.status = status
}

function activateMenuItem() {
  const idx = state.menuCursor
  if (state.menuTab === 0) {
    switch (idx) {
      case 0:
        startCommandInput()
        return
      case 1:
        closeMenu()
        launchShell(state.rows[state.cursor])
        return
      case 2: {
        if (state.checked.size === 0) {
          state.status = `${c.yellow}No worktrees selected.${c.reset}`
          redraw()
          return
        }
        confirmDeleteFlow(state.rows.filter(r => state.checked.has(r.path) && !r.main))
        return
      }
      case 3: {
        const r = state.rows[state.cursor]
        if (!r || r.main) {
          state.status = `${c.yellow}Cannot delete the main root.${c.reset}`
          redraw()
          return
        }
        confirmDeleteFlow([r])
        return
      }
      case 4:
        killFocusedProc()
        closeMenu()
        return
      case 5:
        selectAll()
        closeMenu()
        return
      case 6:
        clearSelection()
        closeMenu()
        return
      case 7:
        refreshList()
        closeMenu()
        return
      case 8:
        quit()
        return
      default:
        closeMenu()
        return
    }
  }
  if (idx < PRESET_COMMANDS.length) {
    closeMenu()
    runInWorktree(PRESET_COMMANDS[idx].value, state.rows[state.cursor])
  } else if (idx === PRESET_COMMANDS.length) {
    startCommandInput()
  } else {
    closeMenu()
  }
}

function confirmDeleteFlow(targets) {
  startConfirm({
    rows: targets,
    message: `Delete ${targets.length} worktree(s)?`,
    detail: 'force removes files, branches will be deleted',
  })
}

// Close the confirm dialog before deleting: a failing delete must never
// leave the overlay stuck open (or throw out of the input handler with the
// terminal frozen on the dialog frame). Failures surface as status text.
function resolveConfirm(confirmed) {
  const cfm = state.confirm
  state.mode = 'list'
  state.confirm = null
  if (confirmed && cfm) {
    try {
      executeBatchDelete(cfm.rows)
    } catch (e) {
      state.status = `${c.red}Delete failed: ${e?.message ?? e}${c.reset}`
    }
  }
  redraw()
}

// ---- command execution ----

async function submitCommand() {
  const cmd = state.cmdInput.join('')
  state.cmdInput = []
  state.cmdCaret = 0
  state.cmdHistIndex = -1
  if (!cmd) {
    redraw()
    return
  }
  if (!state.cmdHistory.includes(cmd)) state.cmdHistory.push(cmd)
  if (state.cmdHistory.length > 50) state.cmdHistory.shift()
  runInWorktree(cmd, state.pane ? state.pane.row : state.rows[state.cursor])
}

function launchShell(row) {
  if (!row) {
    state.status = `${c.red}No worktree selected.${c.reset}`
    redraw()
    return
  }
  const shell = process.env.SHELL || '/bin/bash'
  return suspendForCommand({
    run: () =>
      new Promise(resolve => {
        const child = spawn(shell, { cwd: row.path, stdio: 'inherit' })
        child.on('close', resolve)
      }),
    row,
    label: shell,
  })
}

async function suspendForCommand({ run, row, label }) {
  state.status = `${c.yellow}Running: ${label}${c.reset}`
  draw()
  state.suspended = true
  process.stdout.write('\x1b[?1049l\x1b[?25h\x1b[?1002l\x1b[?1006l')
  stdin.setRawMode(false)
  stdin.pause()
  const code = await run()
  state.suspended = false
  stdin.setRawMode(true)
  stdin.resume()
  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?1002h\x1b[?1006h')
  state.fullClear = true
  state.status = `${c.green}exit ${code ?? 'sig'}${c.reset} · ${c.gray}${label}${c.reset} in ${c.gray}${row.name}${c.reset}`
  refreshList()
  redraw()
}

// ---- input ----

function handleWheel(dir) {
  // dir: +1 = wheel down, -1 = wheel up.
  if (state.mode === 'menu') {
    const n = currentMenuOptions().length
    state.menuCursor = Math.max(0, Math.min(n - 1, state.menuCursor + dir))
    redraw()
  } else if (state.mode === 'run') {
    scrollOutput(-dir * 3) // wheel up reveals older output, wheel down newer
  }
  // confirm: wheel is a no-op so the highlight can't drift under the cursor.
}

function handleMouse({ button, x, y, release }) {
  // SGR Cb bits: 0-1 button, 4/8/16 shift/meta/ctrl, 32 drag-motion, 64 wheel.
  if (button & 64) {
    handleWheel(button & 1 ? 1 : -1)
    return
  }
  if (release || button === 3 || button & 32) return // release/drag: ignore
  const btn = button & 3 // strip shift/meta/ctrl modifiers
  if (btn !== 0 && btn !== 2) return // middle button: ignore
  const { cols, rows: rr } = currentLayout()
  const { dialogW, listH } = currentDialogGeometry()

  if (state.mode === 'menu' || state.mode === 'confirm') {
    const dg = state.mode === 'confirm' ? buildConfirm() : buildDialog()
    const top = Math.max(0, Math.floor((rr - dg.lines.length) / 2))
    const left = dialogColumns({ cols, dialogW }).padLeft
    const sr = y - 1
    const sc = x - 1
    if (sc < left || sr < top || sr >= top + dg.lines.length) {
      if (state.mode === 'menu') {
        closeMenu()
      } else {
        state.mode = 'list'
        state.confirm = null
        redraw()
      }
      return
    }
    if (btn !== 0) return // right-click inside a dialog: no-op
    if (state.mode === 'confirm') {
      // Like the menu, a single click decides: No cancels, Yes deletes.
      if (sr === top + CONFIRM_NO_ROW) resolveConfirm(false)
      else if (sr === top + CONFIRM_YES_ROW) resolveConfirm(true)
      else redraw()
      return
    }
    if (sr - top === 1) {
      const contentColumn = sc - (left + DIALOG_SIDE_PAD_COLS)
      const hit = tabHitColumns().find(({ start, end }) => contentColumn >= start && contentColumn <= end)
      if (hit) {
        state.menuTab = hit.tab
        state.menuCursor = 0
        redraw()
        return
      }
    }
    const rel = sr - top - DIALOG_OPTION_START
    const idx = dg.start + rel
    if (rel >= 0 && rel < listH && idx >= 0 && idx < dg.total) {
      state.menuCursor = idx
      activateMenuItem()
    }
    return
  }
  // List / command-pane hit test. Dialog modes return above, so only list
  // and run reach here.
  const { first, boxH } = currentListWindow()
  const sr = y - 1
  if (sr < LIST_TOP_ROW || sr >= LIST_TOP_ROW + boxH) return
  const idx = first + (sr - LIST_TOP_ROW)
  if (idx < 0 || idx >= state.rows.length) return
  const row = state.rows[idx]
  if (btn === 2) {
    // Right-click: context menu for the row. Ignored while a command pane
    // owns the screen so a stray click can't pop a menu over live output.
    if (state.mode === 'list') {
      state.cursor = idx
      openMenu()
    }
    return
  }
  if (state.mode === 'run') {
    // Clicking another row reattaches the pane there, like focusing + c;
    // clicking the attached row just moves the cursor.
    if (!state.pane || state.pane.row.path !== row.path) openPane(row)
    else {
      state.cursor = idx
      redraw()
    }
    return
  }
  state.cursor = idx
  // Clicking the [ ]/[x] box toggles selection (Space parity); anywhere
  // else on the row just moves the cursor.
  if (x >= CHECKBOX_FIRST_COL && x <= CHECKBOX_LAST_COL) toggleCheckbox()
  else redraw()
}

function quit() {
  for (const proc of state.procs.values()) {
    paneKillChild(proc)
    clearTimeout(proc.escalate)
  }
  state.procs.clear()
  clearInterval(flushTimer)
  term.exit()
  console.log(`\nBye. ${state.rows.length} worktree(s) on disk.`)
  process.exit(0)
}

const parseInput = createInputParser()
let flushTimer = null

function scrollOutput(delta) {
  const pane = state.pane
  if (!pane) return
  pane.scroll = Math.max(0, pane.scroll + delta)
  redraw()
}

function onData(chunk) {
  for (const event of parseInput(chunk)) {
    applyInputEvent(event)
  }
}

// Mode gating lives here; the parser only classifies bytes.
function applyInputEvent(event) {
  if (event.type === 'mouse') {
    handleMouse(event.mouse)
    return
  }
  if (event.type === 'text') {
    handleTextInput(event.value)
    return
  }
  if (event.type === 'control') {
    handleControlKey(event.key)
    return
  }
  switch (event.name) {
    case 'up':
      handleArrowUp()
      return
    case 'down':
      handleArrowDown()
      return
    case 'left':
      handleArrowLeft()
      return
    case 'right':
      handleArrowRight()
      return
    case 'home':
      handleHome()
      return
    case 'end':
      handleEnd()
      return
    case 'shift-arrow':
      handleShiftArrow(event.dir)
      return
    case 'pageup':
      if (state.mode === 'run') scrollOutput(currentFrameSplit().cmdH - 1)
      return
    case 'pagedown':
      if (state.mode === 'run') scrollOutput(-currentFrameSplit().cmdH + 1)
      return
    case 'delete':
      handleDeleteKey()
      return
    case 'escape':
      handleEscape()
      return
    case 'tab':
      if (state.mode === 'list') openMenu()
      return
    case 'enter':
      handleEnter()
      return
    case 'backspace':
      handleBackspace()
      return
    case 'ctrl-a':
      if (cmdPromptActive()) moveCmdCaret(-state.cmdCaret)
      else handleHome()
      return
    case 'ctrl-e':
      if (cmdPromptActive()) moveCmdCaret(state.cmdInput.length - state.cmdCaret)
      else handleEnd()
      return
    case 'ctrl-p':
      if (cmdPromptActive()) historyUp()
      else handleArrowUp()
      return
    case 'ctrl-n':
      if (cmdPromptActive()) historyDown()
      else handleArrowDown()
      return
    default:
      return
  }
}

// Ctrl-C/D/Q: while a command runs Ctrl-C stops it; in the command prompt
// Ctrl-C clears the line, Ctrl-D drops the finished proc; otherwise quit.
function handleControlKey(key) {
  if (state.mode === 'run' && state.pane?.running) {
    paneKillChild()
    state.pane.dirty = true
    draw()
    return
  }
  if (cmdPromptActive()) {
    if (state.cmdInput.length || state.cmdCaret) {
      state.cmdInput = []
      state.cmdCaret = 0
      state.cmdHistIndex = -1
      redraw()
    } else if (key === 'd') {
      dropPane()
    } else {
      quit()
    }
    return
  }
  quit()
}

// The delete key mirrors the Del menu entry: batch confirm when several rows
// are checked, otherwise confirm the focused row; the main root never deletes.
function handleDeleteKey() {
  if (state.mode !== 'list') return
  if (state.checked.size > 1) {
    confirmDeleteFlow(state.rows.filter(row => state.checked.has(row.path) && !row.main))
    return
  }
  const row = state.rows[state.cursor]
  if (!row || row.main) {
    state.status = `${c.yellow}Cannot delete the main root.${c.reset}`
    redraw()
    return
  }
  confirmDeleteFlow([row])
}

// Printable input: single-key list commands, command-prompt insertion, and
// stray keys in the other modes (ignored).
function handleTextInput(value) {
  if (state.mode === 'list') {
    if (value === 'q') {
      quit()
    } else if (value === ' ') {
      toggleCheckbox()
    } else if (value === 'a') {
      if (state.checked.size === 0) selectAll()
      else clearSelection()
    } else if (value === 'r') {
      refreshList()
      redraw()
    } else if (value === 's') {
      launchShell(state.rows[state.cursor])
    } else if (value === 'c') {
      startCommandInput()
    } else if (value === 'x') {
      killFocusedProc()
    }
    return
  }
  if (cmdPromptActive()) {
    // Ignore control characters (e.g. Ctrl-L) so they never end up inside the
    // executed command string.
    if (value.codePointAt(0) >= 0x20) {
      state.cmdInput.splice(state.cmdCaret, 0, value)
      state.cmdCaret += value.length
      redraw()
    }
  }
}

function handleArrowUp() {
  if (cmdPromptActive()) {
    historyUp()
  } else if (state.mode === 'menu') {
    state.menuCursor = Math.max(0, state.menuCursor - 1)
    redraw()
  } else if (state.mode === 'confirm') {
    state.confirm.yes = 0
    redraw()
  } else {
    moveCursor(-1)
  }
}

function handleArrowDown() {
  if (cmdPromptActive()) {
    historyDown()
  } else if (state.mode === 'menu') {
    state.menuCursor = Math.min(currentMenuOptions().length - 1, state.menuCursor + 1)
    redraw()
  } else if (state.mode === 'confirm') {
    state.confirm.yes = 1
    redraw()
  } else {
    moveCursor(1)
  }
}

function handleArrowLeft() {
  if (state.mode === 'menu') {
    state.menuTab = 0
    state.menuCursor = 0
    redraw()
  } else if (state.mode === 'confirm') {
    state.confirm.yes = 0
    redraw()
  } else if (cmdPromptActive()) {
    moveCmdCaret(-1)
  }
}

function handleArrowRight() {
  if (state.mode === 'menu') {
    state.menuTab = 1
    state.menuCursor = 0
    redraw()
  } else if (state.mode === 'confirm') {
    state.confirm.yes = 1
    redraw()
  } else if (cmdPromptActive()) {
    moveCmdCaret(1)
  }
}

function handleHome() {
  if (cmdPromptActive()) moveCmdCaret(-state.cmdCaret)
  else if (state.mode === 'list') {
    state.cursor = 0
    redraw()
  }
}

function handleEnd() {
  if (cmdPromptActive()) moveCmdCaret(state.cmdInput.length - state.cmdCaret)
  else if (state.mode === 'list') {
    state.cursor = Math.max(0, state.rows.length - 1)
    redraw()
  }
}

function handleShiftArrow(dir) {
  if (state.mode === 'menu') {
    if (dir === 'C') {
      state.menuTab = 1
      state.menuCursor = 0
    } else if (dir === 'D') {
      state.menuTab = 0
      state.menuCursor = 0
    } else if (dir === 'A') handleArrowUp()
    else if (dir === 'B') handleArrowDown()
    redraw()
  } else if (cmdPromptActive()) {
    if (dir === 'C') moveCmdCaret(1)
    else if (dir === 'D') moveCmdCaret(-1)
  } else if (state.mode === 'confirm') {
    state.confirm.yes = dir === 'C' ? 1 : 0
    redraw()
  }
}

function handleEnter() {
  if (state.mode === 'menu') {
    activateMenuItem()
  } else if (state.mode === 'confirm') {
    resolveConfirm(state.confirm ? state.confirm.yes === 1 : false)
  } else if (cmdPromptActive()) {
    submitCommand()
  } else if (state.mode === 'list') {
    openMenu()
  }
}

function handleBackspace() {
  if (cmdPromptActive() && state.cmdCaret > 0) {
    state.cmdInput.splice(--state.cmdCaret, 1)
    redraw()
  }
}

function handleEscape() {
  if (state.mode === 'run') {
    // Esc detaches: the child keeps running in the background. Ctrl-C kills.
    state.status = `${c.dim}Detached; command keeps running. Focus row + c to reattach.${c.reset}`
    paneDetach()
  } else if (state.mode === 'confirm') {
    state.mode = 'list'
    state.confirm = null
    state.status = DEFAULT_STATUS
    redraw()
  } else if (state.mode === 'menu') {
    state.status = DEFAULT_STATUS
    closeMenu()
  } else if (state.mode === 'list') {
    // Esc clears any transient result message back to the default hint line.
    state.status = DEFAULT_STATUS
    redraw()
  }
}

// ---- state ----

const state = {
  mainRoot: '',
  rows: [],
  cursor: 0,
  checked: new Set(),
  menuTab: 0,
  menuCursor: 0,
  mode: 'list',
  confirm: null,
  pane: null,
  procs: new Map(),
  cmdInput: [],
  cmdCaret: 0,
  cmdHistory: [],
  cmdHistIndex: -1,
  suspended: false,
  status: DEFAULT_STATUS,
  fullClear: true,
}

async function main() {
  if (process.argv[2] === '--help' || process.argv[2] === '-h') {
    console.log(
      'Usage: worktree-manager [dir]\n\nManage git worktrees rooted at the repository containing [dir] (default: current directory).',
    )
    return
  }
  if (!stdin.isTTY || !stdout.isTTY) {
    console.error('worktree-manager requires an interactive terminal.')
    process.exitCode = 1
    return
  }
  const startDir = path.resolve(process.argv[2] ?? '.')
  state.mainRoot = getMainRoot(startDir)
  refreshList()
  term.onResize(() => {
    if (state.suspended) return
    state.fullClear = true
    redraw()
  })
  term.enter()
  try {
    flushTimer = setInterval(flushProcs, 120)
    draw()
    term.onData(onData)
  } catch (error) {
    // A throw after enter() would otherwise leave the terminal in raw mode
    // on the alternate screen. exit() is idempotent.
    clearInterval(flushTimer)
    term.exit()
    throw error
  }
  // Ctrl-C arrives as raw input while attached (see onData), but an external
  // kill -INT/-TERM must still restore the terminal before exiting.
  const restoreAndExit = () => {
    clearInterval(flushTimer)
    term.exit()
    process.exit(0)
  }
  process.once('SIGINT', restoreAndExit)
  process.once('SIGTERM', restoreAndExit)
}

main().catch(e => {
  console.error(e)
  process.exitCode = 1
})
