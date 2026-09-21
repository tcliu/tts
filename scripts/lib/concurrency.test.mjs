import { describe, expect, it } from 'vitest'

import { runWithConcurrency } from './concurrency.mjs'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('runWithConcurrency', () => {
  it('preserves result order and returns every result', async () => {
    const tasks = [3, 1, 2].map(value => async () => value)
    await expect(runWithConcurrency(tasks, 2)).resolves.toEqual([3, 1, 2])
  })

  it('returns an empty array without running anything', async () => {
    await expect(runWithConcurrency([], 4)).resolves.toEqual([])
  })

  it('never exceeds the limit in flight', async () => {
    let inFlight = 0
    let peak = 0
    const tasks = Array.from({ length: 8 }, () => async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await tick()
      inFlight -= 1
      return true
    })
    await runWithConcurrency(tasks, 3)
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('rejects with the first error after in-flight tasks settle', async () => {
    const settled = []
    const tasks = [
      async () => {
        throw new Error('first failure')
      },
      async () => {
        await tick()
        settled.push('second')
        return 'second'
      },
    ]
    await expect(runWithConcurrency(tasks, 2)).rejects.toThrow('first failure')
    expect(settled).toEqual(['second'])
  })
})
