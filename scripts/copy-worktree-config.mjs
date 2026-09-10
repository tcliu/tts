#!/usr/bin/env node
import { c } from './_terminal.mjs'
import { interactiveShell } from './_interactive-shell.mjs'
import { copyDevFiles, listCopyTargets, readDevTag } from './_worktrees.mjs'

export { copyDevFiles }

function renderWorktreePicker() {
  return (items, state) => {
    const lines = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const cursor = i === state.cursor ? `${c.cyan}>${c.reset}` : ' '
      const marker = state.selected.has(i) ? `${c.green}[x]${c.reset}` : '[ ]'
      const devTag = readDevTag(item.path)
      const suffix = devTag ? ` DEV_TAG=${devTag}` : ''
      lines.push(` ${cursor} ${marker} ${item.name} ${c.gray}(${item.path}${suffix})${c.reset}`)
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
function buildCopyGraph() {
  const graph = {
    pick: {
      message: 'Select worktrees to copy config to:',
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

async function runCopyInterview(worktrees) {
  const graph = buildCopyGraph()
  return interactiveShell(graph.pick, {
    options: { ctx: { worktrees, selected: [] } },
    chrome: { cancelText: `${c.yellow}Cancelled.${c.reset}` },
  })
}

async function main() {
  const root = process.cwd()
  const worktrees = listCopyTargets(root)

  if (worktrees.length === 0) {
    console.log(`${c.yellow}No worktrees found to copy to.${c.reset}`)
    return
  }

  const { selected } = await runCopyInterview(worktrees)
  if (selected.length === 0) return

  for (const worktree of selected) {
    console.log(`${c.green}Copying config to${c.reset} ${worktree.name}...`)
    const copied = copyDevFiles(root, worktree.path)
    if (copied.length === 0) {
      console.log(`  ${c.dim}(nothing to copy — already present)${c.reset}`)
    } else {
      for (const file of copied) {
        console.log(`  ${c.gray}${file}${c.reset}`)
      }
    }
  }
  console.log(`${c.green}Done.${c.reset}`)
}

main().catch(error => {
  console.error(`${c.red}${error.message}${c.reset}`)
  process.exit(1)
})
