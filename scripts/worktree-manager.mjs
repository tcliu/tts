#!/usr/bin/env node
// worktree-manager — full-screen TUI for git worktree management.
//
// Styled after the established alternate-screen TUI convention: raw mode, box-drawn
// layout, diff-based line redraw, windowed cursor, centered dialog overlay, SGR
// mouse, and exact terminal restore on quit.
// Mouse: left-click focuses a row, the [ ] box toggles selection, right-click
// opens the menu, and the wheel scrolls the list, menus, and command output.
// Keys n opens a branch-name prompt that creates a worktree (same setup as
// scripts/create-worktree.mjs); d checks every row already merged into the
// base branch with a clean working tree ([merged] badge) so Del reviews them
// as one batch — a checkout holding uncommitted work is never offered, since
// the delete path force-removes it.
// The worktrees frame always uses
// the whole console and reflows on resize. Worktree data comes from the shared
// ./_worktrees.mjs library (no duplicated git logic); delete semantics mirror
// scripts/delete-worktrees.mjs (remove worktree, then delete its branch), with
// one safety divergence: unregistered dirs skip branch cleanup because their
// branch name comes from a foreign .git and may collide with a real main-repo
// branch. Rows and the detail line under the box report each checkout's
// uncommitted files, including the main one.
//
// Changes mode (`u`, menu: Show changes…) stacks a fullscreen dialog over the
// untouched list view with three tabs — Uncommitted, Ahead, Behind — over the
// focused worktree: every tab lists changed files on the left (working-tree
// files, files the branch changed vs the base, files the base changed vs the
// branch) with the focused file's diff on the right — unified by default, or
// side-by-side before/after subpanes after `v`. ←/→ switch tabs, Tab moves
// focus between the entries and the diff (so ↑/↓ either steps the entries or
// walks the diff one line at a time); 1/2/3 jump to a tab, PgUp/PgDn and the
// wheel scroll the diff, r re-reads all three corpora, Esc/q closes back to
// the list, and clicking a tab selects it while clicking a pane focuses it (a
// click on an entry also selects it). The focused pane's header carries the
// marker, and the dialog's footer row carries the key hints.
// Worktree directory (`w`) stores a relative or absolute root in the project's
// gitignored `.env.local` under WORKTREES_DIR, defaulting to `.worktrees`, and
// re-scans the list after a change; it stays off the menu because it is a
// setting rather than an action. Every script that walks worktrees resolves the
// same setting, and a directory outside .gitignore is reported in the status
// line.
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
import { existsSync } from 'node:fs'
import path from 'node:path'
import { stdin, stdout } from 'node:process'
import { StringDecoder } from 'node:string_decoder'

import {
  DEFAULT_WORKTREES_DIR,
  countDirtyFiles,
  deleteBranch,
  findProcessesInPath,
  getBranchFileDiff,
  getDirtyDetail,
  getFileDiff,
  getLastCommitTime,
  getMainRoot,
  getWorktreesRoot,
  isMergedToBase,
  isPathIgnored,
  isValidBranchName,
  listBranchFiles,
  listDirtyFiles,
  listWorktrees,
  readBranchFromGitDir,
  removeWorktree,
  removeWorktreeAndBranch,
  resolveWorktreesDir,
  setWorktreesDir,
  setupWorktree,
  terminateProcessesInPath,
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
  CHANGES_BODY_START,
  CHANGES_TAB_ROW,
  CHECKBOX_FIRST_COL,
  CHECKBOX_LAST_COL,
  CONFIRM_NO_ROW,
  CONFIRM_YES_ROW,
  DIALOG_OPTION_START,
  LIST_TOP_ROW,
  PRESET_COMMANDS,
  buildChangesDetail,
  buildChangesDialog,
  buildDirtyDetail,
  changesFullscreenGeometry,
  changesTabHitColumns,
  changesTabLine,
  currentOptions,
  dialogColumns,
  dialogGeometry,
  dialogTop,
  formatRelativeTime,
  frameSplit,
  layout,
  listWindow,
  isDeprecated,
  buildCreateDialog,
  buildDeleteConfirmDialog,
  buildMenuDialog,
  buildWorktreesDirDialog,
  overlayRow,
  renderRows,
  tabHitColumns,
  wrapPaneLine,
} from './_worktree-tui/layout.mjs'

