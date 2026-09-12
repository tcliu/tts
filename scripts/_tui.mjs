#!/usr/bin/env node

// _tui.mjs — reusable terminal TUI primitives for full-screen interactive CLIs.
//
// Provides the CJK-aware width utilities, ANSI screen management, SGR mouse
// parsing, and raw-mode terminal lifecycle shared by full-screen TUIs, so
// other scripts can build them without reimplementing terminal plumbing.
//
// Depends on: ./_terminal.mjs (palette, line prompts).

import { stdin, stdout } from 'node:process'

import { c } from './_terminal.mjs'

// Re-export the palette so tui consumers don't import _terminal directly.
export { c }

// ---- Display width (CJK-aware, ANSI-escape transparent) ----

const WIDE_CHAR_RE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/

/** Count visible terminal columns in a string, skipping ANSI escape sequences. */
export function displayWidth(s) {
  let w = 0
  let inEsc = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inEsc) {
      if (ch === 'm') inEsc = false
      continue
    }
    if (ch === '\x1b') {
      inEsc = true
      continue
    }
    w += WIDE_CHAR_RE.test(ch) ? 2 : 1
  }
  return w
}

/** Return displayed width of a single character (1 or 2). */
export function charWidth(ch) {
  return WIDE_CHAR_RE.test(ch) ? 2 : 1
}

/** Right-pad a string (ANSI-aware) to a target display width. */
export function padRight(s, width) {
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)))
}

