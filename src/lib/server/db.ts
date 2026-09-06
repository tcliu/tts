import type { Db } from './db-types'
import { createNeonDb } from './db-neon'
import { createSqliteDb } from './db-sqlite'
import { resolveProfile } from './profile'

let db: Db | null = null
let dbPromise: Promise<Db> | null = null

export async function getDb(): Promise<Db> {
  if (db) {
    return db
  }
  if (dbPromise) {
    return dbPromise
  }

  dbPromise = (async () => {
    // Production is Neon and never runs DDL on boot; apply sql/schema.sql
    // explicitly with `PROFILE=prod npm run schema:apply`. Dev is SQLite
    // and auto-applies the schema on boot.
    const initialized = resolveProfile() === 'prod' ? createNeonDb() : await createSqliteDb()
    db = initialized
    return initialized
  })()

  try {
    return await dbPromise
  } finally {
    dbPromise = null
  }
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.close()
    db = null
  }
}
