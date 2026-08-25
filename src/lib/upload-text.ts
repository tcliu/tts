export const MAX_UPLOAD_BYTES = 1024 * 1024

export type UploadReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'too-large' | 'read-failed' }

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
  if (new TextEncoder().encode(text).byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: 'too-large' }
  }
  return { ok: true, text }
}
