import { Pool, type PoolClient } from '@neondatabase/serverless'
import { logEvent } from './logging'
import type { Db, DbQuery, DbResult } from './db-types'

function toSchemaName(value: string): string | null {
  const schemaName = value.trim()
  if (!schemaName) return null
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schemaName)) {
    throw new Error(`Invalid SCHEMA_NAME: ${schemaName}`)
  }
  return schemaName
}

let pool: Pool | null = null

function getSchemaName(): string | null {
  return toSchemaName(process.env.SCHEMA_NAME || '')
}

function getPool() {
  if (pool) return pool

  const databaseURL = (process.env.DATABASE_URL || '').trim()
  if (!databaseURL) {
    throw new Error('Missing DATABASE_URL for database access')
  }

  pool = new Pool({
    connectionString: databaseURL,
    max: 10,
  })

  return pool
}

async function ensureSearchPath(client: PoolClient): Promise<void> {
  const schemaName = getSchemaName()
  if (!schemaName) {
    return
  }
  try {
    await client.query(`set search_path to "${schemaName}"`)
  } catch (error) {
    logEvent({
      ip: 'server',
      action: 'db_search_path_error',
      details: { schema: schemaName, error: error instanceof Error ? error.message : 'Unknown error', level: 'ERROR' },
    })
    throw error
  }
}

export function createNeonDb(): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<DbResult<T>> {
      const client = await getPool().connect()
      try {
        await ensureSearchPath(client)
        const result = await client.query(sql, params)
        return { rows: result.rows as T[], rowCount: result.rowCount }
      } finally {
        client.release()
      }
    },
    async transaction<T>(fn: (query: DbQuery) => Promise<T>): Promise<T> {
      const client = await getPool().connect()
      try {
        await ensureSearchPath(client)
        await client.query('begin')
        const result = await fn(async <R>(sql: string, params: unknown[] = []) => {
          const res = await client.query(sql, params)
          return { rows: res.rows as R[], rowCount: res.rowCount }
        })
        await client.query('commit')
        return result
      } catch (error) {
        await client.query('rollback').catch(() => {})
        throw error
      } finally {
        client.release()
      }
    },
    async close() {
      if (!pool) return
      await pool.end()
      pool = null
    },
  }
}
