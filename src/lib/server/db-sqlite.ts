import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Database } from 'better-sqlite3'
import type { Db, DbQuery, DbResult } from './db-types'

export const DEFAULT_SQLITE_PATH = '.data/dev.sqlite'

function isRowsReturningSql(sql: string) {
  return /^\s*(select|with\b)/i.test(sql) || /returning\b/i.test(sql)
}

export function toSqliteSql(sql: string) {
  return sql
    .replace(/\$\d+/g, () => '?')
    .replaceAll('bigserial', 'integer')
    .replaceAll('current_timestamp', "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
}

type SqliteValue = null | number | bigint | string | Uint8Array

function toSqliteParam(value: unknown): SqliteValue {
  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  return value as SqliteValue
}

export async function readSchemaSql() {
  const schemaUrl = new URL('../../../sql/schema.sql', import.meta.url)
  return readFile(fileURLToPath(schemaUrl), 'utf8')
}

export async function createSqliteDb(
  path = process.env.SQLITE_PATH || (process.env.VERCEL === '1' ? '/tmp/dev.sqlite' : DEFAULT_SQLITE_PATH),
): Promise<Db> {
  const { default: Database } = await import('better-sqlite3')
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }

  const database = new Database(path)
  database.exec('PRAGMA foreign_keys = ON')
  const schema = await readSchemaSql()
  database.exec(toSqliteSql(schema))

  // Serializes every statement through a promise chain so a transaction's
  // BEGIN/COMMIT cannot be interleaved by other statements on the same
  // connection (better-sqlite3 is synchronous but our API is async).
  let tail: Promise<unknown> = Promise.resolve()

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  function execute<T>(sql: string, params: unknown[]): DbResult<T> {
    const statement = database.prepare(toSqliteSql(sql))
    const args = params.map(toSqliteParam)
    if (isRowsReturningSql(sql)) {
      const rows = statement.all(...args)
      return { rows: rows as T[], rowCount: rows.length }
    }
    const result = statement.run(...args)
    return { rows: [], rowCount: Number(result.changes) }
  }

  return {
    query<T>(sql: string, params: unknown[] = []): Promise<DbResult<T>> {
      return enqueue(() => Promise.resolve(execute<T>(sql, params)))
    },
    async transaction<T>(fn: (query: DbQuery) => Promise<T>): Promise<T> {
      return enqueue(async () => {
        database.exec('BEGIN')
        try {
          const result = await fn(async <R>(sql: string, params: unknown[] = []) => execute<R>(sql, params))
          database.exec('COMMIT')
          return result
        } catch (error) {
          database.exec('ROLLBACK')
          throw error
        }
      })
    },
    async close(): Promise<void> {
      await enqueue(async () => {
        database.close()
      })
    },
  }
}
