import type { ActionReturn } from 'svelte/action'

export interface DragCloseDownOptions {
  isEnabled: () => boolean
  onDragUpdate: (offset: number, dragging: boolean) => void
  onClose: () => void
  getPanelHeight?: () => number
}

const DRAG_START_SLOP_PX = 10
const DISMISS_HEIGHT_RATIO = 0.3
const FAST_SWIPE_VELOCITY_PX_PER_MS = 0.5
const FAST_SWIPE_MIN_DISTANCE_PX = 40

/**
 * Vertical mirror of `dragCloseLeft` for bottom sheets: touch/pen drags
 * starting on the element that move down past ~30% of the panel height (or
 * a fast downward flick) request `onClose`; otherwise the sheet snaps back.
 * Drags starting on form controls or buttons stay taps and are never tracked,
 * so an embedded close button keeps working on touch.
 */
export function dragCloseDown(
  element: HTMLElement,
  options: DragCloseDownOptions,
): ActionReturn<DragCloseDownOptions> {
  let current = options
  let startX: number | null = null
  let startY: number | null = null
  let lastY = 0
  let startTime = 0
  let activePointerId: number | null = null
  let dragging = false

  function panelHeight(): number {
    return current.getPanelHeight?.() ?? element.offsetHeight
  }

  function isIgnorableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    return !!target.closest('input, textarea, select, button, [contenteditable="true"]')
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
    lastY = startY
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
    lastY = event.clientY
    const dx = event.clientX - startX
    const dy = lastY - startY
    if (!dragging) {
      if (Math.abs(dx) < DRAG_START_SLOP_PX && Math.abs(dy) < DRAG_START_SLOP_PX) return
      if (Math.abs(dx) > Math.abs(dy) || dy < 0) {
        abandonTracking(event.pointerId)
        return
      }
      dragging = true
    }
    current.onDragUpdate(Math.max(0, Math.min(panelHeight(), dy)), true)
  }

  function finish(event: PointerEvent, cancelled: boolean) {
    if (startX === null || startY === null) return
    if (event.pointerId !== activePointerId) return
    if (!cancelled) {
      lastY = event.clientY
    }
    const wasDragging = dragging
    const dy = lastY - startY
    const elapsed = performance.now() - startTime
    abandonTracking(event.pointerId)
    current.onDragUpdate(0, false)
    if (cancelled || !wasDragging) return
    const velocity = Math.abs(dy) / Math.max(elapsed, 1)
    const fastSwipe = velocity > FAST_SWIPE_VELOCITY_PX_PER_MS && dy > FAST_SWIPE_MIN_DISTANCE_PX
    if (fastSwipe || dy > panelHeight() * DISMISS_HEIGHT_RATIO) {
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
    update(next: DragCloseDownOptions) {
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
