#!/usr/bin/env node
// Bounded-concurrency task runner for operator scripts: runs async task
// functions with at most `limit` in flight and preserves result order.
// The first error stops new tasks from starting; every in-flight task still
// settles (no unhandled rejections), then the first error is rethrown. A
// re-run is safe because every caller only issues idempotent upserts.
export async function runWithConcurrency(tasks, limit = 4) {
  const results = new Array(tasks.length)
  const workerCount = Math.min(Math.max(1, limit), tasks.length)
  if (workerCount === 0) {
    return results
  }
  let next = 0
  let firstError = null
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        if (firstError) {
          return
        }
        const index = next
        next += 1
        if (index >= tasks.length) {
          return
        }
        try {
          results[index] = await tasks[index]()
        } catch (error) {
          if (!firstError) {
            firstError = error
          }
          return
        }
      }
    }),
  )
  if (firstError) {
    throw firstError
  }
  return results
}
