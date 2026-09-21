#!/usr/bin/env node
// Translates `sql/schema.sql` (Postgres-first source of truth, never edited
// for D1) into D1/SQLite DDL for the optional Cloudflare D1 backend: drops
// the CREATE SCHEMA line, strips the `"project-catalog".` qualifier (D1 has
// no ATTACH alias), maps `timestamptz` to TEXT (ISO-8601 strings sort
// lexicographically, which is what `max(updated_at)` and the history ordering
// rely on) and `now()` to CURRENT_TIMESTAMP. Prints to stdout; pipe into
// `wrangler d1 execute <database> --file -` or save the output for review.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function translateSchemaForD1(schema) {
  return schema
    .split('\n')
    .filter(line => !/^\s*create\s+schema\b/i.test(line))
    .join('\n')
    .replace(/"project-catalog"\./g, '')
    .replace(/\btimestamptz\b/gi, 'TEXT')
    .replace(/now\(\)/gi, 'CURRENT_TIMESTAMP')
}

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const translated = translateSchemaForD1(readFileSync(join(ROOT_DIR, 'sql', 'schema.sql'), 'utf8'))
  process.stdout.write(translated)
  if (!translated.endsWith('\n')) {
    process.stdout.write('\n')
  }
}
