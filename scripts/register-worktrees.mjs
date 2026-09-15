#!/usr/bin/env node
import { c } from './_terminal.mjs'
import { interactiveShell } from './_interactive-shell.mjs'
import { listRegisterTargets, registerWorktree, resolveWorktreesDir } from './_worktrees.mjs'

export { listRegisterTargets, registerWorktree }

function renderWorktreePicker() {
  return (items, state) => {
    const lines = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const cursor = i === state.cursor ? `${c.cyan}>${c.reset}` : ' '
      const marker = state.selected.has(i) ? `${c.green}[x]${c.reset}` : '[ ]'
      lines.push(` ${cursor} ${marker} ${item.name} ${c.gray}(${item.path})${c.reset}`)
    }
    lines.push('')
    lines.push(`${c.dim}Space: toggle | Enter: confirm | q: cancel${c.reset}`)
    return lines
  }
}

// Single-question interview: pick -> exit. q/Ctrl-C (or confirming an
// empty selection) yields no selection; the caller treats it as cancel.
// Effect code stays outside the graph, mirroring deploy.mjs
// (runDeployInterview collects answers, runDeployFlow acts on them).
function buildRegisterGraph() {
  const graph = {
    pick: {
      message: 'Select directories to register as git worktrees:',
      async process(ctx) {
        ctx.selected = await ctx.selectMany(ctx.worktrees, {
          render: renderWorktreePicker(),
        })
        return null
      },
    },
  }
  return graph
}

async function runRegisterInterview(worktrees) {
  const graph = buildRegisterGraph()
  return interactiveShell(graph.pick, {
    options: { ctx: { worktrees, selected: [] } },
    chrome: { cancelText: `${c.yellow}Cancelled.${c.reset}` },
  })
}

async function main() {
  const root = process.cwd()
  const worktrees = listRegisterTargets(root, resolveWorktreesDir(root))

  if (worktrees.length === 0) {
    console.log(`${c.yellow}No unregistered worktrees found.${c.reset}`)
    return
  }

  const { selected } = await runRegisterInterview(worktrees)
  if (selected.length === 0) return

  for (const worktree of selected) {
    console.log(`${c.green}Registering${c.reset} ${worktree.name}...`)
    try {
      registerWorktree(root, worktree.path, worktree.name)
      console.log(`${c.green}Registered${c.reset} ${worktree.name}`)
    } catch (error) {
      console.error(`${c.red}Failed to register${c.reset} ${worktree.name}: ${error.message}`)
    }
  }
  console.log(`${c.green}Done.${c.reset}`)
}

main().catch(error => {
  console.error(`${c.red}${error.message}${c.reset}`)
  process.exit(1)
})
