import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { needsD1Bootstrap, parseD1TableNames, planD1Bootstrap, translateSchemaForD1 } from './d1-schema.mjs'

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const schema = readFileSync(join(ROOT_DIR, 'sql', 'schema.sql'), 'utf8')

describe('translateSchemaForD1', () => {
  it('strips Postgres-only types and defaults', () => {
    const ddl = translateSchemaForD1(schema)
    expect(ddl).not.toMatch(/timestamptz/i)
    expect(ddl).not.toMatch(/now\(\)/i)
    expect(ddl).toContain('create table if not exists users (')
    expect(ddl).toMatch(/current_timestamp/i)
  })

  it('strips a caller-supplied schema qualifier and nothing otherwise', () => {
    const qualified = 'create table "myapp".widgets (id integer);\nselect "myapp".x;'
    expect(translateSchemaForD1(qualified, '"myapp".')).not.toContain('"myapp".')
    expect(translateSchemaForD1(qualified)).toContain('"myapp".')
  })

  it('applies cleanly to SQLite with the app tables', () => {
    const db = new Database(':memory:')
    try {
      db.exec(translateSchemaForD1(schema))
      const tables = db
        .prepare(`select name from sqlite_master where type = 'table' order by name`)
        .all()
        .map(row => row.name)
        .sort()
      expect(tables).toEqual(['login_attempts', 'user_documents', 'users'])
    } finally {
      db.close()
    }
  })
})

const REQUIRED_TABLES = ['login_attempts', 'user_documents', 'users']

describe('needsD1Bootstrap', () => {
  it('bootstraps a fresh or partial database', () => {
    expect(needsD1Bootstrap([], REQUIRED_TABLES)).toBe(true)
    expect(needsD1Bootstrap(['users'], REQUIRED_TABLES)).toBe(true)
  })

  it('skips a populated database', () => {
    expect(needsD1Bootstrap(REQUIRED_TABLES, REQUIRED_TABLES)).toBe(false)
  })
})

describe('planD1Bootstrap', () => {
  it('returns translated SQL only when bootstrapping', () => {
    const fresh = planD1Bootstrap({ schema, existingTables: [], requiredTables: REQUIRED_TABLES })
    expect(fresh.action).toBe('apply')
    expect(fresh.sql).toContain('create table')
    const populated = planD1Bootstrap({ schema, existingTables: REQUIRED_TABLES, requiredTables: REQUIRED_TABLES })
    expect(populated).toEqual({ action: 'skip', sql: '' })
  })
})

describe('parseD1TableNames', () => {
  it('reads table names from wrangler --json output', () => {
    expect(parseD1TableNames(JSON.stringify([{ results: [{ name: 'users' }, { name: 'user_documents' }] }])))
      .toEqual(['users', 'user_documents'])
    expect(parseD1TableNames('[]')).toEqual([])
  })

  it('throws on non-JSON output', () => {
    expect(() => parseD1TableNames('not json')).toThrow(/parse/)
  })
})
