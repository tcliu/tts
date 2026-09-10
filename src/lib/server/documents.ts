import { getDb } from './db'

export interface UserDocument {
  id: string
  name: string
  content: string
  updatedAt: number
}

export const MAX_DOCUMENT_ID_LENGTH = 64
export const MAX_DOCUMENT_NAME_LENGTH = 200
export const MAX_DOCUMENT_CONTENT_LENGTH = 1_000_000
export const MAX_DOCUMENTS_PER_USER = 500
export class DocumentValidationError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'DocumentValidationError'
    this.code = code
  }
}

export class DocumentQuotaError extends Error {
  constructor() {
    super('document quota exceeded')
    this.name = 'DocumentQuotaError'
  }
}

interface UserDocumentRow {
  id: string
  name: string
  content: string
  updated_at: number
}

function toUserDocument(row: UserDocumentRow): UserDocument {
  return { id: row.id, name: row.name, content: row.content, updatedAt: Number(row.updated_at) }
}

export function normalizeDocumentId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new DocumentValidationError('document_id_required', 'document id is required')
  }
  const id = value.trim()
  if (!id) {
    throw new DocumentValidationError('document_id_required', 'document id is required')
  }
  if (id.length > MAX_DOCUMENT_ID_LENGTH) {
    throw new DocumentValidationError(
      'document_id_too_long',
      `document id must not exceed ${MAX_DOCUMENT_ID_LENGTH} characters`,
    )
  }
  return id
}

export function normalizeDocumentName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new DocumentValidationError('document_name_required', 'document name is required')
  }
  const name = value.trim()
  if (!name) {
    throw new DocumentValidationError('document_name_required', 'document name is required')
  }
  if (name.length > MAX_DOCUMENT_NAME_LENGTH) {
    throw new DocumentValidationError(
      'document_name_too_long',
      `document name must not exceed ${MAX_DOCUMENT_NAME_LENGTH} characters`,
    )
  }
  return name
}

export function normalizeDocumentContent(value: unknown): string {
  if (typeof value !== 'string') {
    throw new DocumentValidationError('document_content_invalid', 'document content must be a string')
  }
  if (value.length > MAX_DOCUMENT_CONTENT_LENGTH) {
    throw new DocumentValidationError(
      'document_content_too_long',
      `document content must not exceed ${MAX_DOCUMENT_CONTENT_LENGTH} characters`,
    )
  }
  return value
}

export function normalizeDocumentUpdatedAt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new DocumentValidationError('document_updated_at_invalid', 'document updated_at must be a valid timestamp')
  }
  return Math.floor(value)
}

export async function listUserDocuments(userId: number): Promise<UserDocument[]> {
  const db = await getDb()
  const result = await db.query<UserDocumentRow>(
    'select id, name, content, updated_at from user_documents where user_id = $1 order by updated_at desc limit $2',
    [userId, MAX_DOCUMENTS_PER_USER],
  )
  return result.rows.map(toUserDocument)
}

export async function upsertUserDocument(
  userId: number,
  input: { id: unknown; name: unknown; content: unknown; updatedAt: unknown },
): Promise<UserDocument> {
  const { id, name, content, updatedAt } = input
  const document = {
    id: normalizeDocumentId(id),
    name: normalizeDocumentName(name),
    content: normalizeDocumentContent(content),
    updatedAt: normalizeDocumentUpdatedAt(updatedAt),
  }
  const db = await getDb()
  return db.transaction(async query => {
    const existing = await query<{ id: string }>('select id from user_documents where user_id = $1 and id = $2', [userId, document.id])
    if (existing.rows.length === 0) {
      const count = await query<{ count: number }>('select count(*) as count from user_documents where user_id = $1', [userId])
      if (Number(count.rows[0]?.count ?? 0) >= MAX_DOCUMENTS_PER_USER) {
        throw new DocumentQuotaError()
      }
    }
    const result = await query<UserDocumentRow>(
      `insert into user_documents (user_id, id, name, content, updated_at)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id, id) do update set name = excluded.name, content = excluded.content, updated_at = excluded.updated_at
       returning id, name, content, updated_at`,
      [userId, document.id, document.name, document.content, document.updatedAt],
    )
    return toUserDocument(result.rows[0])
  })
}

export async function deleteUserDocument(userId: number, id: unknown): Promise<boolean> {
  const documentId = normalizeDocumentId(id)
  const db = await getDb()
  const result = await db.query('delete from user_documents where user_id = $1 and id = $2', [userId, documentId])
  return (result.rowCount ?? 0) > 0
}
