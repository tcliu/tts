#!/usr/bin/env node

import { createInterface } from 'node:readline'

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  reverse: '\x1b[7m',
  bgCyan: '\x1b[46m',
  black: '\x1b[30m',
}

export { c }
export { displayWidth, padRight, wrapText, truncate } from './_tui.mjs'

// Line prompt in the convert-yaml style: cyan label, yellow hint.
// `output` carries the query so prompt drivers consumed via stdout
// capture can render the menu on stderr and keep stdout machine-clean.
export function ask(query, output = process.stdout) {
  const rl = createInterface({ input: process.stdin, output })
  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close()
      resolve(answer)
    })
  })
}

export async function promptYesNo(label, defaultYes, output = process.stdout) {
  const hint = defaultYes ? 'Y/n' : 'y/N'
  const answer = await ask(`${c.cyan}${label}${c.reset} ${c.yellow}[${hint}]${c.reset}: `, output)
  if (!answer.trim()) return defaultYes
  return answer.toLowerCase().startsWith('y')
}

export function createListRenderer(renderLines, stream = process.stdout) {
  let lineCount = 0

  return state => {
    const lines = renderLines(state)
    if (lineCount > 0) {
      stream.write(`\x1b[${lineCount}A`)
    }
    for (const line of lines) {
      stream.write(`\x1b[2K${line}\n`)
    }
    for (let i = lines.length; i < lineCount; i++) {
      stream.write('\x1b[2K\n')
    }
    lineCount = lines.length
  }
}

export async function selectMany(items, options) {
  if (items.length === 0) return []

  const state = { cursor: 0, selected: new Set() }
  const render = createListRenderer(() => options.render(items, state))

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf-8')
  }

  render()

  return new Promise(resolve => {
    function cleanup() {
      process.stdin.removeListener('data', onData)
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false)
        process.stdin.pause()
      }
    }

    function onData(key) {
      if (key === 'q' || key === '\x03') {
        cleanup()
        console.log(options.cancelMessage ?? `${c.yellow}Cancelled.${c.reset}`)
        resolve([])
        return
      }

      if (key === '\x1b[A') {
        state.cursor = Math.max(0, state.cursor - 1)
        render()
        return
      }

      if (key === '\x1b[B') {
        state.cursor = Math.min(items.length - 1, state.cursor + 1)
        render()
        return
      }

      if (key === ' ') {
        if (state.selected.has(state.cursor)) {
          state.selected.delete(state.cursor)
        } else {
          state.selected.add(state.cursor)
        }
        render()
        return
      }

      if (key === '\r' || key === '\n') {
        cleanup()
        resolve([...state.selected].sort((a, b) => a - b).map(index => items[index]))
      }
    }

    process.stdin.on('data', onData)
  })
}

// Single-select sibling of selectMany: arrows move, Enter confirms,
// q/Ctrl-C cancels to null. Shares the render(items, state) contract.
// options.defaultValue preselects the matching item (by value) for
// callers with a preferred default.
export async function selectOne(items, options) {
  if (items.length === 0) return null

  const output = options.output ?? process.stdout
  const defaultCursor =
    options.defaultValue === undefined
      ? 0
      : items.findIndex(item => (item.value ?? item) === options.defaultValue)
  const state = { cursor: Math.max(0, defaultCursor) }
  const render = createListRenderer(() => options.render(items, state), output)

  // resume() + string decoding stay unconditional so piped input also works;
  // only raw mode needs a TTY.
  process.stdin.resume()
  process.stdin.setEncoding('utf-8')
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
  }

  render()

  return new Promise(resolve => {
    function cleanup() {
      process.stdin.removeListener('data', onData)
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false)
        process.stdin.pause()
      }
    }

    function onData(key) {
      if (key === 'q' || key === '\x03') {
        cleanup()
        output.write(`${options.cancelMessage ?? `${c.yellow}Cancelled.${c.reset}`}\n`)
        resolve(null)
        return
      }

      if (key === '\x1b[A') {
        state.cursor = Math.max(0, state.cursor - 1)
        render()
        return
      }

      if (key === '\x1b[B') {
        state.cursor = Math.min(items.length - 1, state.cursor + 1)
        render()
        return
      }

      if (key === '\r' || key === '\n') {
        cleanup()
        resolve(items[state.cursor])
      }
    }

    process.stdin.on('data', onData)
  })
}
