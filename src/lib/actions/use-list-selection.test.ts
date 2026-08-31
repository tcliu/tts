import { afterEach, describe, expect, it, vi } from 'vitest'
import { revealInScrollport, useListSelection } from './use-list-selection.svelte'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useListSelection', () => {
  it('clamps set() below zero', () => {
    const selection = useListSelection()
    selection.set(-1)
    expect(selection.index).toBe(0)
  })

  it('advances on back-to-back moves without waiting for a state flush', () => {
    // OS key auto-repeat fires keydowns faster than Svelte flushes $state;
    // the next move must see the previous move's result synchronously.
    const selection = useListSelection()
    selection.move('down', 3)
    expect(selection.peek()).toBe(1)
    selection.move('down', 3)
    expect(selection.peek()).toBe(2)
    selection.move('down', 3)
    expect(selection.peek()).toBe(0)
  })

  it('peek tracks the latest value even when the reactive index is unflushed', () => {
    const selection = useListSelection()
    selection.set(1)
    // Both the reactive projection and the synchronous peek agree.
    expect(selection.index).toBe(1)
    expect(selection.peek()).toBe(1)
  })

  it('moves down and wraps modulo count', () => {
    const selection = useListSelection()
    selection.move('down', 3)
    selection.move('down', 3)
    expect(selection.index).toBe(2)
    selection.move('down', 3)
    expect(selection.index).toBe(0)
  })

  it('moves up and wraps modulo count', () => {
    const selection = useListSelection(2)
    selection.move('up', 3)
    expect(selection.index).toBe(1)
    selection.move('up', 3)
    expect(selection.index).toBe(0)
    selection.move('up', 3)
    expect(selection.index).toBe(2)
  })

  it('moves to first and last', () => {
    const selection = useListSelection()
    selection.move('last', 5)
    expect(selection.index).toBe(4)
    selection.move('first', 5)
    expect(selection.index).toBe(0)
  })

  it('is a no-op when count is zero', () => {
    const selection = useListSelection(3)
    selection.move('down', 0)
    selection.move('up', 0)
    selection.move('first', 0)
    selection.move('last', 0)
    expect(selection.index).toBe(3)
  })

  it('syncs to the first matching active option', () => {
    const selection = useListSelection()
    const options = ['a', 'b', 'c']
    selection.syncToActive(options, option => option === 'b')
    expect(selection.index).toBe(1)
  })

  it('falls back to the first option when none matches', () => {
    const selection = useListSelection()
    selection.set(2)
    selection.syncToActive(['a', 'b'], () => false)
    expect(selection.index).toBe(0)
  })
})

describe('revealInScrollport', () => {
  it('scrolls the option into the nearest scrollport', () => {
    const option = document.createElement('button')
    const scrollIntoView = vi.fn()
    option.scrollIntoView = scrollIntoView
    revealInScrollport(option)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('tolerates null and undefined', () => {
    expect(() => revealInScrollport(null)).not.toThrow()
    expect(() => revealInScrollport(undefined)).not.toThrow()
  })
})
