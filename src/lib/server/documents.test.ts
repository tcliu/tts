import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  deleteUserDocument,
  listUserDocuments,
  normalizeDocumentId,
  normalizeDocumentName,
  upsertUserDocument,
} from './documents'
import { createUser } from './users'
import { closeDb } from './db'

let sqlitePath = ''
let savedSqlitePath: string | undefined

beforeEach(async () => {
  savedSqlitePath = process.env.SQLITE_PATH
  sqlitePath = path.join(await mkdtemp(path.join(tmpdir(), 'user-docs-')), 'test.sqlite')
  process.env.SQLITE_PATH = sqlitePath
})

afterEach(async () => {
  await closeDb()
  if (savedSqlitePath === undefined) {
    delete process.env.SQLITE_PATH
  } else {
    process.env.SQLITE_PATH = savedSqlitePath
  }
  await rm(path.dirname(sqlitePath), { recursive: true, force: true })
})

async function createTestUser(username: string): Promise<number> {
  const user = await createUser({ username, email: `${username}@example.com`, password: 's3cret-password' })
  return user.id
}

describe('user documents', () => {
  it('round-trips documents scoped to the owning user', async () => {
    const userId = await createTestUser('docowner')
    const otherId = await createTestUser('otherowner')
    await upsertUserDocument(userId, { id: 'abc123', name: 'Notes', content: 'hello', updatedAt: 1000 })
    await upsertUserDocument(otherId, { id: 'abc123', name: 'Other', content: 'other', updatedAt: 2000 })

    const documents = await listUserDocuments(userId)
    expect(documents).toEqual([{ id: 'abc123', name: 'Notes', content: 'hello', updatedAt: 1000 }])
  })

  it('overwrites the same doc id on re-save', async () => {
    const userId = await createTestUser('resaver')
    await upsertUserDocument(userId, { id: 'doc1', name: 'Notes', content: 'first', updatedAt: 1000 })
    const saved = await upsertUserDocument(userId, { id: 'doc1', name: 'Notes', content: 'second', updatedAt: 2000 })
    expect(saved.content).toBe('second')
    expect(await listUserDocuments(userId)).toHaveLength(1)
  })

  it('lists most recently updated first', async () => {
    const userId = await createTestUser('sorter')
    await upsertUserDocument(userId, { id: 'old', name: 'Old', content: 'a', updatedAt: 1000 })
    await upsertUserDocument(userId, { id: 'new', name: 'New', content: 'b', updatedAt: 2000 })
    expect((await listUserDocuments(userId)).map(document => document.id)).toEqual(['new', 'old'])
  })

  it('deletes only the owning user document', async () => {
    const userId = await createTestUser('deleter')
    const otherId = await createTestUser('keeper')
    await upsertUserDocument(userId, { id: 'doc1', name: 'Notes', content: 'x', updatedAt: 1000 })
    await upsertUserDocument(otherId, { id: 'doc1', name: 'Notes', content: 'x', updatedAt: 1000 })
    expect(await deleteUserDocument(userId, 'doc1')).toBe(true)
    expect(await deleteUserDocument(userId, 'doc1')).toBe(false)
    expect(await listUserDocuments(otherId)).toHaveLength(1)
  })

  it('rejects invalid document fields', async () => {
    const userId = await createTestUser('validator')
    await expect(upsertUserDocument(userId, { id: '', name: 'N', content: '', updatedAt: 1 })).rejects.toThrow()
    await expect(upsertUserDocument(userId, { id: 'a', name: '  ', content: '', updatedAt: 1 })).rejects.toThrow()
    await expect(
      upsertUserDocument(userId, { id: 'a', name: 'N', content: '', updatedAt: Number.NaN }),
    ).rejects.toThrow()
    expect(normalizeDocumentId(' doc1 ')).toBe('doc1')
    expect(normalizeDocumentName(' Notes ')).toBe('Notes')
  })
})
