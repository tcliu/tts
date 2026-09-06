import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('$app/environment', () => ({ browser: true }))
vi.mock('$app/paths', () => ({ base: '' }))

import { buildDocUrl, lastDocUrl, parseDocId, pushDocHistory, readLastDocId, rememberDocId, replaceDocHistory } from './document-history'

describe('document-history', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  it('builds the base url for a fresh buffer', () => {
    expect(buildDocUrl(null)).toBe('/')
  })

  it('builds a path of {base}/{docId} for a document', () => {
    expect(buildDocUrl('abc-123')).toBe('/abc-123')
  })

  it('encodes document ids that are not url-safe', () => {
    expect(buildDocUrl('a/b?c')).toBe('/a%2Fb%3Fc')
  })

  it('round-trips a document id through parseDocId', () => {
    window.history.replaceState(null, '', '/abc-123')
    expect(parseDocId()).toBe('abc-123')
  })

  it('returns null from parseDocId on the base path', () => {
    window.history.replaceState(null, '', '/')
    expect(parseDocId()).toBeNull()
  })

  it('pushes a history entry when the url changes', () => {
    window.history.replaceState(null, '', '/')
    const spy = vi.spyOn(window.history, 'pushState')
    pushDocHistory('doc-1')
    expect(spy).toHaveBeenCalledOnce()
    expect(window.location.pathname).toBe('/doc-1')
  })

  it('does not push a duplicate entry for the current url', () => {
    window.history.replaceState(null, '', '/doc-1')
    const spy = vi.spyOn(window.history, 'pushState')
    pushDocHistory('doc-1')
    expect(spy).not.toHaveBeenCalled()
  })

  it('replaces state without adding a history entry', () => {
    window.history.replaceState(null, '', '/')
    const spy = vi.spyOn(window.history, 'replaceState')
    replaceDocHistory('doc-2')
    expect(spy).toHaveBeenCalledOnce()
    expect(window.location.pathname).toBe('/doc-2')
  })

  it('strips a trailing slash from the docId', () => {
    window.history.replaceState(null, '', '/Ab3xZ9/')
    expect(parseDocId()).toBe('Ab3xZ9')
  })

  it('returns the raw id when decodeURIComponent would throw', () => {
    window.history.replaceState(null, '', '/%ZZ')
    expect(parseDocId()).toBe('%ZZ')
  })

  it('remembers the active doc id on push', () => {
    window.history.replaceState(null, '', '/')
    pushDocHistory('doc-1')
    expect(readLastDocId()).toBe('doc-1')
  })

  it('clears the remembered doc id for a fresh buffer', () => {
    rememberDocId('doc-1')
    window.history.replaceState(null, '', '/doc-1')
    pushDocHistory(null)
    expect(readLastDocId()).toBeNull()
  })

  it('remembers the active doc id on replace', () => {
    window.history.replaceState(null, '', '/')
    replaceDocHistory('doc-2')
    expect(readLastDocId()).toBe('doc-2')
  })

  it('persists even when the url already shows the doc', () => {
    window.history.replaceState(null, '', '/doc-9')
    pushDocHistory('doc-9')
    expect(readLastDocId()).toBe('doc-9')
  })

  it('falls back to the editor root without a remembered doc', () => {
    expect(lastDocUrl()).toBe('/')
  })

  it('builds the remembered doc url', () => {
    rememberDocId('doc-7')
    expect(lastDocUrl()).toBe('/doc-7')
  })
})
