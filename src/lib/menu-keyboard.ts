export function wrapIndex(index: number, count: number): number {
  return ((index % count) + count) % count
}

export interface RovingMenuKeys {
  /** Number of focusable items in the menu. */
  count: number
  getIndex: () => number
  /** Move roving focus to a wrapped index. */
  moveTo: (index: number) => void
  /** Close the menu (Tab only; focus handling stays with the caller). */
  close: () => void
}

/**
 * Arrow/Home/End/Tab handling shared by radio-style dropdown menus.
 * Arrow keys wrap; Tab closes without preventDefault so focus moves on.
 */
export function handleRovingMenuKeydown(event: KeyboardEvent, keys: RovingMenuKeys): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    keys.moveTo(wrapIndex(keys.getIndex() + 1, keys.count))
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    keys.moveTo(wrapIndex(keys.getIndex() - 1, keys.count))
  } else if (event.key === 'Home') {
    event.preventDefault()
    keys.moveTo(0)
  } else if (event.key === 'End') {
    event.preventDefault()
    keys.moveTo(keys.count - 1)
  } else if (event.key === 'Tab') {
    keys.close()
  }
}
