#!/usr/bin/env node
import { c, selectMany } from './_terminal.mjs'
import { listRegisterTargets, registerWorktree } from './_worktrees.mjs'

export { listRegisterTargets, registerWorktree }

async function chooseWorktrees(worktrees) {
  return selectMany(worktrees, {
    render(items, state) {
      const lines = [`${c.bold}Select directories to register as git worktrees:${c.reset}`, '']
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const cursor = i === state.cursor ? `${c.cyan}>${c.reset}` : ' '
        const marker = state.selected.has(i) ? `${c.green}[x]${c.reset}` : '[ ]'
        lines.push(` ${cursor} ${marker} ${item.name} ${c.gray}(${item.path})${c.reset}`)
      }
      lines.push('')
      lines.push(`${c.dim}Space: toggle | Enter: confirm | q: cancel${c.reset}`)
      return lines
    },
  })
}

async function main() {
  const root = process.cwd()
  const worktrees = listRegisterTargets(root)

  if (worktrees.length === 0) {
    console.log(`${c.yellow}No unregistered worktrees found.${c.reset}`)
    return
  }

  const selected = await chooseWorktrees(worktrees)
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
