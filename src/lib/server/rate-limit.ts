const WINDOW_MS = 60_000
const MAX_REQUESTS = 20

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

function gc() {
  const now = Date.now()
  for (const [key, bucket] of buckets) if (now >= bucket.resetAt) buckets.delete(key)
}

let gcTimer: ReturnType<typeof setInterval> | undefined
function ensureGc() {
  if (gcTimer) return
  gcTimer = setInterval(gc, WINDOW_MS)
  if (typeof gcTimer === 'object' && gcTimer != null && 'unref' in gcTimer) (gcTimer as unknown as { unref(): void }).unref()
}

export function isRateLimited(ip: string): boolean {
  ensureGc()
  const now = Date.now()
  const bucket = buckets.get(ip)
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  if (bucket.count >= MAX_REQUESTS) return true
  bucket.count += 1
  return false
}

export function resetRateLimit() {
  buckets.clear()
}
