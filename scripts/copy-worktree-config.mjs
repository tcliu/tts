#!/usr/bin/env node
import { c, selectMany } from './_terminal.mjs'
import { copyDevFiles, listCopyTargets, readDevTag } from './_worktrees.mjs'

export { copyDevFiles }

async function chooseWorktrees(worktrees) {
  return selectMany(worktrees, {
    render(items, state) {
      const lines = [`${c.bold}Select worktrees to copy config to:${c.reset}`, '']
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
    },
  })
}

async function main() {
  const root = process.cwd()
  const worktrees = listCopyTargets(root)

  if (worktrees.length === 0) {
    console.log(`${c.yellow}No worktrees found to copy to.${c.reset}`)
    return
  }

  const selected = await chooseWorktrees(worktrees)
  if (selected.length === 0) return

  for (const worktree of selected) {
    console.log(`${c.green}Copying config to${c.reset} ${worktree.name}...`)
    copyDevFiles(root, worktree.path)
  }
  console.log(`${c.green}Done.${c.reset}`)
}

main().catch(error => {
  console.error(`${c.red}${error.message}${c.reset}`)
  process.exit(1)
})
