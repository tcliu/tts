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
    ;(file as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = () => Promise.reject(new Error('boom'))
    await expect(readTextFile(file)).resolves.toEqual({ ok: false, reason: 'read-failed' })
  })

  it('rejects files containing null bytes', async () => {
    const file = new File(['a\x00b'], 'bin.txt')
    await expect(readTextFile(file)).resolves.toEqual({ ok: false, reason: 'binary' })
  })

  it('rejects files with disallowed control characters', async () => {
    const file = new File(['a\x01b'], 'ctrl.bin')
    await expect(readTextFile(file)).resolves.toEqual({ ok: false, reason: 'binary' })
  })

  it('rejects files with invalid UTF-8 sequences', async () => {
    const bytes = new Uint8Array([0x61, 0xc3, 0x28, 0x62])
    const file = new File([bytes], 'bad.txt')
    await expect(readTextFile(file)).resolves.toEqual({ ok: false, reason: 'binary' })
  })

  it('accepts text with tabs, newlines, form feeds, and non-ASCII characters', async () => {
    const content = 'a\tb\nc\r\nd\x0ce — 中文 \u{1F600}'
    const file = new File([content], 'text.txt')
    await expect(readTextFile(file)).resolves.toEqual({ ok: true, text: content })
  })
})
