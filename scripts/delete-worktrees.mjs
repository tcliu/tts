#!/usr/bin/env node
import path from 'node:path'
import { parseArgs as parseCliArgs } from 'node:util'

import { c, selectOne } from './_terminal.mjs'
import { interactiveShell } from './_interactive-shell.mjs'
import { countDirtyFiles, deleteBranch, findProcessesInPath, listDeleteTargets, removeWorktree, resolveWorktreesDir } from './_worktrees.mjs'

function fail(message) {
  console.error(`${c.red}${message}${c.reset}`)
  process.exit(1)
}

function printUsage() {
  console.log(`${c.bold}Usage:${c.reset}`)
  console.log('  scripts/delete-worktrees.mjs [paths or names...] [--yes]')
  console.log('  scripts/delete-worktrees.mjs --interactive')
  console.log('')
  console.log('  --yes, -y   skip the delete confirmation (required when stdin is not a TTY)')
}

function parseArgs(argv) {
  let cli
  try {
    cli = parseCliArgs({
      args: argv,
      options: {
        interactive: { type: 'boolean', short: 'i' },
        yes: { type: 'boolean', short: 'y' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
      strict: true,
    })
  } catch (error) {
    fail(error.message)
  }
  const { values, positionals } = cli
  if (values.help) {
    printUsage()
    process.exit(0)
  }
  return {
    interactive: Boolean(values.interactive) || positionals.length === 0,
    yes: Boolean(values.yes),
    positional: positionals,
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

function renderConfirmPicker(defaultWord) {
  return (entries, state) => {
    const lines = []
    for (let i = 0; i < entries.length; i++) {
      const item = entries[i]
      const cursor = i === state.cursor ? `${c.cyan}>${c.reset}` : ' '
      lines.push(` ${cursor} ${c.green}${item.label}${c.reset} ${c.gray}(${item.description})${c.reset}`)
    }
    lines.push('')
    lines.push(`${c.dim}Up/Down: move | Enter: confirm (default ${defaultWord}) | q: cancel${c.reset}`)
    return lines
  }
}

const DANGER_CHOICES = [
  { value: 'yes', label: 'Yes', description: 'force remove (discards uncommitted work)' },
  { value: 'no', label: 'No', description: 'cancel' },
]

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

// Removal is `git worktree remove --force`, which discards uncommitted work,
// so report what is at risk and confirm before deleting anything. Destructive
// and irreversible: the confirm defaults to No. Non-interactive runs must pass
// --yes (same contract as scripts/vercel.mjs remove-deployment).
async function confirmDeletion({ selected, yes }) {
  for (const worktree of selected) {
    // Warn-only here (unlike the manager's refuse-before-confirm): the CLI
    // already requires an explicit Yes with No as the default, so this stays
    // informed consent rather than changing the command's exit contract.
    const blockers = findProcessesInPath(worktree.path)
    if (blockers === null) {
      console.log(
        `  ${c.red}✖ ${worktree.path}${c.reset} ${c.gray}(process status unreadable — stop any processes inside or the delete half-finishes)${c.reset}`,
      )
    } else if (blockers.length > 0) {
      const who = blockers.map(p => `${p.pid}${p.cmd ? ` (${p.cmd})` : ''}`).join(', ')
      console.log(
        `  ${c.red}✖ ${worktree.path}${c.reset} ${c.gray}(process(es) running inside: ${who} — stop them or the delete half-finishes)${c.reset}`,
      )
    }
    const dirty = countDirtyFiles(worktree.path)
    if (dirty === null || dirty > 0) {
      const detail = dirty === null ? 'status unavailable' : `${dirty} uncommitted change(s)`
      console.log(`  ${c.yellow}⚠ ${worktree.path}${c.reset} ${c.gray}(${detail})${c.reset}`)
    }
  }
  if (yes) return
  if (!process.stdin.isTTY) {
    fail('Refusing to delete without --yes on a non-interactive terminal.')
  }
  const answer = await selectOne(DANGER_CHOICES, {
    defaultValue: 'no',
    render: renderConfirmPicker('no'),
  })
  if (!answer || answer.value !== 'yes') {
    fail('Cancelled.')
  }
}

async function main() {
  const root = process.cwd()
  const { interactive, yes, positional } = parseArgs(process.argv.slice(2))
  const worktrees = listDeleteTargets(root, resolveWorktreesDir(root))

  if (worktrees.length === 0) {
    console.log(`${c.yellow}No worktrees found.${c.reset}`)
    return
  }

  let selected
  if (!interactive && positional.length > 0) {
    selected = positional
      .map(input => {
        const resolved = path.resolve(input)
        return worktrees.find(
          worktree => worktree.path === resolved || worktree.name === input || worktree.branch === input,
        )
      })
      .filter(Boolean)
    if (selected.length === 0) {
      fail('No matching worktrees found.')
    }
  } else {
    selected = (await runDeleteInterview(worktrees)).selected
  }

  if (selected.length === 0) return

  console.log(`\n${c.bold}Deleting ${selected.length} worktree(s):${c.reset}`)
  await confirmDeletion({ selected, yes })

  let removed = 0
  for (const worktree of selected) {
    if (removeWorktree(root, worktree)) {
      console.log(`${c.green}Removed worktree${c.reset}: ${worktree.path}`)
      // Unregistered dirs get their branch from a foreign .git, so deleting
      // that name in the main repo can hit an unrelated real branch. Mirrors
      // the safety divergence documented in scripts/worktree-manager.mjs.
      if (worktree.registered !== false && deleteBranch(root, worktree.branch)) {
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
