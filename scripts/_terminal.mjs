const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

export { c }

export function createListRenderer(renderLines) {
  let lineCount = 0

  return state => {
    const lines = renderLines(state)
    if (lineCount > 0) {
      process.stdout.write(`\x1b[${lineCount}A`)
    }
    for (const line of lines) {
      process.stdout.write(`\x1b[2K${line}\n`)
    }
    for (let i = lines.length; i < lineCount; i++) {
      process.stdout.write('\x1b[2K\n')
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
