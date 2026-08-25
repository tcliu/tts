import { describe, expect, it } from 'vitest'
import { MAX_UPLOAD_BYTES, readTextFile } from './upload-text'

describe('readTextFile', () => {
  it('reads a small text file', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    await expect(readTextFile(file)).resolves.toEqual({ ok: true, text: 'hello' })
  })

  it('rejects text above the byte cap', async () => {
    const file = new File(['a'.repeat(MAX_UPLOAD_BYTES + 1)], 'big.txt')
    await expect(readTextFile(file)).resolves.toEqual({ ok: false, reason: 'too-large' })
  })

  it('rejects by raw size before decoding', async () => {
    const file = new File(['x'], 'huge.bin')
    Object.defineProperty(file, 'size', { value: MAX_UPLOAD_BYTES + 1 })
    file.text = () => {
      throw new Error('must not be read')
    }
    await expect(readTextFile(file)).resolves.toEqual({ ok: false, reason: 'too-large' })
  })

  it('accepts text at the byte cap', async () => {
    const file = new File(['a'.repeat(MAX_UPLOAD_BYTES)], 'edge.txt')
    await expect(readTextFile(file)).resolves.toEqual({ ok: true, text: 'a'.repeat(MAX_UPLOAD_BYTES) })
  })

  it('reports unreadable files', async () => {
    const file = new File(['x'], 'x.txt')
    file.text = () => Promise.reject(new Error('boom'))
    await expect(readTextFile(file)).resolves.toEqual({ ok: false, reason: 'read-failed' })
  })
})
