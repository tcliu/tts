import type { ActionReturn } from 'svelte/action'

export interface DragCloseLeftOptions {
  isEnabled: () => boolean
  onDragUpdate: (offset: number, dragging: boolean) => void
  onClose: () => void
  getPanelWidth?: () => number
}

const DRAG_START_SLOP_PX = 10
const DISMISS_WIDTH_RATIO = 0.3
const FAST_SWIPE_VELOCITY_PX_PER_MS = 0.5
const FAST_SWIPE_MIN_DISTANCE_PX = 40

export function dragCloseLeft(
  element: HTMLElement,
  options: DragCloseLeftOptions,
): ActionReturn<DragCloseLeftOptions> {
  let current = options
  let startX: number | null = null
  let startY: number | null = null
  let lastX = 0
  let startTime = 0
  let activePointerId: number | null = null
  let dragging = false

  function panelWidth(): number {
    return current.getPanelWidth?.() ?? element.offsetWidth
  }

  function isIgnorableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    return !!target.closest('input, textarea, select, [contenteditable="true"]')
  }

  function releaseCapture(pointerId: number) {
    try {
      element.releasePointerCapture(pointerId)
    } catch {
      // capture was never held (e.g. stubbed environments)
    }
  }

  function reset() {
    startX = null
    startY = null
    activePointerId = null
    dragging = false
  }

  function abandonTracking(pointerId: number) {
    releaseCapture(pointerId)
    reset()
  }

  function handlePointerDown(event: PointerEvent) {
    if (!current.isEnabled()) return
    if (event.pointerType === 'mouse') return
    if (event.button !== 0) return
    if (activePointerId !== null) return
    if (isIgnorableTarget(event.target)) return
    startX = event.clientX
    startY = event.clientY
    lastX = startX
    startTime = performance.now()
    activePointerId = event.pointerId
    dragging = false
    try {
      element.setPointerCapture(event.pointerId)
    } catch {
      // pointer already released or unsupported
    }
  }

  function handlePointerMove(event: PointerEvent) {
    if (startX === null || startY === null) return
    if (event.pointerId !== activePointerId) return
    lastX = event.clientX
    const dx = lastX - startX
    const dy = event.clientY - startY
    if (!dragging) {
      if (Math.abs(dx) < DRAG_START_SLOP_PX && Math.abs(dy) < DRAG_START_SLOP_PX) return
      if (Math.abs(dy) > Math.abs(dx) || dx > 0) {
        abandonTracking(event.pointerId)
        return
      }
      dragging = true
    }
    current.onDragUpdate(Math.max(-panelWidth(), Math.min(0, dx)), true)
  }

  function finish(event: PointerEvent, cancelled: boolean) {
    if (startX === null || startY === null) return
    if (event.pointerId !== activePointerId) return
    if (!cancelled) {
      lastX = event.clientX
    }
    const wasDragging = dragging
    const dx = lastX - startX
    const elapsed = performance.now() - startTime
    abandonTracking(event.pointerId)
    current.onDragUpdate(0, false)
    if (cancelled || !wasDragging) return
    const velocity = Math.abs(dx) / Math.max(elapsed, 1)
    const fastSwipe = velocity > FAST_SWIPE_VELOCITY_PX_PER_MS && dx < -FAST_SWIPE_MIN_DISTANCE_PX
    if (fastSwipe || dx < -panelWidth() * DISMISS_WIDTH_RATIO) {
      current.onClose()
    }
  }

  function handlePointerUp(event: PointerEvent) {
    finish(event, false)
  }

  function handlePointerCancel(event: PointerEvent) {
    finish(event, true)
  }

  element.addEventListener('pointerdown', handlePointerDown)
  element.addEventListener('pointermove', handlePointerMove)
  element.addEventListener('pointerup', handlePointerUp)
  element.addEventListener('pointercancel', handlePointerCancel)

  return {
    update(next: DragCloseLeftOptions) {
      current = next
    },
    destroy() {
      element.removeEventListener('pointerdown', handlePointerDown)
      element.removeEventListener('pointermove', handlePointerMove)
      element.removeEventListener('pointerup', handlePointerUp)
      element.removeEventListener('pointercancel', handlePointerCancel)
    },
  }
}
