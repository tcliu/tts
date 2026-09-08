#!/usr/bin/env node
// worktree-manager — full-screen TUI for git worktree management.
//
// Styled after the root-level tts.mjs alternate-screen TUI: raw mode, box-drawn
// layout, diff-based line redraw, windowed cursor, centered dialog overlay, SGR
// mouse, and exact terminal restore on quit. The worktrees frame always uses
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
import { spawn } from "node:child_process";
import path from "node:path";
import { stdin, stdout } from "node:process";
import { StringDecoder } from "node:string_decoder";

import {
  deleteBranch,
  getLastCommitTime,
  getMainRoot,
  listWorktrees,
  readBranchFromGitDir,
  removeWorktree,
} from "./_worktrees.mjs";

import {
  c,
  createScreenRenderer,
  createTerminalManager,
  displayWidth,
  padRight,
  parseSgrMouse,
  truncate,
  wrapText,
} from "./_tui.mjs";

const PRESET_COMMANDS = [
  { label: "npm install", value: "npm install" },
  { label: "npm run dev", value: "npm run dev" },
  { label: "npm run check", value: "npm run check" },
  { label: "npm test", value: "npm test" },
  { label: "git status", value: "git status" },
  { label: "git log --oneline -15", value: "git log --oneline -15" },
  { label: "git branch --show-current", value: "git branch --show-current" },
];

const HELP_TEXT =
  "Arrows: move · Space: select · a: all · Tab: menu · c: cmd · s: shell · " +
  "Del: delete · x: stop bg · r: refresh · PgUp/PgDn: cmd output · " +
  "q: quit · Ctrl-C: stop cmd/quit";

const DEFAULT_STATUS =
  `${c.green}Ready.${c.reset} Tab: menu · Space: select · Del: delete · c: cmd · s: shell · r: refresh · q: quit.`;

const MODES = ["Actions", "Command"];

const OUTPUT_MAX_LINES = 2000;
const KILL_ESCALATE_MS = 2000;
const MAX_BACKGROUND = 8; // oldest finished proc evicted past this

// Row offsets shared by the renderers and the mouse hit test so the two can
// never drift apart.
const DIALOG_OPTION_START = 3; // border, tabs line, separator precede options
const CONFIRM_NO_ROW = 4; // border, message, detail, separator precede "No"
const CONFIRM_YES_ROW = 5;
const LIST_TOP_ROW = 3; // header, subheader, box top border precede rows

// ---- screen (diff-based redraw owned by shared _tui.mjs) ----

const screen = createScreenRenderer();
const term = createTerminalManager();

function writeLines(lines) {
  screen.render(lines, { fullClear: state.fullClear });
  state.fullClear = false;
}
// ---- domain ----
function refreshList() {
  const root = state.mainRoot;
  const { entries } = listWorktrees(root);
  const rows = [
    {
      path: root,
      name: "(main)",
      branch: readBranchFromGitDir(root) ?? "HEAD",
      registered: true,
      main: true,
      aheadBehind: null,
      commitTime: getLastCommitTime(root),
    },
  ];
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
    });
  }
  state.rows = rows;
  // Re-key background procs to fresh rows; kill procs whose worktree vanished.
  const byPath = new Map(rows.map((r) => [r.path, r]));
  for (const [key, proc] of state.procs) {
    const row = byPath.get(key);
    if (!row) {
      paneKillChild(proc);
      clearTimeout(proc.escalate);
      state.procs.delete(key);
    } else {
      proc.row = row;
    }
  }
  // Keep surviving selections across refreshes; only vanished paths drop.
  state.checked = new Set([...state.checked].filter((p) => byPath.has(p)));
  if (state.cursor >= state.rows.length) {
    state.cursor = Math.max(0, state.rows.length - 1);
  }
}

// ---- layout ----

function layout() {
  const rows = Math.max(20, stdout.rows || 24);
  const cols = Math.max(60, stdout.columns || 80);
  const helpLines = wrapText(HELP_TEXT, cols).slice(0, 3);
  // header + subheader + box + status + blank + help
  const boxH = Math.max(3, rows - 4 - helpLines.length);
  const boxW = cols; // the frame always uses the entire console width
  return { rows, cols, boxH, helpLines, boxW };
}

// When a command pane is open the frame splits: list on top, divider, then the
// command output pane. Returns the row budget for each part.
function frameSplit() {
  const { boxH } = layout();
  if (state.mode !== "run" || !state.pane) return { listH: boxH, cmdH: 0 };
  const cmdH = Math.max(5, Math.min(Math.floor(boxH / 3), boxH - 9));
  return { listH: boxH - cmdH - 1, cmdH };
}

function listWindow() {
  const { listH } = frameSplit();
  const count = state.rows.length;
  if (count === 0) return { first: 0, last: -1, boxH: 0 };
  let first = Math.max(0, state.cursor - Math.floor(listH / 2));
  first = Math.min(first, Math.max(0, count - listH));
  const last = Math.min(count - 1, first + listH - 1);
  return { first, last, boxH: listH };
}

