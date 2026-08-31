import { clickOutside } from './click-outside'

export interface UseDropdownOptions {
  /** Reactive accessor for whether the dropdown is currently open. */
  isOpen: () => boolean
  /** Called when a pointerdown lands outside the container and the optional panel. */
  onOutsideClick: (event: PointerEvent) => void
  /**
   * Called when Escape is pressed while open. Return `true` to defer (e.g.
   * when an open dialog should consume Escape first). The initializer handles
   * stopImmediatePropagation and preventDefault itself unless you return `true`;
   * returning `false`/undefined means "I handled it" and the event is consumed.
   * Escape is not closed by default — the caller closes inside this callback
   * (e.g. `close(false)` / `close()` + focus restore).
   */
  onEscape: (event: KeyboardEvent) => boolean | void
  /**
   * Reactive accessor for the floating panel element. Clicks on it count as
   * "inside", so the panel can be portalled outside the container DOM tree
   * (see positionPanel) and still survive outside-click detection. Also
   * excluded from scroll-close so an open panel scrolling its own option
   * list does not dismiss itself.
   */
  panel?: () => HTMLElement | null
  /** Reactive accessor for the container the outside-click helper watches. */
  container: () => HTMLElement | null
  /**
   * Called when a scroll moves an ancestor of the trigger (or the page
   * itself) while open, so a panel portalled to `body` would no longer be
   * anchored to its trigger. Skipped when the scroll target is inside the
   * panel (a scrollable option list) or inside an unrelated surface (e.g.
   * the editor during playback highlight auto-scroll), which must not
   * dismiss the open panel. Omit to opt out (e.g. surfaces that should
   * stay open across scrolls).
   */
  onScrollClose?: () => void
}

/**
 * Shared open/close lifecycle for dropdown-style menus (Menu, SelectDropdown,
 * ChipDropdown). Wires outside-click dismissal, a window-level Escape
 * capture, and (optionally) scroll-close while the dropdown is open. Call
 * once per component:
 *
 *   useDropdown(() => ({ isOpen: () => open, panel: () => panelRef, ... }))
 *
 * The initializer registers its own `$effect` internally, so the `.svelte.ts`
 * filename is required — it scopes `$effect` to the importing component.
 * The caller still owns its own initial focus effect because each surface
 * focuses a different element on open (first item, input, etc.).
 */
export function useDropdown(get: () => UseDropdownOptions): void {
  // Outside-click include must track the portalled panel ref. The panel
  // mounts inside {#if open}, so the initial include may be null; a
  // sibling effect keeps the action current when the ref resolves.
  let clickAction: ReturnType<typeof clickOutside> | null = null

  $effect(() => {
    const { isOpen, panel } = get()
    if (!isOpen() || !clickAction) return
    if (!panel) return
    const currentPanel = panel()
    // Read handler via accessor so a swapped closure is not missed until the
    // next panel tick; handlers are stable `() => close()` in this repo but
    // the accessor keeps the generic helper correct.
    clickAction.update({ enabled: true, handler: get().onOutsideClick, include: currentPanel ? [currentPanel] : [] })
  })

  $effect(() => {
    const { isOpen, onOutsideClick, onEscape, panel, container, onScrollClose } = get()

    if (!isOpen()) {
      return
    }

    const host = container()
    if (!host) return

    const include = panel ? [panel()] : []
    clickAction = clickOutside(host, { enabled: true, handler: onOutsideClick, include })

    function handleEscapeCapture(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      // Recheck through the accessor so a stale captured `isOpen` value
      // can't close a concurrently-unmounted dropdown.
      if (!get().isOpen()) return
      if (get().onEscape?.(event)) return
      event.stopImmediatePropagation()
      event.preventDefault()
    }
    window.addEventListener('keydown', handleEscapeCapture, true)

    function handleScroll(event: Event) {
      if (!get().isOpen()) return
      const target = event.target
      const panelEl = get().panel?.()
      const host = get().container()
      if (target instanceof Node) {
        // Scrolling the panel's own option list must not dismiss it.
        if (panelEl?.contains(target)) return
        // Only close when the scroll moves an ancestor of the trigger (or
        // the page/document root), i.e. the anchored panel would detach.
        // Unrelated surfaces (e.g. the editor auto-scrolling its playback
        // highlight) must not close an open dropdown.
        if (host && !host.contains(target)) {
          if (target !== document && target !== document.documentElement && target !== document.body) return
        }
      }
      get().onScrollClose?.()
    }
    if (onScrollClose) {
      window.addEventListener('scroll', handleScroll, { capture: true, passive: true })
    }

    return () => {
      clickAction?.destroy()
      clickAction = null
      window.removeEventListener('keydown', handleEscapeCapture, true)
      if (onScrollClose) {
        window.removeEventListener('scroll', handleScroll, { capture: true })
      }
    }
  })
}