const DEFAULT_STATUS = `${c.green}Ready.${c.reset} u: changes · w: dir · Tab: menu · Space: select · Del: delete · c: cmd · s: shell · n: new · d: deprecated · r: refresh · q: quit.`

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
  const { base, entries } = listWorktrees(root, state.worktreesDir)
  state.base = base
  // One porcelain call covers both the dirty count and the preview files.
  const mainDetail = getDirtyDetail(root)
  const rows = [
    {
      path: root,
      name: '(main)',
      branch: readBranchFromGitDir(root) ?? 'HEAD',
      registered: true,
      main: true,
      aheadBehind: null,
      dirty: mainDetail.dirty,
      dirtyFiles: mainDetail.files,
      commitTime: getLastCommitTime(root),
    },
  ]
  // listWorktrees returns newest-commit-first; rows without a
  // resolvable time sink to the bottom. Main stays pinned at the top.
  for (const e of entries) {
    const detail = getDirtyDetail(e.path)
    rows.push({
      path: e.path,
      name: e.name,
      branch: e.branch,
      registered: e.registered,
      main: false,
      merged: isMergedToBase({ root, base, worktreePath: e.path, branch: e.branch }),
      dirty: detail.dirty,
      dirtyFiles: detail.files,
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

// The box body is always the worktree list; the changes overlay draws on top
// of it like every other dialog, so the frame chrome never changes.
function renderBoxRows() {
  const { boxW } = currentLayout()
  const { boxH } = currentListWindow()
  return renderRows({
    rows: state.rows,
    cursor: state.cursor,
    checked: state.checked,
    procs: state.procs,
    boxW,
    ...currentListWindow(),
  })
}

function buildCreate() {
  const { dialogW } = currentDialogGeometry()
  if (state.create.kind === 'worktreesDir') {
    return buildWorktreesDirDialog({
      value: state.create.input,
      caret: state.create.caret,
      error: state.create.error,
      dialogW,
      defaultDir: DEFAULT_WORKTREES_DIR,
    })
  }
  return buildCreateDialog({
    name: state.create.input,
    caret: state.create.caret,
    error: state.create.error,
    dialogW,
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

// The changes dialog stacks fullscreen over the list: it uses the whole
// terminal (not the centered menu geometry) and carries its key hints as a
// footer row, since it covers the frame's own status line. The builder clamps
// the scroll to the rendered diff, so the state is kept in step here (same
// contract as the command pane in `draw()`).
function buildChanges() {
  const { cols, rows } = currentLayout()
  const { dialogW, listH } = changesFullscreenGeometry({ cols, rows })
  const view = state.changes
  const [beforeLabel, afterLabel] = changesSideLabels(view)
  const dg = buildChangesDialog({
    context: changesContext(view),
    tab: view.tab,
    counts: changesCounts(view),
    entries: changesEntries(view),
    cursor: view.cursors[view.tab] ?? 0,
    diffLines: view.diffLines,
    scroll: view.scrolls[view.tab] ?? 0,
    activePane: view.activePane,
    footer: changesStatusText(),
    viewMode: view.viewMode,
    beforeLabel,
    afterLabel,
    dialogW,
    listH,
  })
  view.scrolls[view.tab] = dg.scroll ?? view.scrolls[view.tab]
  return dg
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

// Delete the word before the caret (readline Ctrl-W), shared by the create
// prompt and the command prompt. Mutates `chars` and returns the new caret.
function deleteWordBack(chars, caret) {
  let i = caret
  while (i > 0 && chars[i - 1] === ' ') i--
  while (i > 0 && chars[i - 1] !== ' ') i--
  chars.splice(i, caret - i)
  return i
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

// ---- changes overlay (`u`: uncommitted + ahead + behind file tabs) ----

// Active tab's file corpus: dirty files (0), files the branch changed vs the
// base (1), files the base changed vs the branch (2).
function changesEntries(view) {
  if (!view) return []
  if (view.tab === 1) return view.ahead
  if (view.tab === 2) return view.behind
  return view.files
}

function changesCounts(view) {
  if (!view) return [null, null, null]
  return [view.files?.length ?? null, view.ahead?.length ?? null, view.behind?.length ?? null]
}

// Branch names over the side-by-side subpanes, following the diff's own
// sides: uncommitted diffs HEAD against the worktree, ahead diffs the base
// against the branch, behind diffs the branch against the base.
function changesSideLabels(view) {
  if (!view) return ['', '']
  const base = view.base ?? '?'
  const branch = view.row.branch ?? '?'
  if (view.tab === 1) return [base, branch]
  if (view.tab === 2) return [branch, base]
  return ['HEAD', branch]
}

function changesContext(view) {
  if (!view) return ''
  const label = view.row.main ? '(main)' : view.row.name
  return `${label} (${view.row.branch ?? 'detached'}) vs ${view.base ?? '?'}`
}

// Fullscreen dialog over one worktree: every tab lists changed files with the
// focused file's diff. Re-reads every corpus from git rather than trusting
// the row's preview, which keeps only the first few dirty files and bare
// ahead/behind counts. Opens when at least one corpus was read; a worktree
// with nothing to show stays on the list and reports why.
function openChangesView(row = state.rows[state.cursor]) {
  if (!row) {
    state.status = `${c.red}No worktree selected.${c.reset}`
    redraw()
    return
  }
  const corpora = readChangesCorpora(row)
  if (corpora.files === null && corpora.ahead === null && corpora.behind === null) {
    state.status = `${c.red}Cannot read changes in ${row.name}.${c.reset}`
    redraw()
    return
  }
  if (allCorporaEmpty(corpora)) {
    state.status = `${c.green}${row.name} is clean and up to date with ${state.base ?? 'the base branch'}.${c.reset}`
    redraw()
    return
  }
  // Open on the first tab holding files, so a clean tree with ahead changes
  // lands on Ahead instead of an empty Uncommitted pane.
  const tab = [corpora.files, corpora.ahead, corpora.behind].findIndex(c => (c?.length ?? 0) > 0)
  state.mode = 'changes'
  state.changes = {
    row,
    base: state.base,
    tab: Math.max(0, tab),
    ...corpora,
    cursors: [0, 0, 0],
    scrolls: [0, 0, 0],
    diffLines: null,
    truncated: false,
    activePane: 'entries',
    viewMode: 'unified',
  }
  loadChangesDiff()
  state.fullClear = true
  redraw()
}

function readChangesCorpora(row) {
  const files = listDirtyFiles(row.path)
  const branchArgs = { root: state.mainRoot, base: state.base, branch: row.branch, registered: row.registered !== false }
  const ahead = listBranchFiles({ ...branchArgs, direction: 'ahead' })
  const behind = listBranchFiles({ ...branchArgs, direction: 'behind' })
  return { files, ahead, behind }
}

// A corpus is empty only when git answered with no entries. `null` means the
// read failed, so it must never be counted as "clean".
function allCorporaEmpty({ files, ahead, behind }) {
  const isEmpty = corpus => Array.isArray(corpus) && corpus.length === 0
  return isEmpty(files) && isEmpty(ahead) && isEmpty(behind)
}

// One synchronous git read per focused file: a single-file diff is small
// enough that the command pane's async machinery would only add state.
function loadChangesDiff() {
  const view = state.changes
  if (!view) return
  const entries = changesEntries(view)
  const cursor = view.cursors[view.tab] ?? 0
  if (!Array.isArray(entries) || entries.length === 0) {
    view.diffLines = []
    view.truncated = false
    view.scrolls[view.tab] = 0
    return
  }
  const entry = entries[Math.max(0, Math.min(cursor, entries.length - 1))]
  const diff =
    view.tab === 0
      ? getFileDiff({ worktreePath: view.row.path, file: entry })
      : getBranchFileDiff({
          root: state.mainRoot,
          base: view.base,
          branch: view.row.branch,
          direction: view.tab === 1 ? 'ahead' : 'behind',
          registered: view.row.registered !== false,
          file: entry,
        })
  // An empty result means there is nothing textually diffable (an untracked
  // directory, a mode-only change), which the overlay reports instead of
  // showing a blank pane.
  view.diffLines = diff && diff.lines.length > 0 ? diff.lines : null
  view.truncated = Boolean(diff?.truncated && diff.lines.length > 0)
  view.scrolls[view.tab] = 0
}

function setChangesTab(tab) {
  const view = state.changes
  if (!view) return
  const next = (tab + 3) % 3
  if (view.tab === next) return
  view.tab = next
  loadChangesDiff()
  redraw()
}

function moveChangesCursor(delta) {
  const view = state.changes
  if (!view) return
  const entries = changesEntries(view)
  if (!Array.isArray(entries) || entries.length === 0) return
  const cursor = view.cursors[view.tab] ?? 0
  view.cursors[view.tab] = (cursor + delta + entries.length) % entries.length
  loadChangesDiff()
  redraw()
}

function jumpChangesCursor(index) {
  const view = state.changes
  if (!view) return
  const entries = changesEntries(view)
  if (!Array.isArray(entries) || entries.length === 0) return
  view.cursors[view.tab] = Math.max(0, Math.min(index, entries.length - 1))
  loadChangesDiff()
  redraw()
}

// Tab cycles the focused pane (entries vs diff); ←/→ switch tabs, so one key
// always means one dimension.
function cycleChangesPane() {
  const view = state.changes
  if (!view) return
  view.activePane = view.activePane === 'diff' ? 'entries' : 'diff'
  redraw()
}

// Flip the diff pane between the unified diff and side-by-side before/after
// subpanes. The builder clamps the kept scroll to the re-rendered rows.
function toggleChangesView() {
  const view = state.changes
  if (!view) return
  view.viewMode = view.viewMode === 'side' ? 'unified' : 'side'
  redraw()
}

function setChangesPane(pane) {
  const view = state.changes
  if (!view || view.activePane === pane) return
  view.activePane = pane
  redraw()
}

function scrollChanges(delta) {
  const view = state.changes
  if (!view) return
  view.scrolls[view.tab] = Math.max(0, (view.scrolls[view.tab] ?? 0) + delta)
  redraw()
}

// Jump the diff to one end (Home/End while the diff pane is focused). The
// builder clamps the value to the rendered diff, so an arbitrarily large
// number means "the last line".
function scrollChangesEdge(edge) {
  const view = state.changes
  if (!view) return
  view.scrolls[view.tab] = edge === 'start' ? 0 : Number.MAX_SAFE_INTEGER
  redraw()
}

// Re-read all three corpora and the focused diff without leaving the overlay,
// for changes made outside the manager while it is open.
function reloadChangesView() {
  const view = state.changes
  if (!view) return
  const corpora = readChangesCorpora(view.row)
  if (corpora.files === null && corpora.ahead === null && corpora.behind === null) {
    closeChangesView()
    state.status = `${c.red}Cannot read changes in ${view.row.name}.${c.reset}`
    redraw()
    return
  }
  if (allCorporaEmpty(corpora)) {
    closeChangesView()
    state.status = `${c.green}${view.row.name} is clean and up to date with ${state.base ?? 'the base branch'}.${c.reset}`
    redraw()
    return
  }
  Object.assign(view, corpora)
  for (let tab = 0; tab < 3; tab++) {
    const entries = tab === 0 ? view.files : tab === 1 ? view.ahead : view.behind
    view.cursors[tab] = Array.isArray(entries) && entries.length > 0 ? Math.max(0, Math.min(view.cursors[tab] ?? 0, entries.length - 1)) : 0
    if (!Array.isArray(entries)) view.scrolls[tab] = 0
  }
  loadChangesDiff()
  redraw()
}

function closeChangesView() {
  state.mode = 'list'
  state.changes = null
  state.fullClear = true
  state.status = DEFAULT_STATUS
  redraw()
}

// Footer/status line of the changes overlay. The keys come first and the
// worktree context last: the dialog is fullscreen, so this is the only visible
// key reference and a narrow terminal must drop the context, never the hints.
function changesStatusText() {
  const view = state.changes
  if (!view) return ''
  const truncated = view.truncated ? `${c.yellow}diff truncated${c.reset} · ` : ''
  const arrows = view.activePane === 'diff' ? '↑↓ line' : '↑↓ entry'
  return (
    `${truncated}${c.dim}${arrows} · ←→ tab · Tab pane · v view · PgUp/PgDn · Esc/q close` +
    ` · ${c.gray}${view.row.name}${c.reset}`
  )
}

// ---- draw ----

function draw() {
  const { rows, cols, boxW, helpLines } = currentLayout()
  const box = renderBoxRows()
  const listLines = box.lines
  const { listH, cmdH } = currentFrameSplit()
  const border = s => `${c.cyan}${s}${c.reset}`
  const side = t => `${c.cyan}│${c.reset} ${t}${c.cyan} │${c.reset}`

  const header =
    `${c.bold}WORKTREE MANAGER${c.reset} ${c.dim}· ${path.basename(state.mainRoot)}` +
    ` · ${state.rows.length} worktree(s)${c.reset}`
  const focused = state.rows[state.cursor]
  const subheader =
    `${c.dim}Focused:${c.reset} ${c.dim}${focused ? focused.path : ''}${c.reset}` +
    `  ${c.gray}checked: ${state.checked.size} · Ln ${state.cursor + 1}/${state.rows.length}${c.reset}`

  const boxHead = '┌ WORKTREES '
  const lines = [header, subheader]
  lines.push(border(`${boxHead}${'─'.repeat(Math.max(1, boxW - displayWidth(boxHead) - 1))}┐`))
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
  // Focused-row uncommitted detail: one stable line between the box and the
  // status, so cursor movement never shifts the frame. Placed after the box
  // so list hit-testing (LIST_TOP_ROW + boxH) is unaffected; the overlay
  // reports its focused entry there instead.
  const detail =
    state.mode === 'changes' && state.changes
      ? buildChangesDetail({
          tab: state.changes.tab,
          entries: changesEntries(state.changes),
          cursor: state.changes.cursors[state.changes.tab] ?? 0,
          lineCount: state.changes.diffLines ? state.changes.diffLines.length : null,
          truncated: state.changes.truncated,
        })
      : buildDirtyDetail({ row: focused })
  lines.push(truncate(detail, cols))

  let status
  if (state.mode === 'run' && state.pane) {
    status = truncate(paneStatusText(), cols)
  } else if (state.mode === 'changes' && state.changes) {
    status = truncate(changesStatusText(), cols)
  } else {
    status = truncate(state.status, cols)
  }
  lines.push(status)
  for (const hl of helpLines) lines.push(`${c.dim}${hl}${c.reset}`)
  while (lines.length < rows) lines.push('')
  if (lines.length > rows) lines.length = rows

  if (state.mode === 'menu' || state.mode === 'confirm' || state.mode === 'create' || state.mode === 'changes') {
    const { dialogW: dw } = currentDialogGeometry()
    const dg =
      state.mode === 'confirm'
        ? buildConfirm()
        : state.mode === 'create'
          ? buildCreate()
          : state.mode === 'changes'
            ? buildChanges()
            : buildDialog()
    const dH = dg.lines.length
    // The changes dialog stacks fullscreen over the list; every other dialog
    // floats centered.
    const top = state.mode === 'changes' ? 0 : dialogTop({ rows, dialogH: dH })
    const { padLeft, rightLen } =
      state.mode === 'changes' ? { padLeft: 0, rightLen: 0 } : dialogColumns({ cols, dialogW: dw })
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

function startConfirm({ rows, message, detail, terminate = false }) {
  state.mode = 'confirm'
  state.confirm = { rows, message, detail, yes: 0, terminate }
  redraw()
}

function executeBatchDelete(rows) {
  const targets = new Set(rows.map(r => r.path))
  let ok = 0
  const failures = []
  for (const wt of state.rows) {
    if (!targets.has(wt.path) || wt.main) continue
    // Re-check for running processes: one may have started between the
    // confirm dialog and Yes. A guarded row fails with its reason instead of
    // half-deleting (unregistered, files/branch/server left behind).
    const blockers = findProcessesInPath(wt.path)
    if (blockers === null) {
      failures.push({ name: wt.name, reason: 'process status unreadable' })
      continue
    }
    if (blockers.length > 0) {
      failures.push({ name: wt.name, reason: `process ${blockers[0].pid} running inside` })
      continue
    }
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
        failures.push({ name: wt.name, reason: 'remove failed' })
      }
    } catch {
      failures.push({ name: wt.name, reason: 'remove failed' })
    }
  }
  let status = `${c.green}Deleted ${ok} worktree(s)${c.reset}`
  if (failures.length) {
    status += `${c.red} · ${failures.length} failed: ${failures.map(f => `${f.name} (${f.reason})`).join(', ')}${c.reset}`
  }
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
        openChangesView()
        return
      case 2:
        closeMenu()
        launchShell(state.rows[state.cursor])
        return
      case 3: {
        if (state.checked.size === 0) {
          state.status = `${c.yellow}No worktrees selected.${c.reset}`
          redraw()
          return
        }
        confirmDeleteFlow(state.rows.filter(r => state.checked.has(r.path) && !r.main))
        return
      }
      case 4: {
        const r = state.rows[state.cursor]
        if (!r || r.main) {
          state.status = `${c.yellow}Cannot delete the main root.${c.reset}`
          redraw()
          return
        }
        confirmDeleteFlow([r])
        return
      }
      case 5:
        killFocusedProc()
        closeMenu()
        return
      case 6:
        selectAll()
        closeMenu()
        return
      case 7:
        clearSelection()
        closeMenu()
        return
      case 8:
        refreshList()
        closeMenu()
        return
      case 9:
        closeMenu()
        openCreate()
        return
      case 10:
        closeMenu()
        scanDeprecated()
        return
      case 11:
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
  // Guarded checkouts are offered a terminate-and-delete confirm instead of
  // being refused outright: deleting a worktree out from under a running
  // process half-removes it (unregistered, files/branch/server left behind).
  // Targets with an unreadable process status stay refused — with no PID list
  // there is nothing explicit to confirm.
  const blocked = []
  const unknown = []
  for (const target of targets) {
    const procs = findProcessesInPath(target.path)
    if (procs === null) {
      unknown.push(target)
      continue
    }
    for (const proc of procs) {
      blocked.push({ target, proc })
    }
  }
  if (unknown.length > 0) {
    const names = [...new Set(unknown.map(t => t.name))].join(', ')
    state.status = `${c.red}Cannot delete: ${names} has an unreadable process status. Stop any processes inside first.${c.reset}`
    redraw()
    return
  }
  if (blocked.length > 0) {
    const names = [...new Set(blocked.map(b => b.target.name))].join(', ')
    const pids = blocked.map(b => `${b.proc.pid}${b.proc.cmd ? ` (${b.proc.cmd})` : ''}`).join(', ')
    startConfirm({
      rows: targets,
      message: `Terminate ${blocked.length} process(es) and delete ${targets.length} worktree(s)?`,
      detail: `kill ${pids} in ${names}; force removes files, branches will be deleted`,
      terminate: true,
    })
    return
  }
  startConfirm({
    rows: targets,
    message: `Delete ${targets.length} worktree(s)?`,
    detail: 'force removes files, branches will be deleted',
  })
}

// ---- create + deprecated scan ----

function openCreate() {
  state.mode = 'create'
  state.create = { kind: 'create', input: [], caret: 0, error: null }
  redraw()
}

// Pre-fill the field with the configured value so Enter keeps it and a small
// edit (or an empty field, which restores the default) is one keystroke away.
function openWorktreesDir() {
  const value = [...state.worktreesDir]
  state.mode = 'create'
  state.create = { kind: 'worktreesDir', input: value, caret: value.length, error: null }
  redraw()
}

// Persist the directory and re-scan: the whole inventory comes from it, so the
// list must be rebuilt rather than patched. An empty value restores the
// default, and a directory outside `.gitignore` is flagged because worktrees
// must never enter version control.
function applyWorktreesDir(value) {
  const mainRoot = state.mainRoot
  const next = value.trim()
  const resolved = getWorktreesRoot(mainRoot, next || DEFAULT_WORKTREES_DIR)
  if (path.resolve(resolved) === path.resolve(mainRoot)) {
    state.create.error = 'The worktree directory cannot be the project root.'
    redraw()
    return
  }
  const stored = setWorktreesDir(mainRoot, next)
  state.worktreesDir = stored ?? DEFAULT_WORKTREES_DIR
  state.mode = 'list'
  state.create = null
  state.fullClear = true
  let count = 0
  let note = ''
  try {
    refreshList()
    count = Math.max(0, state.rows.length - 1)
    if (isPathIgnored(mainRoot, resolved) === false) note = ` ${c.yellow}· not gitignored${c.reset}`
  } catch (e) {
    note = ` ${c.red}· list refresh failed (${e?.message ?? e}), press r to retry${c.reset}`
  }
  state.status =
    `${c.green}Worktree directory:${c.reset} ${c.gray}${state.worktreesDir}${c.reset}` +
    ` · ${count} worktree(s)${note}`
  redraw()
}

function cancelCreate() {
  state.mode = 'list'
  state.create = null
  state.status = DEFAULT_STATUS
  redraw()
}

// Mirrors scripts/create-worktree.mjs: register, copy dev files, tag, carry
// the main checkout's uncommitted changes. Validation failures keep the
// dialog open with an error; setup failures clean up and report status. Only
// `setupWorktree` failures roll back — the list refresh after a successful
// setup has its own guard, so a stale list can never delete the new worktree.
function submitCreate() {
  const raw = state.create.input.join('').trim()
  if (state.create.kind === 'worktreesDir') {
    applyWorktreesDir(raw)
    return
  }
  const branchName = raw
  if (!branchName) {
    cancelCreate()
    return
  }
  if (!isValidBranchName(branchName)) {
    state.create.error = `Invalid branch name: ${branchName}`
    redraw()
    return
  }
  const dir = path.join(getWorktreesRoot(state.mainRoot, state.worktreesDir), branchName)
  if (existsSync(dir)) {
    state.create.error = `Worktree already exists: ${branchName}`
    redraw()
    return
  }
  try {
    const { carried } = setupWorktree({ root: state.mainRoot, worktreePath: dir, branch: branchName })
    state.mode = 'list'
    state.create = null
    const notes = carried.notes.length ? ` ${c.yellow}· ${carried.notes.join('; ')}${c.reset}` : ''
    state.status = `${c.green}Worktree created:${c.reset} ${c.gray}${branchName}${c.reset}${notes}`
    try {
      refreshList()
    } catch (refreshError) {
      // The creation succeeded, so there is nothing to roll back here: the new
      // worktree stays on disk and the list is one r away, same as the batch
      // delete path.
      state.status += `${c.red} · list refresh failed (${refreshError?.message ?? refreshError}), press r to retry${c.reset}`
    }
  } catch (e) {
    if (e?.phase === 'register') {
      state.create.error = `Could not create worktree (${e?.message ?? e})`
      redraw()
      return
    }
    const cleanup = removeWorktreeAndBranch(state.mainRoot, dir, branchName)
    state.mode = 'list'
    state.create = null
    state.status = cleanup.removed
      ? `${c.red}Worktree setup failed, cleaned up (${e?.message ?? e})${c.reset}`
      : `${c.red}Worktree setup failed and rollback failed (${e?.message ?? e})${c.reset}`
  }
  redraw()
}

// Check every row that is already merged and has a clean working tree so Del
// reviews a batch the force-remove delete path cannot lose work from. The
// dirty count is re-read here rather than trusted from the row, and a status
// that cannot be read counts as unsafe. Merged checkouts left out are reported
// so the missing [merged] badge is explained instead of looking like a bug.
function scanDeprecated() {
  const mergedRows = state.rows.filter(r => !r.main && r.merged === true)
  const deprecated = []
  for (const r of mergedRows) {
    if (isDeprecated(r) && countDirtyFiles(r.path) === 0) deprecated.push(r)
  }
  const heldBack = mergedRows.length - deprecated.length
  if (deprecated.length === 0) {
    state.status =
      heldBack > 0
        ? `${c.yellow}No deprecated worktrees: ${heldBack} merged checkout(s) still hold uncommitted work or an unreadable status (r: refresh).${c.reset}`
        : `${c.yellow}No deprecated worktrees: every worktree holds commits missing from the base.${c.reset}`
    redraw()
    return
  }
  state.checked = new Set(deprecated.map(r => r.path))
  const heldNote = heldBack > 0 ? ` ${c.yellow}· ${heldBack} held back (uncommitted work)${c.reset}` : ''
  state.status = `${c.green}${deprecated.length} deprecated worktree(s) selected${c.reset}${heldNote} · Del deletes · Space toggles`
  redraw()
}

// Close the confirm dialog before deleting: a failing delete must never
// leave the overlay stuck open (or throw out of the input handler with the
// terminal frozen on the dialog frame). Failures surface as status text.
// Fire-and-forget: callers ignore the return, and every await sits inside the
// try so a rejection can never escape as an unhandled rejection.
async function resolveConfirm(confirmed) {
  const cfm = state.confirm
  state.mode = 'list'
  state.confirm = null
  if (!confirmed || !cfm) {
    redraw()
    return
  }
  try {
    if (cfm.terminate) {
      state.status = `${c.yellow}Terminating processes…${c.reset}`
      redraw()
      const failures = []
      for (const row of cfm.rows) {
        if (row.main) continue
        const { skipped } = await terminateProcessesInPath(row.path)
        for (const s of skipped) {
          failures.push(`${row.name}${s.pid ? ` (pid ${s.pid}: ${s.reason})` : ` (${s.reason})`}`)
        }
      }
      if (failures.length > 0) {
        state.status = `${c.red}Cannot delete: ${failures.join(', ')}.${c.reset}`
        redraw()
        return
      }
      // Survivors-free targets flow into the batch below, whose per-row
      // guard re-check fails anything that restarted mid-terminate.
    }
    executeBatchDelete(cfm.rows)
  } catch (e) {
    state.status = `${c.red}Delete failed: ${e?.message ?? e}${c.reset}`
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
  } else if (state.mode === 'changes') {
    scrollChanges(dir * 3) // wheel down moves into the diff, wheel up toward its start
  }
  // confirm: wheel is a no-op so the highlight can't drift under the cursor.
}

// Left-click inside the changes overlay: a tab selects it, the pane header
// row only takes focus, and the left column also selects the entry under the
// pointer while the right column only takes focus.
function handleChangesClick({ sr, sc, top, left, dg }) {
  const view = state.changes
  if (!view) return
  const rel = sr - top
  if (rel === CHANGES_TAB_ROW) {
    const contentColumn = sc - (left + DIALOG_SIDE_PAD_COLS)
    // Bound the hit test to the rendered tab text: on a narrow terminal the
    // labels truncate, and clicks past the visible text must not select a tab.
    const contentW = dg.leftW + dg.rightW + 2
    const visibleW = displayWidth(truncate(changesTabLine({ tab: view.tab, counts: changesCounts(view) }), contentW))
    if (contentColumn < 0 || contentColumn >= visibleW) {
      redraw()
      return
    }
    const hit = changesTabHitColumns({ counts: changesCounts(view) }).find(
      ({ start, end }) => contentColumn >= start && contentColumn <= end,
    )
    if (hit) setChangesTab(hit.tab)
    else redraw()
    return
  }
  if (rel < CHANGES_BODY_START) {
    redraw()
    return
  }
  const contentColumn = sc - (left + DIALOG_SIDE_PAD_COLS)
  if (contentColumn < 0) return
  if (rel === CHANGES_BODY_START) {
    setChangesPane(contentColumn >= dg.leftW ? 'diff' : 'entries')
    return
  }
  // Entry rows follow the pane header (plus the border and branch-label rows
  // in side-by-side mode); the footer and frame rows below them are inert.
  const entryStart = dg.entryStart ?? 1
  if (rel < CHANGES_BODY_START + entryStart || rel >= CHANGES_BODY_START + entryStart + dg.entryH) {
    redraw()
    return
  }
  if (contentColumn >= dg.leftW) {
    setChangesPane('diff')
    return
  }
  const entries = changesEntries(view)
  if (!Array.isArray(entries) || entries.length === 0) return
  const entryIndex = dg.first + (rel - CHANGES_BODY_START - entryStart)
  if (entryIndex < 0 || entryIndex >= entries.length) return
  if (view.activePane !== 'entries') view.activePane = 'entries'
  if (entryIndex === (view.cursors[view.tab] ?? 0)) {
    redraw()
    return
  }
  view.cursors[view.tab] = entryIndex
  loadChangesDiff()
  redraw()
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

  if (state.mode === 'menu' || state.mode === 'confirm' || state.mode === 'create' || state.mode === 'changes') {
    const dg =
      state.mode === 'confirm' ? buildConfirm() : state.mode === 'create' ? buildCreate() : state.mode === 'changes' ? buildChanges() : buildDialog()
    // Fullscreen: the changes dialog covers every row, so there is no
    // outside to click.
    const top = state.mode === 'changes' ? 0 : dialogTop({ rows: rr, dialogH: dg.lines.length })
    const left = state.mode === 'changes' ? 0 : dialogColumns({ cols, dialogW }).padLeft
    const sr = y - 1
    const sc = x - 1
    if (sc < left || sr < top || sr >= top + dg.lines.length) {
      if (state.mode === 'menu') {
        closeMenu()
      } else if (state.mode === 'create') {
        cancelCreate()
      } else if (state.mode === 'changes') {
        closeChangesView()
      } else {
        state.mode = 'list'
        state.confirm = null
        redraw()
      }
      return
    }
    if (btn !== 0) return // right-click inside a dialog: no-op
    if (state.mode === 'changes') {
      handleChangesClick({ sr, sc, top, left, dg })
      return
    }
    if (state.mode === 'confirm') {
      // Like the menu, a single click decides: No cancels, Yes deletes.
      if (sr === top + CONFIRM_NO_ROW) resolveConfirm(false)
      else if (sr === top + CONFIRM_YES_ROW) resolveConfirm(true)
      else redraw()
      return
    }
    if (state.mode === 'create') {
      redraw()
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
      else if (state.mode === 'changes') scrollChanges(-(changesFullscreenGeometry(currentLayout()).listH - 2))
      return
    case 'pagedown':
      if (state.mode === 'run') scrollOutput(-currentFrameSplit().cmdH + 1)
      else if (state.mode === 'changes') scrollChanges(changesFullscreenGeometry(currentLayout()).listH - 2)
      return
    case 'delete':
      handleDeleteKey()
      return
    case 'escape':
      handleEscape()
      return
    case 'tab':
      if (state.mode === 'list') openMenu()
      else if (state.mode === 'changes') cycleChangesPane()
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
  if (state.mode === 'create') {
    if (key === 'a') state.create.caret = 0
    else if (key === 'e') state.create.caret = state.create.input.length
    else if (key === 'w') state.create.caret = deleteWordBack(state.create.input, state.create.caret)
    else {
      cancelCreate()
      return
    }
    redraw()
    return
  }
  if (state.mode === 'run' && state.pane?.running) {
    paneKillChild()
    state.pane.dirty = true
    draw()
    return
  }
  if (cmdPromptActive()) {
    if (key === 'w' && state.cmdCaret > 0) {
      state.cmdCaret = deleteWordBack(state.cmdInput, state.cmdCaret)
      redraw()
      return
    }
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
    } else if (value === 'n') {
      openCreate()
    } else if (value === 'd') {
      scanDeprecated()
    } else if (value === 's') {
      launchShell(state.rows[state.cursor])
    } else if (value === 'c') {
      startCommandInput()
    } else if (value === 'u') {
      openChangesView()
    } else if (value === 'w') {
      openWorktreesDir()
    } else if (value === 'x') {
      killFocusedProc()
    }
    return
  }
  if (state.mode === 'create') {
    if (value.codePointAt(0) >= 0x20) {
      state.create.input.splice(state.create.caret, 0, value)
      state.create.caret += value.length
      state.create.error = null
      redraw()
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
    return
  }
  if (state.mode === 'changes') {
    // The overlay owns `q` so leaving it never exits the whole manager.
    if (value === 'q' || value === 'Q') closeChangesView()
    else if (value === 'r') reloadChangesView()
    else if (value === 'v' || value === 'V') toggleChangesView()
    else if (value === '1') setChangesTab(0)
    else if (value === '2') setChangesTab(1)
    else if (value === '3') setChangesTab(2)
  }
}

function handleArrowUp() {
  if (state.mode === 'create') {
    return
  } else if (cmdPromptActive()) {
    historyUp()
  } else if (state.mode === 'changes') {
    // ↑ acts on the active pane: the next entry, or one diff line back.
    if (state.changes?.activePane === 'diff') scrollChanges(-1)
    else moveChangesCursor(-1)
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
  if (state.mode === 'create') {
    return
  } else if (cmdPromptActive()) {
    historyDown()
  } else if (state.mode === 'changes') {
    if (state.changes?.activePane === 'diff') scrollChanges(1)
    else moveChangesCursor(1)
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
  if (state.mode === 'create') {
    state.create.caret = Math.max(0, state.create.caret - 1)
    redraw()
  } else if (state.mode === 'menu') {
    state.menuTab = 0
    state.menuCursor = 0
    redraw()
  } else if (state.mode === 'confirm') {
    state.confirm.yes = 0
    redraw()
  } else if (state.mode === 'changes') {
    // ←/→ switch tabs (Tab switches the focused pane instead).
    setChangesTab(((state.changes?.tab ?? 0) + 2) % 3)
  } else if (cmdPromptActive()) {
    moveCmdCaret(-1)
  }
}

function handleArrowRight() {
  if (state.mode === 'create') {
    state.create.caret = Math.min(state.create.input.length, state.create.caret + 1)
    redraw()
  } else if (state.mode === 'menu') {
    state.menuTab = 1
    state.menuCursor = 0
    redraw()
  } else if (state.mode === 'confirm') {
    state.confirm.yes = 1
    redraw()
  } else if (state.mode === 'changes') {
    setChangesTab(((state.changes?.tab ?? 0) + 1) % 3)
  } else if (cmdPromptActive()) {
    moveCmdCaret(1)
  }
}

function handleHome() {
  if (state.mode === 'create') {
    state.create.caret = 0
    redraw()
  } else if (cmdPromptActive()) moveCmdCaret(-state.cmdCaret)
  else if (state.mode === 'changes') {
    if (state.changes?.activePane === 'diff') scrollChangesEdge('start')
    else jumpChangesCursor(0)
  } else if (state.mode === 'list') {
    state.cursor = 0
    redraw()
  }
}

function handleEnd() {
  if (state.mode === 'create') {
    state.create.caret = state.create.input.length
    redraw()
  } else if (cmdPromptActive()) moveCmdCaret(state.cmdInput.length - state.cmdCaret)
  else if (state.mode === 'changes') {
    if (state.changes?.activePane === 'diff') {
      scrollChangesEdge('end')
    } else {
      const view = state.changes
      const entries = changesEntries(view)
      jumpChangesCursor(Array.isArray(entries) ? entries.length - 1 : 0)
    }
  } else if (state.mode === 'list') {
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
  if (state.mode === 'create') {
    submitCreate()
  } else if (state.mode === 'menu') {
    activateMenuItem()
  } else if (state.mode === 'confirm') {
    resolveConfirm(state.confirm ? state.confirm.yes === 1 : false)
  } else if (state.mode === 'changes') {
    closeChangesView()
  } else if (cmdPromptActive()) {
    submitCommand()
  } else if (state.mode === 'list') {
    openMenu()
  }
}

function handleBackspace() {
  if (state.mode === 'create' && state.create.caret > 0) {
    state.create.input.splice(--state.create.caret, 1)
    state.create.error = null
    redraw()
  } else if (cmdPromptActive() && state.cmdCaret > 0) {
    state.cmdInput.splice(--state.cmdCaret, 1)
    redraw()
  }
}

function handleEscape() {
  if (state.mode === 'create') {
    cancelCreate()
  } else if (state.mode === 'changes') {
    closeChangesView()
  } else if (state.mode === 'run') {
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
  base: null,
  rows: [],
  cursor: 0,
  checked: new Set(),
  menuTab: 0,
  menuCursor: 0,
  mode: 'list',
  confirm: null,
  create: null,
  changes: null,
  worktreesDir: DEFAULT_WORKTREES_DIR,
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
  state.worktreesDir = resolveWorktreesDir(state.mainRoot)
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
