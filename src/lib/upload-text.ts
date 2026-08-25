export const MAX_UPLOAD_BYTES = 1024 * 1024

// C0 controls except tab/newline/carriage-return/form-feed, plus DEL and the
// UTF-8 replacement character (invalid byte sequences decode to it).
const NON_TEXT_PATTERN = /[\u0000-\u0008\u000B\u000E-\u001F\u007F\uFFFD]/

export type UploadReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'too-large' | 'read-failed' | 'binary' }

export async function readTextFile(file: File): Promise<UploadReadResult> {
  // Cheap pre-filter on raw bytes so oversized picks never get decoded.
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: 'too-large' }
  }
  let text: string
  try {
    text = await file.text()
  } catch {
    return { ok: false, reason: 'read-failed' }
  }
  if (NON_TEXT_PATTERN.test(text)) {
    return { ok: false, reason: 'binary' }
  }
  if (new TextEncoder().encode(text).byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: 'too-large' }
  }
  return { ok: true, text }
}
