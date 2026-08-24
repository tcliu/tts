export interface PositionPanelOptions {
  getTrigger: () => HTMLElement | null
  getOpen: () => boolean
  align?: 'left' | 'right'
  autoPlace?: boolean
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
    const { getTrigger, getOpen, align = 'left', autoPlace = true } = options()
    const trigger = getTrigger()
    if (!getOpen() || !trigger) {
      return
    }
    const rect = trigger.getBoundingClientRect()
    const panelWidth = node.offsetWidth
    const panelHeight = node.offsetHeight
    let left = align === 'right' ? rect.right - panelWidth : rect.left
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - panelWidth - VIEWPORT_MARGIN))
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    let top = rect.bottom + VIEWPORT_MARGIN
    if (autoPlace && spaceBelow < panelHeight && spaceAbove > spaceBelow) {
      top = rect.top - VIEWPORT_MARGIN - panelHeight
    }
    top = Math.max(VIEWPORT_MARGIN, Math.min(top, window.innerHeight - panelHeight - VIEWPORT_MARGIN))
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
    node.style.transform = ''
    node.style.left = ''
    node.style.top = ''
    restorePanelParent()
  }

  node.style.visibility = 'hidden'

  $effect(() => {
    const { getTrigger, getOpen } = options()
    if (!getOpen()) {
      node.style.visibility = 'hidden'
      node.style.transform = ''
      node.style.left = ''
      node.style.top = ''
      restorePanelParent()
      return
    }
    attachPanelToBody()
    updatePanelPosition()
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
