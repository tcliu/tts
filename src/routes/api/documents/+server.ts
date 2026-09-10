import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { DocumentQuotaError, DocumentValidationError, deleteUserDocument, listUserDocuments, upsertUserDocument } from '$lib/server/documents'
import { getRequestIp, logEvent } from '$lib/server/logging'

function toWire(document: { id: string; name: string; content: string; updatedAt: number }) {
  return { id: document.id, name: document.name, content: document.content, updated_at: document.updatedAt }
}
function toErrorResponse(error: unknown): { body: { error: string }; status: number } {
  if (error instanceof DocumentValidationError) {
    return { body: { error: error.code }, status: 400 }
  }
  if (error instanceof DocumentQuotaError) {
    return { body: { error: 'document_quota_exceeded' }, status: 409 }
  }
  return { body: { error: 'failed_to_save_document' }, status: 500 }
}

export const GET: RequestHandler = async ({ locals }) => {
  const user = locals.user
  if (!user) {
    return json({ error: 'session_required' }, { status: 401 })
  }
  const documents = await listUserDocuments(user.id)
  return json({ documents: documents.map(toWire) })
}

export const PUT: RequestHandler = async event => {
  const { locals, request } = event
  const user = locals.user
  if (!user) {
    return json({ error: 'session_required' }, { status: 401 })
  }
  const ip = getRequestIp(event)
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return json({ error: 'invalid_request' }, { status: 400 })
  }
  const record = body as { id?: unknown; name?: unknown; content?: unknown; updated_at?: unknown }
  try {
    const saved = await upsertUserDocument(user.id, {
      id: record.id,
      name: record.name,
      content: record.content,
      updatedAt: record.updated_at,
    })
    logEvent({
      ip,
      action: 'user_document_save',
      details: { username: user.username, document_id: saved.id, content_length: saved.content.length },
    })
    return json({ document: toWire(saved) })
  } catch (error) {
    const response = toErrorResponse(error)
    if (response.status === 500) {
      logEvent({ ip, action: 'user_document_save_error', details: { username: user.username, level: 'ERROR' } })
    }
    return json(response.body, { status: response.status })
  }
}

export const DELETE: RequestHandler = async event => {
  const { locals, url } = event
  const user = locals.user
  if (!user) {
    return json({ error: 'session_required' }, { status: 401 })
  }
  const ip = getRequestIp(event)
  const id = url.searchParams.get('id') ?? ''
  try {
    const deleted = await deleteUserDocument(user.id, id)
    if (!deleted) {
      return json({ error: 'document_not_found' }, { status: 404 })
    }
    logEvent({ ip, action: 'user_document_delete', details: { username: user.username, document_id: id.trim() } })
    return json({ ok: true })
  } catch (error) {
    if (error instanceof DocumentValidationError) {
      return json({ error: error.code }, { status: 400 })
    }
    logEvent({ ip, action: 'user_document_delete_error', details: { username: user.username, level: 'ERROR' } })
    return json({ error: 'failed_to_delete_document' }, { status: 500 })
  }
}
