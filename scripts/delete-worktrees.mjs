#!/usr/bin/env node
import path from 'node:path'

import { c } from './_terminal.mjs'
import { interactiveShell } from './_interactive-shell.mjs'
import { deleteBranch, listDeleteTargets, removeWorktree } from './_worktrees.mjs'

function parseArgs(argv) {
  const args = argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`${c.bold}Usage:${c.reset}`)
    console.log('  scripts/delete-worktrees.mjs [paths or names...]')
    console.log('  scripts/delete-worktrees.mjs --interactive')
    process.exit(0)
  }
  return {
    interactive: args.includes('--interactive') || args.includes('-i') || args.length === 0,
    positional: args.filter(arg => !arg.startsWith('-')),
  }
}

function renderWorktreePicker() {
  return (items, state) => {
    const lines = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const cursor = i === state.cursor ? `${c.cyan}>${c.reset}` : ' '
      const marker = state.selected.has(i) ? `${c.green}[x]${c.reset}` : '[ ]'
      const branch = item.branch ?? '(detached)'
      const suffix = item.registered === false ? ` ${c.yellow}[unregistered]${c.reset}` : ''
      lines.push(` ${cursor} ${marker} ${item.name} ${c.gray}(${branch})${c.reset}${suffix}`)
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
// The positional-args path below never enters the graph.
function buildDeleteGraph() {
  const graph = {
    pick: {
      message: 'Select worktrees to delete:',
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

async function runDeleteInterview(worktrees) {
  const graph = buildDeleteGraph()
  return interactiveShell(graph.pick, {
    options: { ctx: { worktrees, selected: [] } },
    chrome: { cancelText: `${c.yellow}Cancelled.${c.reset}` },
  })
}

async function main() {
  const root = process.cwd()
  const { interactive, positional } = parseArgs(process.argv)
  const worktrees = listDeleteTargets(root)

  if (worktrees.length === 0) {
    console.log(`${c.yellow}No worktrees found.${c.reset}`)
    return
  }

  let selected
  if (!interactive && positional.length > 0) {
    selected = positional
      .map(input => {
        const resolved = path.resolve(input)
        return worktrees.find(worktree => worktree.path === resolved || worktree.name === input || worktree.branch === input)
      })
      .filter(Boolean)
    if (selected.length === 0) {
      console.error(`${c.red}No matching worktrees found.${c.reset}`)
      process.exit(1)
    }
  } else {
    selected = (await runDeleteInterview(worktrees)).selected
  }

  if (selected.length === 0) return

  console.log(`\n${c.bold}Deleting ${selected.length} worktree(s):${c.reset}`)
  let removed = 0
  for (const worktree of selected) {
    if (removeWorktree(root, worktree)) {
      console.log(`${c.green}Removed worktree${c.reset}: ${worktree.path}`)
      if (deleteBranch(root, worktree.branch)) {
        console.log(`${c.green}Deleted branch${c.reset}: ${worktree.branch}`)
      }
      removed++
    } else {
      console.error(`${c.red}Failed to remove worktree${c.reset}: ${worktree.path}`)
    }
  }
  console.log(`\n${c.green}${removed} worktree(s) removed.${c.reset}`)
}

main().catch(error => {
  console.error(`${c.red}${error.message}${c.reset}`)
  process.exit(1)
})
