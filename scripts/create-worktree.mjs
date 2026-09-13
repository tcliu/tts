#!/usr/bin/env node
import { existsSync } from 'node:fs'
import path from 'node:path'
import { parseArgs as parseCliArgs } from 'node:util'

import { c } from './_terminal.mjs'
import { interactiveShell } from './_interactive-shell.mjs'
import {
  getWorktreesRoot,
  isValidBranchName,
  removeWorktreeAndBranch,
  setupWorktree,
} from './_worktrees.mjs'

function printUsage() {
  console.log(`${c.bold}Usage:${c.reset}`)
  console.log('  node scripts/create-worktree.mjs <branch>')
  console.log('  node scripts/create-worktree.mjs --interactive')
}

function parseArgs(argv) {
  let cli
  try {
    cli = parseCliArgs({
      args: argv.slice(2),
      options: {
        interactive: { type: 'boolean', short: 'i' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
      strict: true,
    })
  } catch (error) {
    console.error(`${c.red}${error.message}${c.reset}`)
    process.exit(1)
  }
  const { values, positionals } = cli
  if (values.help) {
    printUsage()
    process.exit(0)
  }
  return {
    interactive: Boolean(values.interactive) || positionals.length === 0,
    branch: positionals[0] ?? null,
  }
}

// Single-question interview: branch name -> exit. An empty answer cancels;
// invalid or taken names re-prompt, mirroring the old promptBranchName loop.
// Effect code stays outside the graph, mirroring deploy.mjs
// (runDeployInterview collects answers, runDeployFlow acts on them).
function buildBranchGraph(root) {
  const graph = {
    branch: {
      message: 'Create a new worktree:',
      async process(ctx) {
        const prompt = `${c.cyan}Branch name${c.reset} (${c.dim}leave empty to cancel${c.reset}): `
        for (;;) {
          const raw = await askBranchName(ctx, prompt)
          // EOF (Ctrl-D / exhausted pipe) cancels, matching the old
          // for-await readline loop which ended on stream close.
          if (raw === null) {
            return null
          }
          const answer = raw.trim()
          if (!answer) {
            return null
          }
          if (!isValidBranchName(answer)) {
            console.error(`${c.red}Invalid branch name:${c.reset} ${answer}`)
          } else if (existsSync(path.join(getWorktreesRoot(root), answer))) {
            console.error(`${c.red}Worktree already exists:${c.reset} ${answer}`)
          } else {
            ctx.branchName = answer
            return null
          }
        }
      },
    },
  }
  return graph
}

// ctx.ask never settles once stdin is closed (readline drops the pending
// question), so race it against stream end and map EOF to cancel. Without
// this the process would exit silently instead of printing `Cancelled.`.
function askBranchName(ctx, prompt) {
  if (process.stdin.readableEnded) {
    return Promise.resolve(null)
  }
  let onEnd
  const eof = new Promise(resolve => {
    onEnd = () => resolve(null)
    process.stdin.once('end', onEnd)
  })
  return Promise.race([ctx.ask(prompt), eof]).finally(() => {
    process.stdin.removeListener('end', onEnd)
  })
}

async function runBranchInterview(root) {
  const graph = buildBranchGraph(root)
  return interactiveShell(graph.branch, {
    options: { ctx: { branchName: '' } },
    chrome: { cancelText: `${c.yellow}Cancelled.${c.reset}` },
  })
}

async function main() {
  const root = process.cwd()
  if (path.resolve(root).split(path.sep).includes('.worktrees')) {
    console.error(`${c.red}Run this script from the default worktree, not a nested worktree.${c.reset}`)
    process.exit(1)
  }

  const { interactive, branch } = parseArgs(process.argv)

  let branchName = branch
  if (interactive) {
    branchName = (await runBranchInterview(root)).branchName
    if (!branchName) {
      console.log(`${c.yellow}Cancelled.${c.reset}`)
      return
    }
  }

  if (!isValidBranchName(branchName)) {
    console.error(`${c.red}Invalid branch name:${c.reset} ${branchName}`)
    process.exit(1)
  }

  const worktreeDir = path.join(getWorktreesRoot(root), branchName)
  if (existsSync(worktreeDir)) {
    console.error(`${c.red}Worktree already exists:${c.reset} ${worktreeDir}`)
    process.exit(1)
  }

  let carried
  try {
    carried = setupWorktree({ root, worktreePath: worktreeDir, branch: branchName }).carried
  } catch (error) {
    if (error.phase === 'register') {
      console.error(`${c.red}Failed to create worktree:${c.reset} ${error.message}`)
    } else {
      console.error(`${c.red}Failed to set up worktree:${c.reset} ${error.message}`)
      const cleanup = removeWorktreeAndBranch(root, worktreeDir, branchName)
      if (!cleanup.removed) {
        console.error(`${c.red}Failed to remove incomplete worktree:${c.reset} ${worktreeDir}`)
      }
      if (!cleanup.branchDeleted) {
        console.error(`${c.red}Failed to delete branch:${c.reset} ${branchName}`)
      }
    }
    process.exit(1)
  }
  for (const note of carried.notes) {
    console.warn(`${c.yellow}Uncommitted work not fully carried:${c.reset} ${note}`)
  }
  if (carried.patched || carried.copied.length > 0) {
    console.log(
      `${c.green}Carried uncommitted changes${c.reset} into ${worktreeDir}${carried.patched ? ' (tracked diff)' : ''}${carried.copied.length > 0 ? ` (untracked: ${carried.copied.join(', ')})` : ''}`,
    )
  }

  console.log(`\n${c.green}Worktree created:${c.reset} ${worktreeDir}`)
  console.log(`${c.green}DEV_TAG=${branchName}${c.reset} set in ${path.join(worktreeDir, '.env.local')}`)
}

main().catch(error => {
  console.error(`${c.red}${error.message}${c.reset}`)
  process.exit(1)
})
