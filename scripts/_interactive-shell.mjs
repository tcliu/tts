#!/usr/bin/env node

// _interactive-shell.mjs — reusable node-graph shell core for CLI scripts.
//
// A Node is { message, process(ctx) -> Node }. interactiveShell(start)
// prints each node's message, hands control to process(ctx), and follows
// the returned node; null exits. Nodes prompt via ctx.ask / ctx.selectOne /
// ctx.selectMany, print via ctx.say, and reference each other through the
// graph object the caller owns (e.g. `return graph.syncEnv`), so cyclic
// graphs need no factories.
//
// Terminal behavior (colors, menu redraw, raw-mode key handling) reuses
// ./_terminal.mjs; this module only owns the graph driver.
import { ask as askLine, c, selectMany as selectManyLine, selectOne as selectOneLine } from './_terminal.mjs'

export { c }

// Default chrome: bold node header; yellow "Cancelled." line.
const defaultFrame = message => `${c.bold}${message}${c.reset}`
const defaultCancelText = `${c.yellow}Cancelled.${c.reset}`

/**
 * Run an interactive shell over a node graph.
 *
 * @param {{message: string, process: (ctx: object) => (object|null|Promise<object|null>)}} start
 *   Entry node. process() returns the next node — or null to exit. Nodes
 *   reference each other via the graph object the caller owns, so the shell
 *   never needs to know the whole graph.
 * @param {object} [config]
 * @param {object} [config.options]
 *   Runtime behavior: ctx seeds the Context; output overrides the stream
 *   (stderr for deploy menus so stdout stays machine-clean; stdout for tests).
 * @param {object} [config.chrome]
 *   Renderer surface: frame(message) builds the per-node header line;
 *   cancelText is the default line on q/Ctrl-C (per-call cancelMessage wins).
 * @returns {Promise<object>} the final Context after the shell exits.
 */
export async function interactiveShell(start, config = {}) {
  const { options = {}, chrome = {} } = config
  const { ctx: seed = {}, output = process.stdout } = options
  const { frame = defaultFrame, cancelText = defaultCancelText } = chrome
  const ctx = {
    ...seed,
    // Prompt helpers + palette, so nodes never import terminal internals.
    ask: query => askLine(query, output),
    selectOne: (items, opts = {}, out = output) =>
      selectOneLine(items, {
        cancelMessage: cancelText,
        ...opts,
        output: opts.output ?? out,
      }),
    selectMany: (items, opts = {}) => selectManyLine(items, { cancelMessage: cancelText, ...opts }),
    say: line => output.write(`${line}\n`),
    c,
  }

  let current = start
  while (current) {
    if (typeof current.message !== 'string' || typeof current.process !== 'function') {
      throw new TypeError(
        'interactiveShell: process() returned a non-Node' + ' (valid returns: a Node, or null to exit)',
      )
    }
    const message = current.message
    output.write(`${frame(message)}\n`)
    current = await current.process(ctx)
    if (current === undefined) {
      throw new TypeError(
        `interactiveShell: node ${JSON.stringify(message)} returned undefined` +
          ' — return the next Node, or null to exit',
      )
    }
  }

  return ctx
}
