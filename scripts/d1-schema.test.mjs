import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { translateSchemaForD1 } from './d1-schema.mjs'

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
