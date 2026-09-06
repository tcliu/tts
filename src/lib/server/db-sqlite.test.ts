import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSqliteDb } from './db-sqlite'

let sqlitePath = ''
let savedSqlitePath: string | undefined

beforeEach(async () => {
  savedSqlitePath = process.env.SQLITE_PATH
  sqlitePath = path.join(await mkdtemp(path.join(tmpdir(), 'db-schema-')), 'test.sqlite')
})

afterEach(async () => {
  if (savedSqlitePath === undefined) delete process.env.SQLITE_PATH
  else process.env.SQLITE_PATH = savedSqlitePath
  await rm(path.dirname(sqlitePath), { recursive: true, force: true })
})

describe('sqlite schema bootstrap', () => {
  it('applies sql/schema.sql on boot', async () => {
    const db = await createSqliteDb(sqlitePath)
    try {
      const result = await db.query<{ name: string }>(
        "select name from sqlite_master where type = 'table' and name = 'users'",
      )
      expect(result.rows).toHaveLength(1)
    } finally {
      await db.close()
    }
  })
})