function formatRelativeTime(epochSec) {
  if (epochSec == null) return "";
  const s = Math.max(0, Date.now() / 1000 - epochSec);
  if (s < 60) return `${Math.floor(s)}s ago`;
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.floor(d)}d ago`;
  const w = d / 7;
  if (w < 5) return `${Math.floor(w)}w ago`;
  const mo = d / 30;
  if (mo < 12) return `${Math.floor(mo)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function renderListRows() {
  const { boxW } = layout();
  const contentW = boxW - 4;
  const { first, last, boxH } = listWindow();
  const lines = [];
  for (let i = first; i <= last; i++) {
    const r = state.rows[i];
    const cursor = i === state.cursor;
    const marker = cursor ? `${c.cyan}▸${c.reset}` : " ";
    const checked = state.checked.has(r.path);
    const box = checked ? `${c.green}[x]${c.reset}` : "[ ]";
    const branch = r.branch
      ? `${c.gray}(${r.branch})${c.reset}`
      : `${c.gray}(detached)${c.reset}`;
    const unregistered =
      r.registered === false ? ` ${c.yellow}[unregistered]${c.reset}` : "";
    const mainTag = r.main ? ` ${c.yellow}[main]${c.reset}` : "";
    const ab = r.aheadBehind;
    const parts = [];
    const proc = state.procs.get(r.path);
    if (proc?.running) parts.push(`${c.green}▶ ${proc.cmd || "running"}${c.reset}`);
    else if (proc?.cmd && !proc.running && proc.exit !== 0)
      parts.push(`${c.dim}exit ${proc.exit ?? "signal"}${c.reset}`);
    if (ab?.ahead > 0) parts.push(`${c.green}+${ab.ahead}${c.reset}`);
    if (ab?.behind > 0) parts.push(`${c.yellow}-${ab.behind}${c.reset}`);
    const age = formatRelativeTime(r.commitTime);
    if (age) {
      const fresh = Date.now() / 1000 - r.commitTime < 3600;
      parts.push(`${fresh ? c.cyan : c.dim}${age}${c.reset}`);
    }
    const meta = parts.length ? ` ${c.dim}·${c.reset} ${parts.join(" ")}` : "";
    let cells = `${marker} ${box} ${r.name} ${branch}${unregistered}${mainTag}${meta}`;
    if (!cursor) cells = c.dim + cells + c.reset;
    // Last two content columns are reserved for the scroll edge marker.
    let row = padRight(truncate(cells, contentW - 2), contentW - 2);
    if (i === first && first > 0) row += ` ${c.dim}▲${c.reset}`;
    else if (i === last && last < state.rows.length - 1) row += ` ${c.dim}▼${c.reset}`;
    else row += "  ";
    lines.push(row);
  }
  while (lines.length < boxH) lines.push("");
  return { lines };
}

function dialogGeometry() {
  const { cols, rows } = layout();
  const dialogW = Math.min(cols - 2, 96);
  const listH = Math.max(3, Math.min(10, rows - 8));
  return { dialogW, listH, rows, cols };
}

function currentOptions() {
  if (state.menuTab === 0) {
    return [
      "Run command…",
      "Interactive shell",
      `Delete checked (${state.checked.size})`,
      "Delete focused",
      "Stop background process",
      "Select all",
      "Clear selection",
      "Refresh",
      "Quit",
    ];
  }
  return [...PRESET_COMMANDS.map((p) => p.label), "Custom command…"];
}

function tabLine() {
  const parts = MODES.map((t, i) =>
    i === state.menuTab
      ? `${c.cyan}${c.bold}${c.reverse}${t}${c.reset}`
      : `${c.gray}${t}${c.reset}`,
  );
  return `Tabs:  ${parts.join("  ")}`;
}

function buildDialog() {
  const { dialogW, listH } = dialogGeometry();
  const inner = dialogW - 2;
  const content = inner - 2;
  const border = (s) => `${c.cyan}${s}${c.reset}`;
  const side = (t) => `${c.cyan}│${c.reset} ${t}${c.cyan} │${c.reset}`;
  const out = [
    border(`┌ MENU ${"─".repeat(Math.max(1, inner - 6))}┐`),
    side(padRight(truncate(tabLine(), content), content)),
    side("─".repeat(content)),
  ];
  const opts = currentOptions();
  const sel = state.menuCursor;
  let start = 0;
  if (opts.length > listH) {
    start = Math.max(0, Math.min(sel - Math.floor(listH / 2), opts.length - listH));
  }
  for (let i = 0; i < listH; i++) {
    const idx = start + i;
    let line;
    if (idx < opts.length) {
      const isSel = idx === sel;
      const marker = isSel ? `${c.cyan}▸${c.reset} ` : "  ";
      line = `${marker}${isSel ? c.reverse : ""}${opts[idx]}${c.reset}`;
      if (i === 0 && start > 0) line += ` ${c.dim}▲${c.reset}`;
      if (i === listH - 1 && start + listH < opts.length) line += ` ${c.dim}▼${c.reset}`;
    } else {
      line = "";
    }
    out.push(side(padRight(truncate(line, content), content)));
  }
  out.push(border(`└${"─".repeat(inner)}┘`));
  return { lines: out, start, total: opts.length };
}

function buildConfirm() {
  const { dialogW, listH } = dialogGeometry();
  const inner = dialogW - 2;
  const content = inner - 2;
  const border = (s) => `${c.red}${s}${c.reset}`;
  const side = (t) => `${c.red}│${c.reset} ${t}${c.red} │${c.reset}`;
  const out = [
    border(`┌ DELETE ${"─".repeat(Math.max(1, inner - 8))}┐`),
    side(padRight(truncate(state.confirm.message, content), content)),
    side(padRight(truncate(state.confirm.detail, content), content)),
    side("─".repeat(content)),
  ];
  const opts = ["No", "Yes"];
  for (let i = 0; i < Math.min(listH, opts.length); i++) {
    const isSel = i === state.confirm.yes;
    const marker = `${c.cyan}${isSel ? "▸" : " "}${c.reset}`;
    let row = `${marker} ${c.bold}${opts[i]}${c.reset}`;
    if (isSel) row = `${c.bold}${c.reverse}${row}${c.reset}`;
    out.push(side(padRight(truncate(row, content), content)));
  }
  out.push(border(`└${"─".repeat(inner)}┘`));
  return { lines: out };
}

// ---- command pane ----

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[@-Z\\-_]/g;

function procPushOutput(proc, chunk, decoder) {
  proc.pending += decoder.write(chunk);
  const parts = proc.pending.split(/[\r\n]/);
  proc.pending = parts.pop() ?? "";
  for (const raw of parts) {
    proc.lines.push(raw.replace(ANSI_RE, ""));
  }
  if (proc.lines.length > OUTPUT_MAX_LINES) {
    proc.lines.splice(0, proc.lines.length - OUTPUT_MAX_LINES);
  }
  proc.dirty = true;
}

// One shared flush tick for every background proc; draws once if any arrived.
function flushProcs() {
  if (state.suspended) return; // shell owns the terminal; dirty flags replay on resume via fullClear
  let dirty = false;
  for (const proc of state.procs.values()) {
    if (proc.dirty) {
      proc.dirty = false;
      dirty = true;
    }
  }
  if (dirty) draw();
}

function paneKillChild(pane = state.pane) {
  if (!pane || !pane.running) return;
  try {
    process.kill(-pane.child.pid, "SIGTERM");
  } catch {}
  pane.escalate = setTimeout(() => {
    if (pane.running) {
      try {
        process.kill(-pane.child.pid, "SIGKILL");
      } catch {}
    }
  }, KILL_ESCALATE_MS);
}

// Detach the pane, leaving its process running in the background. Reattach
// by focusing the row and pressing c.
function paneDetach() {
  if (!state.pane) return;
  state.pane = null;
  state.mode = "list";
  state.fullClear = true;
  redraw();
}

// Drop the attached pane's proc entirely. A running proc detaches instead.
function dropPane() {
  const pane = state.pane;
  if (!pane) return;
  if (pane.running) {
    paneDetach();
    return;
  }
  clearTimeout(pane.escalate);
  state.procs.delete(pane.row.path);
  state.pane = null;
  state.mode = "list";
  state.fullClear = true;
  redraw();
}

function killFocusedProc() {
  const r = state.rows[state.cursor];
  const proc = r && state.procs.get(r.path);
  if (!proc || !proc.cmd) {
    state.status = `${c.yellow}No background process on this row.${c.reset}`;
    redraw();
    return;
  }
  if (proc.running) {
    paneKillChild(proc);
    state.status = `${c.yellow}Stopping ${proc.cmd} in ${r.name}…${c.reset}`;
  } else {
    clearTimeout(proc.escalate);
    state.procs.delete(r.path);
    if (state.pane === proc) {
      state.pane = null;
      state.mode = "list";
      state.fullClear = true;
    }
    state.status = DEFAULT_STATUS;
  }
  redraw();
}

function cmdPromptActive() {
  return state.mode === "run" && !!state.pane && !state.pane.running;
}

function paneStatusText() {
  const pane = state.pane;
  if (pane.running) {
    return `${c.yellow}Running in ${c.gray}${pane.row.name}${c.reset}${c.yellow} · Ctrl-C stops · PgUp/PgDn scroll${c.reset}`;
  }
  const exitTag =
    pane.cmd === ""
      ? ""
      : pane.exit === 0
        ? `${c.green}exit 0${c.reset} · `
        : `${c.red}exit ${pane.exit ?? "signal"}${c.reset} · `;
  return (
    `${exitTag}${c.gray}${pane.row.name}${c.reset}` +
    `${c.dim} · Enter runs · ↑ history · Ctrl-C kills · Esc detaches${c.reset}`
  );
}

function openPane(row) {
  let proc = state.procs.get(row.path);
  if (!proc) {
    // Evict the oldest finished proc past the background cap; running procs
    // are never evicted. A map full of running procs refuses with a hint.
    if (state.procs.size >= MAX_BACKGROUND) {
      let evicted = false;
      for (const [key, p] of state.procs) {
        if (!p.running) {
          state.procs.delete(key);
          evicted = true;
          break;
        }
      }
      if (!evicted) {
        state.status = `${c.yellow}Background slots full; stop a process first (x).${c.reset}`;
        redraw();
        return;
      }
    }
    proc = {
      row,
      cmd: "",
      child: null,
      lines: [],
      pending: "",
      scroll: 0,
      running: false,
      exit: null,
      dirty: true,
      escalate: null,
    };
    state.procs.set(row.path, proc);
  }
  state.mode = "run";
  state.pane = proc;
  state.cmdInput = [];
  state.cmdCaret = 0;
  state.cmdHistIndex = -1;
  redraw();
}

function runInWorktree(cmd, row) {
  if (!row) {
    state.status = `${c.red}No worktree selected.${c.reset}`;
    redraw();
    return;
  }
  if (state.pane?.row.path !== row.path) openPane(row);
  const pane = state.pane;
  if (pane.running) return;
  if (pane.lines.length) pane.lines.push("");
  pane.lines.push(`$ ${cmd}`);
  if (pane.lines.length > OUTPUT_MAX_LINES) {
    pane.lines.splice(0, pane.lines.length - OUTPUT_MAX_LINES);
  }
  pane.pending = "";
  pane.scroll = 0;
  pane.exit = null;
  pane.cmd = cmd;
  const decoder = new StringDecoder("utf8");
  const child = spawn(cmd, {
    shell: true,
    cwd: pane.row.path,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // own process group so Ctrl-C can kill the whole tree
  });
  pane.child = child;
  pane.running = true;
  pane.dirty = true;
  child.stdout.on("data", (chunk) => procPushOutput(pane, chunk, decoder));
  child.stderr.on("data", (chunk) => procPushOutput(pane, chunk, decoder));
  child.on("error", (err) => {
    if (state.pane?.child === child) {
      state.pane.lines.push(`${err.message}`);
      state.pane.dirty = true;
    }
  });
  child.on("close", (code) => {
    const p = state.pane;
    if (!p || p.child !== child) return;
    p.running = false;
    p.exit = code;
    if (p.escalate) {
      clearTimeout(p.escalate);
      p.escalate = null;
    }
    p.dirty = true;
    draw();
  });
  redraw();
}

// ---- draw ----

function draw() {
  const { rows, cols, boxW, helpLines } = layout();
  const { lines: listLines } = renderListRows();
  const { listH, cmdH } = frameSplit();
  const border = (s) => `${c.cyan}${s}${c.reset}`;
  const side = (t) => `${c.cyan}│${c.reset} ${t}${c.cyan} │${c.reset}`;

  const header =
    `${c.bold}WORKTREE${c.reset} ${c.dim}· ${state.mainRoot.split("/").pop()}` +
    ` · ${state.rows.length} worktree(s)${c.reset}`;
  const focused = state.rows[state.cursor];
  const subheader =
    `${c.dim}Focused:${c.reset} ${c.dim}${focused ? focused.path : ""}${c.reset}` +
    `  ${c.gray}checked: ${state.checked.size} · Ln ${state.cursor + 1}/${state.rows.length}${c.reset}`;

  const lines = [header, subheader];
  lines.push(border(`┌ WORKTREES ${"─".repeat(Math.max(1, boxW - 13))}┐`));
  for (let i = 0; i < listH; i++) {
    lines.push(side(padRight(listLines[i] ?? "", boxW - 4)));
  }
  if (cmdH > 0) {
    const pane = state.pane;
    const dividerColor = pane.running ? c.cyan : c.gray;
    const title = pane.cmd ? `─ COMMAND · ${pane.cmd} ` : "─ COMMAND ";
    const fill = Math.max(1, boxW - 2 - displayWidth(title));
    lines.push(
      `${dividerColor}├${title}${"─".repeat(fill)}┤${c.reset}`,
    );
    const prompt = cmdPromptActive();
    const outH = prompt ? cmdH - 1 : cmdH; // last pane row hosts the prompt
    const total = pane.lines.length;
    pane.scroll = Math.max(0, Math.min(pane.scroll, total));
    const end = total - pane.scroll;
    const start = Math.max(0, end - outH);
    for (let i = 0; i < outH; i++) {
      const idx = start + i;
      const out = idx >= 0 && idx < total ? pane.lines[idx] : "";
      lines.push(side(padRight(truncate(out, boxW - 4), boxW - 4)));
    }
    if (prompt) {
      const before = state.cmdInput.slice(0, state.cmdCaret).join("");
      const after = state.cmdInput.slice(state.cmdCaret).join("");
      const line =
        `${c.gray}${pane.row.name}${c.reset}${c.cyan}$ ${c.reset}` +
        `${before}${c.reverse} ${c.reset}${after}`;
      lines.push(side(padRight(truncate(line, boxW - 4), boxW - 4)));
    }
  }
  lines.push(border(`└${"─".repeat(boxW - 2)}┘`));

  let status;
  if (state.mode === "run" && state.pane) {
    status = truncate(paneStatusText(), cols);
  } else {
    status = truncate(state.status, cols);
  }
  lines.push(status);
  lines.push("");
  for (const hl of helpLines) lines.push(`${c.dim}${hl}${c.reset}`);
  while (lines.length < rows) lines.push("");
  if (lines.length > rows) lines.length = rows;

  if (state.mode === "menu" || state.mode === "confirm") {
    const { dialogW: dw } = dialogGeometry();
    const dg = state.mode === "confirm" ? buildConfirm() : buildDialog();
    const dH = dg.lines.length;
    const top = Math.max(0, Math.floor((rows - dH) / 2));
    const pad = " ".repeat(Math.max(0, Math.floor((cols - dw) / 2)));
    for (let k = 0; k < dH; k++) {
      const r = top + k;
      if (r < rows) lines[r] = pad + dg.lines[k];
    }
  }

  writeLines(lines);
}

function redraw() {
  draw();
}

// ---- modal navigation ----

function moveCursor(delta) {
  if (state.rows.length === 0) return;
  state.cursor = (state.cursor + delta + state.rows.length) % state.rows.length;
  redraw();
}

function toggleCheckbox() {
  const r = state.rows[state.cursor];
  if (r && !r.main) {
    if (state.checked.has(r.path)) state.checked.delete(r.path);
    else state.checked.add(r.path);
  }
  redraw();
}

function selectAll() {
  state.checked = new Set(state.rows.filter((r) => !r.main).map((r) => r.path));
  redraw();
}

function clearSelection() {
  state.checked = new Set();
  redraw();
}

function openMenu(tab = 0) {
  state.mode = "menu";
  state.menuTab = tab;
  state.menuCursor = 0;
  redraw();
}

function closeMenu() {
  state.mode = "list";
  redraw();
}

function startCommandInput() {
  const row = state.rows[state.cursor];
  if (row) openPane(row);
}

function moveCmdCaret(delta) {
  state.cmdCaret = Math.max(0, Math.min(state.cmdInput.length, state.cmdCaret + delta));
  redraw();
}

function historyUp() {
  const h = state.cmdHistory;
  if (!h.length) return;
  const idx =
    state.cmdHistIndex === -1
      ? h.length - 1
      : Math.max(0, state.cmdHistIndex - 1);
  state.cmdHistIndex = idx;
  const val = h[idx];
  state.cmdInput = [...val];
  state.cmdCaret = val.length;
  redraw();
}

function historyDown() {
  const h = state.cmdHistory;
  if (!h.length) return;
  if (state.cmdHistIndex === -1) {
    state.cmdInput = [];
    state.cmdCaret = 0;
    redraw();
    return;
  }
  const idx = Math.min(h.length - 1, state.cmdHistIndex + 1);
  state.cmdHistIndex = idx;
  const val = h[idx];
  state.cmdInput = [...val];
  state.cmdCaret = val.length;
  redraw();
}

function startConfirm({ rows, message, detail }) {
  state.mode = "confirm";
  state.confirm = { rows, message, detail, yes: 0 };
  redraw();
}

function executeBatchDelete(rows) {
  const targets = new Set(rows.map((r) => r.path));
  let ok = 0;
  let failed = 0;
  const failedNames = [];
  for (const wt of state.rows) {
    if (!targets.has(wt.path) || wt.main) continue;
    if (removeWorktree(state.mainRoot, wt)) {
      // Skip branch cleanup for unregistered dirs: their branch name comes
      // from a foreign .git and may collide with a real main-repo branch.
      if (wt.registered !== false && wt.branch) {
        deleteBranch(state.mainRoot, wt.branch);
      }
      ok++;
    } else {
      failed++;
      failedNames.push(wt.name);
    }
  }
  refreshList();
  let status = `${c.green}Deleted ${ok} worktree(s)${c.reset}`;
  if (failed) status += `${c.red} · ${failed} failed: ${failedNames.join(", ")}${c.reset}`;
  state.status = status;
}

function activateMenuItem() {
  const idx = state.menuCursor;
  if (state.menuTab === 0) {
    switch (idx) {
      case 0:
        startCommandInput();
        return;
      case 1:
        closeMenu();
        launchShell(state.rows[state.cursor]);
        return;
      case 2: {
        if (state.checked.size === 0) {
          state.status = `${c.yellow}No worktrees selected.${c.reset}`;
          redraw();
          return;
        }
        confirmDeleteFlow(state.rows.filter((r) => state.checked.has(r.path) && !r.main));
        return;
      }
      case 3: {
        const r = state.rows[state.cursor];
        if (!r || r.main) {
          state.status = `${c.yellow}Cannot delete the main root.${c.reset}`;
          redraw();
          return;
        }
        confirmDeleteFlow([r]);
        return;
      }
      case 4:
        killFocusedProc();
        closeMenu();
        return;
      case 5:
        selectAll();
        closeMenu();
        return;
      case 6:
        clearSelection();
        closeMenu();
        return;
      case 7:
        refreshList();
        closeMenu();
        return;
      case 8:
        quit();
        return;
      default:
        closeMenu();
        return;
    }
  }
  if (idx < PRESET_COMMANDS.length) {
    closeMenu();
    runInWorktree(PRESET_COMMANDS[idx].value, state.rows[state.cursor]);
  } else if (idx === PRESET_COMMANDS.length) {
    startCommandInput();
  } else {
    closeMenu();
  }
}

function confirmDeleteFlow(targets) {
  startConfirm({
    rows: targets,
    message: `Delete ${targets.length} worktree(s)?`,
    detail: "force removes files, branches will be deleted",
  });
}

// ---- command execution ----

async function submitCommand() {
  const cmd = state.cmdInput.join("");
  state.cmdInput = [];
  state.cmdCaret = 0;
  state.cmdHistIndex = -1;
  if (!cmd) {
    redraw();
    return;
  }
  if (!state.cmdHistory.includes(cmd)) state.cmdHistory.push(cmd);
  if (state.cmdHistory.length > 50) state.cmdHistory.shift();
  runInWorktree(cmd, state.pane ? state.pane.row : state.rows[state.cursor]);
}

function launchShell(row) {
  if (!row) {
    state.status = `${c.red}No worktree selected.${c.reset}`;
    redraw();
    return;
  }
  const shell = process.env.SHELL || "/bin/bash";
  return suspendForCommand({
    run: () =>
      new Promise((resolve) => {
        const child = spawn(shell, { cwd: row.path, stdio: "inherit" });
        child.on("close", resolve);
      }),
    row,
    label: shell,
  });
}

async function suspendForCommand({ run, row, label }) {
  state.status = `${c.yellow}Running: ${label}${c.reset}`;
  draw();
  state.suspended = true;
  process.stdout.write("\x1b[?1049l\x1b[?25h\x1b[?1002l\x1b[?1006l");
  stdin.setRawMode(false);
  stdin.pause();
  const code = await run();
  state.suspended = false;
  stdin.setRawMode(true);
  stdin.resume();
  process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[?1002h\x1b[?1006h");
  state.fullClear = true;
  state.status =
    `${c.green}exit ${code ?? "sig"}${c.reset} · ${c.gray}${label}${c.reset} in ${c.gray}${row.name}${c.reset}`;
  refreshList();
  redraw();
}

// ---- input ----

function handleMouse({ button, x, y, release }) {
  if (release || button !== 0) return;
  const { cols, rows: rr } = layout();
  const { dialogW, listH } = dialogGeometry();

  if (state.mode === "menu" || state.mode === "confirm") {
    const dg = state.mode === "confirm" ? buildConfirm() : buildDialog();
    const top = Math.max(0, Math.floor((rr - dg.lines.length) / 2));
    const left = Math.max(0, Math.floor((cols - dialogW) / 2));
    const sr = y - 1;
    const sc = x - 1;
    if (sc < left || sr < top || sr >= top + dg.lines.length) {
      if (state.mode === "menu") {
        closeMenu();
      } else {
        state.mode = "list";
        state.confirm = null;
        redraw();
      }
      return;
    }
    if (state.mode === "confirm") {
      if (sr === top + CONFIRM_NO_ROW) {
        state.confirm.yes = 0;
      } else if (sr === top + CONFIRM_YES_ROW) {
        state.confirm.yes = 1;
      }
      redraw();
      return;
    }
    if (sr - top === 1) {
      const prefix = "Tabs:  ";
      let cx = left + prefix.length;
      for (let t = 0; t < MODES.length; t++) {
        if (sc >= cx && sc < cx + MODES[t].length) {
          state.menuTab = t;
          state.menuCursor = 0;
          redraw();
          return;
        }
        cx += MODES[t].length + 2;
      }
    }
    const rel = sr - top - DIALOG_OPTION_START;
    const idx = dg.start + rel;
    if (rel >= 0 && rel < listH && idx >= 0 && idx < dg.total) {
      state.menuCursor = idx;
      activateMenuItem();
    }
    return;
  }
  // list hit test
  const { first, boxH } = listWindow();
  const sr = y - 1;
  if (sr < LIST_TOP_ROW || sr >= LIST_TOP_ROW + boxH) return;
  const idx = first + (sr - LIST_TOP_ROW);
  if (idx >= 0 && idx < state.rows.length) {
    state.cursor = idx;
    redraw();
  }
}

function quit() {
  for (const proc of state.procs.values()) {
    paneKillChild(proc);
    clearTimeout(proc.escalate);
  }
  state.procs.clear();
  clearInterval(flushTimer);
  term.exit();
  console.log(`\nBye. ${state.rows.length} worktree(s) on disk.`);
  process.exit(0);
}

let pending = "";
let flushTimer = null;

function scrollOutput(delta) {
  const pane = state.pane;
  if (!pane) return;
  pane.scroll = Math.max(0, pane.scroll + delta);
  redraw();
}

function onData(chunk) {
  const s = pending + chunk;
  pending = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];

    if (ch === "\x03" || ch === "\x04" || ch === "\x11") {
      // While a command pane is running, Ctrl-C stops the command instead of
      // quitting the TUI.
      if (state.mode === "run" && state.pane?.running) {
        paneKillChild();
        state.pane.dirty = true;
        draw();
      } else if (cmdPromptActive()) {
        // Bash-like Ctrl-C: with text on the line it clears the input; on an
        // empty line it quits. Ctrl-D on an empty line drops the finished proc (detaches if running).
        if (state.cmdInput.length || state.cmdCaret) {
          state.cmdInput = [];
          state.cmdCaret = 0;
          state.cmdHistIndex = -1;
          redraw();
        } else if (ch === "\x04") {
          dropPane();
        } else {
          quit();
        }
      } else {
        quit();
      }
      return;
    }

    if (ch === "\x1b") {
      if (s[i + 1] === "[" && s[i + 2] === "<") {
        const m = parseSgrMouse(s, i);
        if (!m) {
          pending = s.slice(i);
          break;
        }
        handleMouse(m);
        i += m.len;
        continue;
      }
      if (s.length - i < 2) {
        handleEscape();
        i += 1;
        continue;
      }
      const nxt = s[i + 1];
      if (nxt !== "[") {
        handleEscape();
        i += 2;
        continue;
      }
      if (s.length - i >= 6 && s.slice(i, i + 4) === "\x1b[1;") {
        handleShiftArrow(s[i + 5]);
        i += 6;
        continue;
      }
      if (s.length - i < 3) {
        pending = s.slice(i);
        break;
      }
      const seq3 = s.slice(i, i + 3);
      if (seq3 === "\x1b[A") {
        handleArrowUp();
        i += 3;
        continue;
      }
      if (seq3 === "\x1b[B") {
        handleArrowDown();
        i += 3;
        continue;
      }
      if (seq3 === "\x1b[C") {
        handleArrowRight();
        i += 3;
        continue;
      }
      if (seq3 === "\x1b[D") {
        handleArrowLeft();
        i += 3;
        continue;
      }
      if (seq3 === "\x1b[H" || seq3 === "\x1bOH") {
        handleHome();
        i += 3;
        continue;
      }
      if (seq3 === "\x1b[F" || seq3 === "\x1bOF") {
        handleEnd();
        i += 3;
        continue;
      }
      const seq4 = s.slice(i, i + 4);
      if (seq4 === "\x1b[1~") {
        handleHome();
        i += 4;
        continue;
      }
      if (seq4 === "\x1b[4~") {
        handleEnd();
        i += 4;
        continue;
      }
      if (seq4 === "\x1b[5~") {
        if (state.mode === "run") scrollOutput(-frameSplit().cmdH + 1);
        i += 4;
        continue;
      }
      if (seq4 === "\x1b[6~") {
        if (state.mode === "run") scrollOutput(frameSplit().cmdH - 1);
        i += 4;
        continue;
      }
      if (seq4 === "\x1b[3~") {
        if (state.mode === "list") {
          if (state.checked.size > 1) {
            confirmDeleteFlow(
              state.rows.filter((rr) => state.checked.has(rr.path) && !rr.main),
            );
          } else {
            const r = state.rows[state.cursor];
            if (!r || r.main) {
              state.status = `${c.yellow}Cannot delete the main root.${c.reset}`;
              redraw();
            } else {
              confirmDeleteFlow([r]);
            }
          }
        }
        i += 4;
        continue;
      }
      handleEscape();
      i += 1;
      continue;
    }

    if (ch === "\t") {
      if (state.mode === "list") {
        openMenu();
      }
      i += 1;
      continue;
    }

    if (ch === "\r" || ch === "\n") {
      handleEnter();
      i += 1;
      continue;
    }

    if (ch === "\x7f" || ch === "\x08") {
      handleBackspace();
      i += 1;
      continue;
    }

    if (ch === "\x01") {
      if (cmdPromptActive()) moveCmdCaret(-state.cmdCaret);
      else handleHome();
      i += 1;
      continue;
    }
    if (ch === "\x05") {
      if (cmdPromptActive()) moveCmdCaret(state.cmdInput.length - state.cmdCaret);
      else handleEnd();
      i += 1;
      continue;
    }
    if (ch === "\x10") {
      if (cmdPromptActive()) historyUp();
      else handleArrowUp();
      i += 1;
      continue;
    }
    if (ch === "\x0e") {
      if (cmdPromptActive()) historyDown();
      else handleArrowDown();
      i += 1;
      continue;
    }

    // mode-gated printable keys
    if (state.mode === "list") {
      if (ch === "q") {
        quit();
        return;
      } else if (ch === " ") {
        toggleCheckbox();
      } else if (ch === "a") {
        if (state.checked.size === 0) selectAll();
        else clearSelection();
      } else if (ch === "r") {
        refreshList();
        redraw();
      } else if (ch === "s") {
        launchShell(state.rows[state.cursor]);
      } else if (ch === "c") {
        startCommandInput();
      } else if (ch === "x") {
        killFocusedProc();
      }
      i += 1;
      continue;
    }

    if (cmdPromptActive()) {
      const cp = String.fromCodePoint(s.codePointAt(i));
      // Ignore control characters that reached this point (e.g. Ctrl-L) so
      // they never end up inside the executed command string.
      if (cp.codePointAt(0) >= 0x20) {
        state.cmdInput.splice(state.cmdCaret, 0, cp);
        state.cmdCaret += cp.length;
        redraw();
      }
      i += cp.length;
      continue;
    }

    // run / menu / confirm: ignore stray printable
    i += 1;
  }
}

function handleArrowUp() {
  if (cmdPromptActive()) {
    historyUp();
  } else if (state.mode === "menu") {
    state.menuCursor = Math.max(0, state.menuCursor - 1);
    redraw();
  } else if (state.mode === "confirm") {
    state.confirm.yes = 0;
    redraw();
  } else {
    moveCursor(-1);
  }
}

function handleArrowDown() {
  if (cmdPromptActive()) {
    historyDown();
  } else if (state.mode === "menu") {
    state.menuCursor = Math.min(currentOptions().length - 1, state.menuCursor + 1);
    redraw();
  } else if (state.mode === "confirm") {
    state.confirm.yes = 1;
    redraw();
  } else {
    moveCursor(1);
  }
}

function handleArrowLeft() {
  if (state.mode === "menu") {
    state.menuTab = 0;
    state.menuCursor = 0;
    redraw();
  } else if (state.mode === "confirm") {
    state.confirm.yes = 0;
    redraw();
  } else if (cmdPromptActive()) {
    moveCmdCaret(-1);
  }
}

function handleArrowRight() {
  if (state.mode === "menu") {
    state.menuTab = 1;
    state.menuCursor = 0;
    redraw();
  } else if (state.mode === "confirm") {
    state.confirm.yes = 1;
    redraw();
  } else if (cmdPromptActive()) {
    moveCmdCaret(1);
  }
}

function handleHome() {
  if (cmdPromptActive()) moveCmdCaret(-state.cmdCaret);
  else if (state.mode === "list") {
    state.cursor = 0;
    redraw();
  }
}

function handleEnd() {
  if (cmdPromptActive()) moveCmdCaret(state.cmdInput.length - state.cmdCaret);
  else if (state.mode === "list") {
    state.cursor = Math.max(0, state.rows.length - 1);
    redraw();
  }
}

function handleShiftArrow(dir) {
  if (state.mode === "menu") {
    if (dir === "C") {
      state.menuTab = 1;
      state.menuCursor = 0;
    } else if (dir === "D") {
      state.menuTab = 0;
      state.menuCursor = 0;
    } else if (dir === "A") handleArrowUp();
    else if (dir === "B") handleArrowDown();
    redraw();
  } else if (cmdPromptActive()) {
    if (dir === "C") moveCmdCaret(1);
    else if (dir === "D") moveCmdCaret(-1);
  } else if (state.mode === "confirm") {
    state.confirm.yes = dir === "C" ? 1 : 0;
    redraw();
  }
}

function handleEnter() {
  if (state.mode === "menu") {
    activateMenuItem();
  } else if (state.mode === "confirm") {
    if (state.confirm.yes === 1) executeBatchDelete(state.confirm.rows);
    state.mode = "list";
    state.confirm = null;
    redraw();
  } else if (cmdPromptActive()) {
    submitCommand();
  } else if (state.mode === "list") {
    openMenu();
  }
}

function handleBackspace() {
  if (cmdPromptActive() && state.cmdCaret > 0) {
    state.cmdInput.splice(--state.cmdCaret, 1);
    redraw();
  }
}

function handleEscape() {
  if (state.mode === "run") {
    // Esc detaches: the child keeps running in the background. Ctrl-C kills.
    state.status = `${c.dim}Detached; command keeps running. Focus row + c to reattach.${c.reset}`;
    paneDetach();
  } else if (state.mode === "confirm") {
    state.mode = "list";
    state.confirm = null;
    state.status = DEFAULT_STATUS;
    redraw();
  } else if (state.mode === "menu") {
    state.status = DEFAULT_STATUS;
    closeMenu();
  } else if (state.mode === "list") {
    // Esc clears any transient result message back to the default hint line.
    state.status = DEFAULT_STATUS;
    redraw();
  }
}

// ---- state ----

const state = {
  mainRoot: "",
  rows: [],
  cursor: 0,
  checked: new Set(),
  menuTab: 0,
  menuCursor: 0,
  mode: "list",
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
};

async function main() {
  if (process.argv[2] === "--help" || process.argv[2] === "-h") {
    console.log("Usage: worktree-manager [dir]\n\nManage git worktrees rooted at the repository containing [dir] (default: current directory).");
    return;
  }
  if (!stdin.isTTY || !stdout.isTTY) {
    console.error("worktree-manager requires an interactive terminal.");
    process.exitCode = 1;
    return;
  }
  const startDir = path.resolve(process.argv[2] ?? ".");
  state.mainRoot = getMainRoot(startDir);
  refreshList();
  term.onResize(() => {
    if (state.suspended) return;
    state.fullClear = true;
    redraw();
  });
  term.enter();
  flushTimer = setInterval(flushProcs, 120);
  draw();
  term.onData(onData);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
