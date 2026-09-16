/**
 * Shared "unconfirmed selection" state for list-style dropdown surfaces.
 * Owns one piece of $state that the caller
 * exposes to mouse hover and arrow-key handlers; the caller still commits
 * the selection itself (calls `onSelect(option)` and closes the panel) when
 * the user clicks or presses Enter. `.svelte.ts` is required so `$state` is
 * scoped to the importing component.
 *
 * Behavior:
 * - `set(i)` floors to `0` (no upper-bound). Use for `onmouseenter={...}` on
 *   options; pair with `clamp(count)` when the option list can shrink.
 * - `clamp(count)` constrains the current index to `[0, count-1]` (or `0`
 *   when `count <= 0`).
 * - `move(dir, count)` wraps modulo `count` (`down = +1`, `up = -1`,
 *   `first = 0`, `last = count - 1`); no-op when `count === 0`. Use for
 *   `ArrowDown` / `ArrowUp` / `Home` / `End`.
 * - `syncToActive(options, isActive)` aligns the index to the first option
 *   matching the active value (falls back to `0`). Use on open so keyboard
 *   and mouse start from the same place.
 * - `reset()` returns to the initial value.
 */
export interface ListSelection {
  readonly index: number
  /** Synchronous (unbatched) read of the current index — for key handlers
   *  that compute the next position themselves (e.g. skipping disabled
   *  items) and must see the latest value even mid-flush. */
  peek(): number
  set(index: number): void
  /** Clamp the current index to the valid range for the current count. */
  clamp(count: number): void
  reset(): void
  move(direction: 'up' | 'down' | 'first' | 'last', count: number): void
  syncToActive<T>(options: readonly T[], isActive: (option: T) => boolean): void
}

// The `aria-activedescendant` dropdown surface keeps
// option elements at `tabindex="-1"` and never focus them, so the browser
// does not auto-reveal the active option when it leaves the scrollable
// panel. `scrollIntoView({ block: 'nearest' })` scrolls the option into the
// panel's scrollport (the panel itself or its `overflow-y-auto` listbox
// child) with the smallest movement, and is instant so it does not fight
// `prefers-reduced-motion`.
export function revealInScrollport(option: HTMLElement | null | undefined): void {
  option?.scrollIntoView({ block: 'nearest' })
}

export function useListSelection(initial = 0): ListSelection {
  // Plain mirror of `index` that updates synchronously. `$state` batches
  // writes until the next microtask, so back-to-back keydown events (OS key
  // auto-repeat) would each read the pre-flush value and never advance.
  // All position arithmetic reads this; `index` is the reactive projection
  // for rendering (active class, tabindex, aria-activedescendant).
  let current = initial
  let index = $state(initial)

  function commit(next: number) {
    current = next
    index = next
  }

  function set(next: number) {
    if (next < 0) next = 0
    commit(next)
  }

  function clamp(count: number) {
    if (count <= 0) {
      commit(0)
      return
    }
    if (current >= count) commit(count - 1)
    else if (current < 0) commit(0)
  }

  function reset() {
    commit(initial)
  }

  function move(direction: 'up' | 'down' | 'first' | 'last', count: number) {
    if (count <= 0) return
    if (direction === 'first') {
      commit(0)
      return
    }
    if (direction === 'last') {
      commit(count - 1)
      return
    }
    if (direction === 'down') {
      commit((current + 1) % count)
      return
    }
    commit((current - 1 + count) % count)
  }

  function syncToActive<T>(options: readonly T[], isActive: (option: T) => boolean) {
    const activeIdx = options.findIndex(isActive)
    commit(activeIdx >= 0 ? activeIdx : 0)
  }

  return {
    get index() {
      return index
    },
    peek: () => current,
    set,
    clamp,
    reset,
    move,
    syncToActive,
  }
}
