import { describe, expect, it, vi } from 'vitest'
import { handleRovingMenuKeydown, wrapIndex } from './menu-keyboard'

describe('wrapIndex', () => {
  it('wraps negative and overflow indices into range', () => {
    expect(wrapIndex(-1, 3)).toBe(2)
    expect(wrapIndex(3, 3)).toBe(0)
    expect(wrapIndex(1, 3)).toBe(1)
  })
})

describe('handleRovingMenuKeydown', () => {
  function makeKeys(count = 3) {
    let index = 1
    const moves: number[] = []
    return {
      keys: {
        count,
        getIndex: () => index,
        moveTo: (next: number) => {
          index = next
          moves.push(next)
        },
        close: () => {},
      },
      lastMove: () => moves[moves.length - 1],
    }
  }

  it('moves forward with wrap-around on ArrowDown', () => {
    const { keys, lastMove } = makeKeys()
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })
    handleRovingMenuKeydown(event, keys)
    expect(lastMove()).toBe(2)
    expect(event.defaultPrevented).toBe(true)
  })

  it('moves backward with wrap-around on ArrowUp', () => {
    const { keys, lastMove } = makeKeys()
    handleRovingMenuKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }), keys)
    expect(lastMove()).toBe(0)
  })

  it('jumps to first and last on Home and End', () => {
    const home = makeKeys()
    handleRovingMenuKeydown(new KeyboardEvent('keydown', { key: 'Home' }), home.keys)
    expect(home.lastMove()).toBe(0)

    const end = makeKeys()
    handleRovingMenuKeydown(new KeyboardEvent('keydown', { key: 'End' }), end.keys)
    expect(end.lastMove()).toBe(2)
  })

  it('closes on Tab without preventing default', () => {
    const { keys } = makeKeys()
    const close = vi.spyOn(keys, 'close')
    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
    handleRovingMenuKeydown(event, keys)
    expect(close).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(false)
  })

  it('ignores unrelated keys', () => {
    const { keys, lastMove } = makeKeys()
    const close = vi.spyOn(keys, 'close')
    handleRovingMenuKeydown(new KeyboardEvent('keydown', { key: 'Escape' }), keys)
    expect(lastMove()).toBeUndefined()
    expect(close).not.toHaveBeenCalled()
  })
})
