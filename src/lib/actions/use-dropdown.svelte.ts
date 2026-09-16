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
   * Called when the trigger becomes hidden (out of viewport or clipped by
   * an ancestor scroll container) after a scroll while open. The panel is
   * portalled to `body`, so hiding avoids a detached floating panel.
   * Scrolling the panel's own list or an unrelated surface where the
   * trigger stays visible does not dismiss. Omit to opt out.
   */
  onScrollClose?: () => void
}

/**
 * Shared open/close lifecycle for dropdown-style menus. Wires outside-click
 * dismissal, a window-level Escape
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

    function isHostHidden(host: HTMLElement): boolean {
      if (!host.isConnected) return true
      const checkVisibility = (host as unknown as { checkVisibility?: (opts?: unknown) => boolean })
        .checkVisibility
      if (typeof checkVisibility === 'function') {
        // A throwing checkVisibility is inconclusive; fall through to the
        // rect/geometry checks below rather than swallowing the error.
        let visible: boolean | null = null
        try {
          visible = checkVisibility.call(host, { checkOpacity: false, checkVisibilityCSS: true })
        } catch {
          visible = null
        }
        if (visible === false) return true
      }
      const rect = host.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return true
      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return true
      let el: HTMLElement | null = host.parentElement
      while (el) {
        const style = getComputedStyle(el)
        const overflow = `${style.overflow}${style.overflowX}${style.overflowY}`
        if (/(auto|scroll|hidden|clip)/.test(overflow)) {
          const parentRect = el.getBoundingClientRect()
          if (rect.bottom < parentRect.top || rect.top > parentRect.bottom || rect.right < parentRect.left || rect.left > parentRect.right) {
            return true
          }
        }
        el = el.parentElement
      }
      return false
    }

    function handleScroll(event: Event) {
      if (!get().isOpen()) return
      const target = event.target
      const panelEl = get().panel?.()
      if (target instanceof Node && panelEl?.contains(target)) return
      // Defer visibility check until after scroll layout, and only hide when
      // the trigger itself is clipped/out of view (out of scrollable area).
      requestAnimationFrame(() => {
        if (!get().isOpen()) return
        const hostEl = get().container()
        if (!hostEl) return
        if (isHostHidden(hostEl)) {
          get().onScrollClose?.()
        }
      })
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
