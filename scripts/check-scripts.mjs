#!/usr/bin/env node
// Parse-check every script module.
//
// The app typecheck covers `src/`, and the tests import only a few `scripts/`
// modules, so a script that fails to link (a duplicate top-level declaration,
// for example) passes `check`, `build`, and `test` while breaking every entry
// point that imports it. Parse each `scripts/**/*.mjs` with the same parser the
// runtime uses so that class of error fails the gate instead of shipping.
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url))

function collect(dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...collect(full))
    else if (entry.isFile() && entry.name.endsWith('.mjs')) found.push(full)
  }
  return found
}

const files = collect(scriptsRoot)
const failed = []
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (error) {
    const first = (error.stderr?.toString() ?? error.message).trim().split('\n')[0]
    failed.push(`${path.relative(process.cwd(), file)}: ${first}`)
  }
}

if (failed.length > 0) {
  for (const line of failed) console.error(line)
  console.error(`\n${failed.length} of ${files.length} script(s) failed to parse.`)
  process.exit(1)
}
console.log(`Parsed ${files.length} script(s).`)