/** Wrap text into lines no wider than `width` terminal columns (word-based). */
export function wrapText(text, width) {
  const words = text.split(' ')
  const lines = []
  let cur = ''
  for (const w of words) {
    const trial = cur ? cur + ' ' + w : w
    if (displayWidth(trial) > width && cur) {
      lines.push(cur)
      cur = w
    } else {
      cur = trial
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/** Truncate an ANSI-decorated string to `width` visible columns. */
export function truncate(s, width) {
  let w = 0
  let out = ''
  let esc = false
  for (const ch of s) {
    if (esc) {
      out += ch
      if (ch === 'm') esc = false
      continue
    }
    if (ch === '\x1b') {
      out += ch
      esc = true
      continue
    }
    const cw = charWidth(ch)
    if (w + cw > width) break
    w += cw
    out += ch
  }
  return out
}

// Counterpart of `truncate`: keep the trailing `width` visible columns,
// carrying the SGR style that was active at the cut so the kept segment does
// not inherit whatever colour the caller printed before it. Used to render
// overlays (dialogs) over an existing row without blanking its sides.
export function takeRight(s, width) {
  if (width <= 0) return ''
  const total = displayWidth(s)
  if (total <= width) return s

  const skip = total - width
  const tokens = []
  let esc = ''
  let inEsc = false
  for (const ch of s) {
    if (inEsc) {
      esc += ch
      if (ch === 'm') {
        inEsc = false
        tokens.push({ text: esc, width: 0 })
        esc = ''
      }
      continue
    }
    if (ch === '\x1b') {
      inEsc = true
      esc = ch
      continue
    }
    tokens.push({ text: ch, width: charWidth(ch) })
  }
  if (esc) tokens.push({ text: esc, width: 0 })

  let seen = 0
  let activeStyle = ''
  let out = ''
  let started = false
  for (const token of tokens) {
    if (token.width === 0) {
      if (started) out += token.text
      else activeStyle = token.text
      continue
    }
    if (!started) {
      const before = seen
      seen += token.width
      // Fully before the cut, or a wide char straddling it (dropped, as
      // `truncate` does), so the kept region starts on a clean boundary.
      if (seen <= skip || before < skip) continue
      started = true
      out = activeStyle + token.text
      continue
    }
    out += token.text
  }
  return started ? out : activeStyle
}

// ---- Screen rendering (differential full-screen redraw) ----

/**
 * Create a full-screen terminal renderer.
 *
 * Manages cursor hide, alternate screen, and differential line redraws —
 * only writing lines that changed since the last render.
 *
 * @param {object} [opts]
 * @param {object} [opts.stream] — output stream (default: process.stdout)
 * @returns {{ render(lines: string[], opts?: { fullClear?: boolean }) => void, resizeFullClear() => void, enter() => void, exit() => void }}
 */
export function createScreenRenderer(opts = {}) {
  const stream = opts.stream ?? stdout
  let lastLines = null
  let fullClear = true

  const enter = () => {
    stream.write('\x1b[?1049h\x1b[?25l')
  }

  const exit = () => {
    stream.write('\x1b[?25h\x1b[?1049l')
  }

  const resizeFullClear = () => {
    fullClear = true
  }

  const render = (lines, renderOpts = {}) => {
    const { fullClear: forceFull = false } = renderOpts
    const full = forceFull || fullClear || lastLines === null
    let out = '\x1b[?25l'
    if (full) out += '\x1b[2J\x1b[H'
    const max = Math.max(lastLines ? lastLines.length : 0, lines.length)
    for (let k = 0; k < max; k++) {
      const cur = lines[k]
      const old = lastLines ? lastLines[k] : undefined
      if (!full && cur === old) continue
      if (cur === undefined) {
        out += `\x1b[${k + 1};1H\x1b[K`
      } else {
        out += `\x1b[${k + 1};1H\x1b[K${cur}`
      }
    }
    stream.write(out)
    lastLines = lines
    fullClear = false
  }

  return { render, resizeFullClear, enter, exit }
}

// ---- SGR mouse event parsing ----

/**
 * Parse an SGR mouse sequence starting at `data[i] === '\x1b[<'`.
 *
 * Returns null if the sequence is incomplete or malformed.
 * @returns {{ button: number, x: number, y: number, release: boolean, len: number } | null}
 */
export function parseSgrMouse(s, i) {
  let j = i + 3
  const nums = []
  let cur = ''
  let endChar = ''
  while (j < s.length) {
    const ch = s[j]
    if (ch === ';') {
      nums.push(cur === '' ? 0 : parseInt(cur, 10))
      cur = ''
      j++
      continue
    }
    if (ch === 'M' || ch === 'm') {
      endChar = ch
      nums.push(cur === '' ? 0 : parseInt(cur, 10))
      j++
      break
    }
    if (ch < '0' || ch > '9') return null
    cur += ch
    j++
  }
  if (endChar === '') return null
  if (nums.length < 3) return null
  return { button: nums[0], x: nums[1], y: nums[2], release: endChar === 'm', len: j - i }
}

// ---- Bordered option box (popup dialogs) ----

// Columns of the `│ ` frame before a dialog's content on every row. Callers
// that hit-test dialog content (tabs, options) must offset by this much.
export const DIALOG_SIDE_PAD_COLS = 2

/**
 * Build a bordered option box as render-ready lines: accent frame, optional
 * header lines (title extras such as tabs), a separator, `listH` option rows
 * with a selection marker and scroll arrows, and a closing frame row.
 *
 * Pure — content, geometry, and selection arrive through the spec — so every
 * dialog in a full-screen TUI shares one box implementation and stays
 * unit-testable.
 *
 * @param {object} spec
 * @param {string} spec.title — header label (e.g. "MENU")
 * @param {number} spec.dialogW — total box width in columns
 * @param {number} spec.listH — option rows to render
 * @param {string[]} spec.options — pre-styled option labels
 * @param {number} spec.selectedIndex — highlighted option
 * @param {string[]} [spec.headerLines] — pre-styled rows under the title
 * @param {string} [spec.accent] — ANSI prefix for the frame
 * @param {string} [spec.markerAccent] — ANSI prefix for the selection marker
 * @returns {{ lines: string[], start: number, total: number }}
 */
export function buildDialogBox({
  title,
  dialogW,
  listH,
  options,
  selectedIndex,
  headerLines = [],
  accent = c.cyan,
  markerAccent = accent,
}) {
  const inner = dialogW - 2
  const content = inner - 2
  const border = s => `${accent}${s}${c.reset}`
  const side = t => `${accent}│${c.reset} ${t}${accent} │${c.reset}`
  const lines = [border(`┌ ${title} ${'─'.repeat(Math.max(1, inner - title.length - 2))}┐`)]
  for (const header of headerLines) {
    lines.push(side(padRight(truncate(header, content), content)))
  }
  lines.push(side('─'.repeat(content)))

  let start = 0
  if (options.length > listH) {
    start = Math.max(0, Math.min(selectedIndex - Math.floor(listH / 2), options.length - listH))
  }
  for (let i = 0; i < listH; i++) {
    const index = start + i
    let line = ''
    if (index < options.length) {
      const isSelected = index === selectedIndex
      const marker = isSelected ? `${markerAccent}▸${c.reset} ` : '  '
      line = `${marker}${isSelected ? c.reverse : ''}${options[index]}${c.reset}`
      if (i === 0 && start > 0) line += ` ${c.dim}▲${c.reset}`
      if (i === listH - 1 && start + listH < options.length) line += ` ${c.dim}▼${c.reset}`
    }
    lines.push(side(padRight(truncate(line, content), content)))
  }
  lines.push(border(`└${'─'.repeat(inner)}┘`))
  return { lines, start, total: options.length }
}

// ---- Terminal lifecycle / raw mode ----

/**
 * Create a terminal manager for full-screen raw-mode TUIs.
 * Provides enter/exit (raw mode + alternate screen), stream accessors,
 * a resize listener, and cleanup that restores the terminal.
 *
 * @param {object} [opts]
 * @param {object} [opts.stream] — stdout stream (default: process.stdout)
 */
export function createTerminalManager(opts = {}) {
  const stream = opts.stream ?? stdout
  const termStream = stdin

  let resizeHandler = null
  let dataHandler = null
  let exited = false

  const enter = () => {
    if (!termStream.isTTY) {
      throw new Error('Terminal manager requires a TTY')
    }
    termStream.setRawMode(true)
    termStream.resume()
    termStream.setEncoding('utf-8')
    stream.write('\x1b[?1049h\x1b[?25l\x1b[?1002h\x1b[?1006h')
  }

  const onResize = handler => {
    resizeHandler = handler
    stream.on('resize', handler)
  }

  const onData = handler => {
    dataHandler = handler
    termStream.on('data', handler)
  }

  const removeData = () => {
    if (dataHandler) termStream.removeListener('data', dataHandler)
  }

  const exit = () => {
    if (exited) return
    exited = true
    if (dataHandler) termStream.removeListener('data', dataHandler)
    if (resizeHandler) stream.removeListener('resize', resizeHandler)
    stream.write('\x1b[?25h\x1b[?1006l\x1b[?1002l\x1b[?1049l')
    termStream.setRawMode(false)
    termStream.pause()
  }

  return {
    stdin: termStream,
    stdout: stream,
    enter,
    onResize,
    onData,
    removeData,
    exit,
  }
}

// ---- Misc rendering helpers ----

/** Render a progress bar with filled/empty segments. */
export function progressBar(fraction, width) {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width)
  return `\x1b[36m${'█'.repeat(filled)}\x1b[90m${'░'.repeat(Math.max(0, width - filled))}\x1b[0m`
}

/** Format seconds as MM:SS. */
export function fmtSec(sec) {
  const t = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
