export interface PositionPanelOptions {
  getTrigger: () => HTMLElement | null
  getOpen: () => boolean
  align?: 'left' | 'right'
  autoPlace?: boolean
  /**
   * Sheet mode only portals the node to `document.body` (no measuring,
   * no observers); `align`, `autoPlace`, and `getTrigger` are ignored.
   */
  presentation?: 'anchored' | 'sheet'
}

const VIEWPORT_MARGIN = 8

export function positionPanel(node: HTMLElement, options: () => PositionPanelOptions) {
  let originalParent: ParentNode | null = null
  let nextSibling: Node | null = null
  let scrollableAncestor: HTMLElement | null = null
  let triggerObserver: ResizeObserver | null = null
  let panelObserver: ResizeObserver | null = null

  function attachPanelToBody() {
    if (!node.parentNode || node.parentNode === document.body) {
      return
    }
    originalParent = node.parentNode
    nextSibling = node.nextSibling
    document.body.appendChild(node)
  }

  function restorePanelParent() {
    if (!originalParent) {
      return
    }
    // The `{#if}` block that owns this panel removes the node itself, and the
    // portal detached it from that parent: re-inserting a node Svelte has
    // already dropped would resurrect it as a hidden orphan (one leaked node,
    // with a duplicate panel id, per close). Restore only while still attached.
    if (!node.isConnected) {
      originalParent = null
      nextSibling = null
      return
    }
    if (nextSibling && nextSibling.parentNode === originalParent) {
      originalParent.insertBefore(node, nextSibling)
    } else {
      originalParent.appendChild(node)
    }
    originalParent = null
    nextSibling = null
  }

  function findScrollableAncestor(start: HTMLElement | null): HTMLElement | null {
    let element: HTMLElement | null = start
    while (element && element !== document.body) {
      const overflowY = getComputedStyle(element).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') {
        return element
      }
      element = element.parentElement
    }
    return null
  }

  function updatePanelPosition() {
    const { getTrigger, getOpen, align = 'left', autoPlace = true, presentation = 'anchored' } = options()
    if (!getOpen()) {
      return
    }
    if (presentation === 'sheet') {
      node.style.transform = ''
      node.style.left = ''
      node.style.top = ''
      node.style.maxWidth = ''
      node.style.visibility = 'visible'
      return
    }
    const trigger = getTrigger()
    if (!trigger) {
      return
    }
    const rect = trigger.getBoundingClientRect()
    const maxWidth = window.innerWidth - VIEWPORT_MARGIN * 2
    // Floor the panel at the trigger width so a narrow option list never
    // renders a sliver beside a wide control; re-measured with the trigger
    // (ResizeObserver below) so the two stay in sync while open.
    node.style.minWidth = `${rect.width}px`
    const panelWidth = Math.min(node.offsetWidth, maxWidth)
    const panelHeight = node.offsetHeight
    if (panelWidth < node.offsetWidth) node.style.maxWidth = `${maxWidth}px`
    else node.style.maxWidth = ''
    let left = align === 'right' ? rect.right - panelWidth : rect.left
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - panelWidth - VIEWPORT_MARGIN))
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    let top = rect.bottom + VIEWPORT_MARGIN
    if (autoPlace && spaceBelow < panelHeight && spaceAbove > spaceBelow) {
      top = rect.top - VIEWPORT_MARGIN - panelHeight
    }
    top = Math.max(VIEWPORT_MARGIN, Math.min(top, window.innerHeight - panelHeight - VIEWPORT_MARGIN))
    // Position the panel using top/left instead of a CSS transform.
    // Firefox may include transformed fixed elements in the page's scroll extents,
    // which causes unexpected vertical scroll when overlays are opened inside
    // an overflow-auto container (observed in dialogs). Using top/left avoids
    // that behavior while still allowing exact placement.
    node.style.transform = ''
    node.style.left = `${left}px`
    node.style.top = `${top}px`
    node.style.visibility = 'visible'
  }

  function dispose() {
    window.removeEventListener('resize', updatePanelPosition)
    scrollableAncestor?.removeEventListener('scroll', updatePanelPosition)
    triggerObserver?.disconnect()
    panelObserver?.disconnect()
    scrollableAncestor = null
    triggerObserver = null
    panelObserver = null
    // Clear any positioning styles we set to avoid leaving visual artifacts
    // if the node is reused or reinserted elsewhere.
    node.style.transform = ''
    node.style.left = ''
    node.style.top = ''
    node.style.maxWidth = ''
    node.style.minWidth = ''
    restorePanelParent()
  }

  node.style.visibility = 'hidden'

  $effect(() => {
    const { getTrigger, getOpen, presentation = 'anchored' } = options()
    if (!getOpen()) {
      node.style.visibility = 'hidden'
      // Clear positioning when the panel is hidden so it doesn't affect
      // any measuring or leftover layout in some browsers.
      node.style.transform = ''
      node.style.left = ''
      node.style.top = ''
      node.style.maxWidth = ''
      node.style.minWidth = ''
      restorePanelParent()
      return
    }
    attachPanelToBody()
    updatePanelPosition()
    if (presentation === 'sheet') {
      return () => {
        node.style.visibility = 'hidden'
        restorePanelParent()
      }
    }
    scrollableAncestor = findScrollableAncestor(getTrigger())
    scrollableAncestor?.addEventListener('scroll', updatePanelPosition, { passive: true })
    window.addEventListener('resize', updatePanelPosition)
    triggerObserver = new ResizeObserver(updatePanelPosition)
    const trigger = getTrigger()
    if (trigger) {
      triggerObserver.observe(trigger)
    }
    panelObserver = new ResizeObserver(updatePanelPosition)
    panelObserver.observe(node)
    return dispose
  })

  return {
    destroy() {
      window.removeEventListener('resize', updatePanelPosition)
      scrollableAncestor?.removeEventListener('scroll', updatePanelPosition)
      triggerObserver?.disconnect()
      panelObserver?.disconnect()
      node.style.visibility = 'hidden'
      restorePanelParent()
    },
  }
}
