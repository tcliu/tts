#!/usr/bin/env node
// Bootstraps the Cloudflare D1 schema from the app's `sql/schema.sql`
// (translated to SQLite DDL by d1-schema.mjs). Guarded by `planD1Bootstrap`:
// applies only when a required table is missing — a populated database is
// never wiped. Required tables and the schema qualifier derive from
// schema.sql itself (CREATE TABLE names; CREATE SCHEMA name), and D1 mode is
// explicit (`CLOUDFLARE_D1_DATABASE` must be set), so this file is identical
// in every app. Run by the Cloudflare deploy flow, or directly:
//   CLOUDFLARE_D1_DATABASE=<name> node scripts/apply-d1-schema.mjs
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseD1TableNames, planD1Bootstrap, translateSchemaForD1 } from './d1-schema.mjs'
import { defaultWranglerRunner, resolveD1DatabaseName } from './lib/cloudflare.mjs'

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIST_TABLES_SQL = "select name from sqlite_master where type = 'table'"

function fail(message) {
  console.error(message)
  process.exit(1)
}

// Schema qualifier from `CREATE SCHEMA "name"` (`"name".`, or '' when the
// schema is unqualified). Pure so tests can assert it without wrangler.
export function parseSchemaQualifier(schema) {
  const match = /create\s+schema\s+(?:if\s+not\s+exists\s+)?(?:"([^"]+)"|([A-Za-z_][\w$]*))/i.exec(
    String(schema || ''),
  )
  const name = match ? match[1] ?? match[2] : ''
  return name ? `"${name}".` : ''
}

// Table names from translated (qualifier-free) DDL: `CREATE TABLE [IF NOT
// EXISTS] name (`. Pure so tests can assert it without wrangler.
export function parseSchemaTableNames(translatedSchema) {
  const names = []
  const pattern = /create\s+table\s+(?:temp\s+|temporary\s+)?(?:if\s+not\s+exists\s+)?(?:"([^"]+)"|([A-Za-z_][\w$]*))\s*\(/gi
  let match
  while ((match = pattern.exec(translatedSchema)) !== null) {
    names.push(match[1] ?? match[2])
  }
  return [...new Set(names)]
}

function listExistingTables(database, runner) {
  const result = runner(['d1', 'execute', database, '--remote', '--json', '--command', LIST_TABLES_SQL], {
    cwd: ROOT_DIR,
    capture: true,
  })
  if (result.status !== 0) {
    throw new Error(`wrangler d1 execute (list tables) failed (exit ${result.status}): ${result.output.trim()}`)
  }
  return parseD1TableNames(result.output)
}

function applySchema(database, sql, runner) {
  // Wrangler's `--file` takes a file path only (no `-` stdin alias): write
  // the translated schema to a temp file so `d1 execute` ingests it.
  const dir = mkdtempSync(join(tmpdir(), 'd1-schema-'))
  const file = join(dir, 'schema.sql')
  try {
    writeFileSync(file, sql.endsWith('\n') ? sql : `${sql}\n`)
    const result = runner(['d1', 'execute', database, '--remote', '--file', file], {
      cwd: ROOT_DIR,
    })
    if (result.status !== 0) {
      throw new Error(`wrangler d1 execute (apply schema) failed (exit ${result.status}).`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function main() {
  const database = resolveD1DatabaseName(process.env)
  if (!database) {
    fail('CLOUDFLARE_D1_DATABASE is empty: set it to the D1 database name to bootstrap.')
  }
  let existingTables
  try {
    existingTables = listExistingTables(database, defaultWranglerRunner)
  } catch (error) {
    fail(error.message)
  }
  const schema = readFileSync(join(ROOT_DIR, 'sql', 'schema.sql'), 'utf8')
  const qualifier = parseSchemaQualifier(schema)
  const plan = planD1Bootstrap({
    schema,
    existingTables,
    requiredTables: parseSchemaTableNames(translateSchemaForD1(schema, qualifier)),
    qualifier,
  })
  if (plan.action === 'skip') {
    console.log(`D1 database ${database} already carries the required tables; skipping (no data wiped).`)
    return
  }
  console.log(`-> Applying sql/schema.sql to D1 database ${database}...`)
  try {
    applySchema(database, plan.sql, defaultWranglerRunner)
  } catch (error) {
    fail(error.message)
  }
  console.log(`Applied the D1 schema to ${database}.`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
