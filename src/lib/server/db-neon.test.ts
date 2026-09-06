import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockConnect, MockPool } = vi.hoisted(() => {
  const mockConnect = vi.fn()
  class MockPool {
    constructor(..._args: unknown[]) {}
    async query(): Promise<never> {
      throw new Error('pool.query must not be used: gate search_path on a checked-out client')
    }
    async connect() {
      return mockConnect()
    }
    async end() {}
  }
  return { mockConnect, MockPool }
})

vi.mock('@neondatabase/serverless', () => ({ Pool: MockPool }))

import { createNeonDb } from './db-neon'

let savedDatabaseUrl: string | undefined
let savedSchemaName: string | undefined

beforeEach(() => {
  savedDatabaseUrl = process.env.DATABASE_URL
  savedSchemaName = process.env.SCHEMA_NAME
  process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/tts'
  mockConnect.mockReset()
})

afterEach(() => {
  if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = savedDatabaseUrl
  if (savedSchemaName === undefined) delete process.env.SCHEMA_NAME
  else process.env.SCHEMA_NAME = savedSchemaName
})

function stubClient(seen: string[]) {
  mockConnect.mockResolvedValue({
    query: vi.fn(async (sql: string) => {
      seen.push(sql)
      return { rows: [], rowCount: 0 }
    }),
    release: vi.fn(),
  })
}

describe('neon search_path gating', () => {
  it('sets search_path on the checked-out client before the query', async () => {
    process.env.SCHEMA_NAME = 'tts'
    const seen: string[] = []
    stubClient(seen)
    const db = createNeonDb()
    try {
      await db.query('select 1')
    } finally {
      await db.close()
    }
    expect(seen).toEqual([expect.stringMatching(/search_path/), 'select 1'])
  })

  it('sets search_path before begin in transactions', async () => {
    process.env.SCHEMA_NAME = 'tts'
    const seen: string[] = []
    stubClient(seen)
    const db = createNeonDb()
    try {
      const result = await db.transaction(async query => {
        await query('select 1')
        return 'ok'
      })
      expect(result).toBe('ok')
    } finally {
      await db.close()
    }
    expect(seen).toEqual([expect.stringMatching(/search_path/), 'begin', 'select 1', 'commit'])
  })

  it('skips search_path when SCHEMA_NAME is unset', async () => {
    delete process.env.SCHEMA_NAME
    const seen: string[] = []
    stubClient(seen)
    const db = createNeonDb()
    try {
      await db.query('select 1')
    } finally {
      await db.close()
    }
    expect(seen).toEqual(['select 1'])
  })
})
