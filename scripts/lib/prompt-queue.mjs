#!/usr/bin/env node
// Serializes interactive prompts across concurrent deploy flows. Parallel
// targets share one stdin: two readers at once (readline or raw-mode menus)
// would consume each other's keystrokes and corrupt both answers. Every
// prompt in a deploy path goes through `withPrompt`.
//
// The tail chain is module state, so every importer shares one queue.
let promptTail = Promise.resolve()

export function withPrompt(fn) {
  const next = promptTail.then(fn, fn)
  promptTail = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}
