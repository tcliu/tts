#!/usr/bin/env node
// Translates `sql/schema.sql` (Postgres-first source of truth, never edited
// for D1) into D1/SQLite DDL for the optional Cloudflare D1 backend: drops
// the CREATE SCHEMA line, strips the caller's schema qualifier when one is
// passed (D1 has no ATTACH alias), maps `timestamptz` to TEXT (ISO-8601 strings
// sort lexicographically, which is what `max(updated_at)` and the history
// ordering rely on) and `now()` to CURRENT_TIMESTAMP. Prints to stdout; pipe into
// `wrangler d1 execute <database> --remote --file schema.sql` or save the output for review.
// Schemas with a qualifier (e.g. `"myapp".`) pass D1_SCHEMA_QUALIFIER in the
// environment so the standalone output matches what planD1Bootstrap applies;
// apply-d1-schema.mjs passes its qualifier explicitly instead.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function translateSchemaForD1(schema, qualifier = '') {
  const unqualified = qualifier ? String(schema).split(qualifier).join('') : String(schema)
  return unqualified
    .split('\n')
    .filter(line => !/^\s*create\s+schema\b/i.test(line))
    .join('\n')
    .replace(/\btimestamptz\b/gi, 'TEXT')
    .replace(/now\(\)/gi, 'CURRENT_TIMESTAMP')
}

// Tables that must exist for the app to serve. A D1 database missing any is
// fresh and needs bootstrapping; the translated schema drops and recreates
// tables, so it must never run against a populated database. `requiredTables`
// is per-app (callers pass their own table names); shared code owns no schema.
export function needsD1Bootstrap(existingTables = [], requiredTables = []) {
  const present = new Set(existingTables.map(name => String(name).trim()))
  return requiredTables.some(table => !present.has(table))
}

// Bootstrap decision for apply-d1-schema.mjs: apply the translated schema only
// when a required table is missing, otherwise skip so existing rows survive.
export function planD1Bootstrap({ schema, existingTables = [], requiredTables = [], qualifier = '' }) {
  return needsD1Bootstrap(existingTables, requiredTables)
    ? { action: 'apply', sql: translateSchemaForD1(schema, qualifier) }
    : { action: 'skip', sql: '' }
}

// Table names from `wrangler d1 execute --json` output (`[{ results: [{ name }] }]`).
export function parseD1TableNames(output) {
  let parsed
  try {
    parsed = JSON.parse(String(output || ''))
  } catch {
    throw new Error('Could not parse `wrangler d1 execute --json` output.')
  }
  const rows = Array.isArray(parsed) ? parsed.flatMap(entry => entry?.results ?? []) : []
  return rows.map(row => String(row?.name || '').trim()).filter(Boolean)
}

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const translated = translateSchemaForD1(
    readFileSync(join(ROOT_DIR, 'sql', 'schema.sql'), 'utf8'),
    process.env.D1_SCHEMA_QUALIFIER || '',
  )
  process.stdout.write(translated)
  if (!translated.endsWith('\n')) {
    process.stdout.write('\n')
  }
}
