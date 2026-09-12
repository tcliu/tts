// Incremental terminal input parser for scripts/worktree-manager.mjs.
//
// Raw stdin chunks arrive in arbitrary pieces, so this keeps the trailing
// partial escape sequence buffered until the next chunk completes it, then
// emits one event per key, control key, mouse event, or printable character.
// The parser is pure — it only classifies bytes — so mode gating (list vs
// menu vs command prompt) stays in the caller and the byte handling is
// unit-testable (test/tui-input.test.mjs).
import { parseSgrMouse } from '../_tui.mjs'

// 3- and 4-char CSI sequences mapped to key names.
const CSI_KEYS = {
  '\x1b[A': 'up',
  '\x1b[B': 'down',
  '\x1b[C': 'right',
  '\x1b[D': 'left',
  '\x1b[H': 'home',
  '\x1b[F': 'end',
  '\x1b[1~': 'home',
  '\x1b[4~': 'end',
  '\x1b[5~': 'pageup',
  '\x1b[6~': 'pagedown',
  '\x1b[3~': 'delete',
}

// SS3 (application cursor key) form: ESC O <final>. Some terminals send these
// instead of the CSI form while the alternate screen is active.
const SS3_KEYS = {
  '\x1bOA': 'up',
  '\x1bOB': 'down',
  '\x1bOC': 'right',
  '\x1bOD': 'left',
  '\x1bOH': 'home',
  '\x1bOF': 'end',
}

const CONTROL_KEYS = {
  '\x03': 'c',
  '\x04': 'd',
  '\x11': 'q',
  '\x01': 'a',
  '\x05': 'e',
  '\x10': 'p',
  '\x0e': 'n',
}

// Returns the index after the sequence, or -1 when the chunk ends mid-sequence
// (the caller buffers the remainder). Emits into `events`.
function readEscape(s, i, events) {
  if (s[i + 1] === '[' && s[i + 2] === '<') {
    const mouse = parseSgrMouse(s, i)
    if (!mouse) return -1
    events.push({ type: 'mouse', mouse })
    return i + mouse.len
  }
  // A lone trailing ESC is an Escape press (no timeout, matching the previous
  // inline parser).
  if (s.length - i < 2) {
    events.push({ type: 'key', name: 'escape' })
    return i + 1
  }
  if (s[i + 1] === 'O') {
    if (s.length - i < 3) return -1
    const ss3 = s.slice(i, i + 3)
    if (SS3_KEYS[ss3]) {
      events.push({ type: 'key', name: SS3_KEYS[ss3] })
      return i + 3
    }
    events.push({ type: 'key', name: 'escape' })
    return i + 2
  }
  if (s[i + 1] !== '[') {
    events.push({ type: 'key', name: 'escape' })
    return i + 2
  }
  // xterm modifier form, e.g. \x1b[1;2A (shift+arrow): the final byte decides.
  if (s.length - i >= 6 && s.slice(i, i + 4) === '\x1b[1;') {
    events.push({ type: 'key', name: 'shift-arrow', dir: s[i + 5] })
    return i + 6
  }
  if (s.length - i < 3) return -1

  const seq3 = s.slice(i, i + 3)
  if (CSI_KEYS[seq3]) {
    events.push({ type: 'key', name: CSI_KEYS[seq3] })
    return i + 3
  }
  const seq4 = s.slice(i, i + 4)
  if (CSI_KEYS[seq4]) {
    events.push({ type: 'key', name: CSI_KEYS[seq4] })
    return i + 4
  }
  // Unknown escape: report it and re-read the rest as ordinary input.
  events.push({ type: 'key', name: 'escape' })
  return i + 1
}

/**
 * One parsed input event. `key` covers navigation/editing keys (with `dir`
 * for xterm modifier sequences), `control` the Ctrl-<letter> keys, `mouse` an
 * SGR mouse report, and `text` a single printable code point.
 *
 * @typedef {{
 *   | { type: 'key', name: string, dir?: string }
 *   | { type: 'control', key: string }
 *   | { type: 'mouse', mouse: { button: number, x: number, y: number, release: boolean, len: number } }
 *   | { type: 'text', value: string }
 * }} InputEvent
 */

/**
 * Create a stateful chunk parser. The returned function takes one raw stdin
 * chunk and returns the events it completed, in order.
 *
 * @returns {(chunk: string) => InputEvent[]}
 */
export function createInputParser() {
  let pending = ''
  return chunk => {
    const s = pending + chunk
    pending = ''
    const events = []
    let i = 0

    while (i < s.length) {
      const ch = s[i]

      if (CONTROL_KEYS[ch]) {
        events.push({ type: 'control', key: CONTROL_KEYS[ch] })
        i += 1
        continue
      }

      if (ch === '\x1b') {
        const next = readEscape(s, i, events)
        if (next === -1) {
          pending = s.slice(i)
          break
        }
        i = next
        continue
      }

      if (ch === '\t') {
        events.push({ type: 'key', name: 'tab' })
        i += 1
        continue
      }
      if (ch === '\r' || ch === '\n') {
        events.push({ type: 'key', name: 'enter' })
        i += 1
        continue
      }
      if (ch === '\x7f' || ch === '\x08') {
        events.push({ type: 'key', name: 'backspace' })
        i += 1
        continue
      }

      // Any other code point, including controls the caller ignores (e.g.
      // Ctrl-L): the caller applies its own printable/control gate.
      const cp = String.fromCodePoint(s.codePointAt(i))
      events.push({ type: 'text', value: cp })
      i += cp.length
    }

    return events
  }
}
