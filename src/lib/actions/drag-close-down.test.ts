import { afterEach, describe, expect, it, vi } from 'vitest'
import { dragCloseDown, type DragCloseDownOptions } from './drag-close-down'

interface PointerInit {
  x?: number
  y?: number
  pointerId?: number
  pointerType?: string
  button?: number
}

function pointerEvent(type: string, { x = 0, y = 0, pointerId = 1, pointerType = 'touch', button = 0 }: PointerInit = {}): PointerEvent {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { clientX: x, clientY: y, pointerId, pointerType, button })
  return event as unknown as PointerEvent
}

function createPanel(height: number): HTMLElement {
  const element = document.createElement('div')
  Object.defineProperty(element, 'offsetHeight', { value: height })
  document.body.appendChild(element)
  return element
}

function createHarness({ height = 320, enabled = true }: { height?: number; enabled?: boolean } = {}) {
  const element = createPanel(height)
  const updates: Array<[number, boolean]> = []
  const onClose = vi.fn()
  const options: DragCloseDownOptions = {
    isEnabled: () => enabled,
    onDragUpdate: (offset, dragging) => updates.push([offset, dragging]),
    onClose,
    getPanelHeight: () => height,
  }
  const action = dragCloseDown(element, options)
  return {
    element,
    updates,
    onClose,
    destroy: () => action.destroy?.(),
    lastOffset: () => updates[updates.length - 1]?.[0] ?? null,
    lastDragging: () => updates[updates.length - 1]?.[1] ?? null,
  }
}

function setClock(value: number) {
  vi.spyOn(performance, 'now').mockImplementation(() => value)
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('dragCloseDown', () => {
  it('follows the pointer with clamped offsets while dragging down', () => {
    const h = createHarness()
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: 0, y: 5 }))
    expect(h.lastOffset()).toBeNull()
    h.element.dispatchEvent(pointerEvent('pointermove', { x: 0, y: 60 }))
    expect(h.lastOffset()).toBe(60)
    expect(h.lastDragging()).toBe(true)
    h.element.dispatchEvent(pointerEvent('pointermove', { x: 0, y: 500 }))
    expect(h.lastOffset()).toBe(320)
  })

  it('dismisses when released past 30% of the panel height', () => {
    const h = createHarness()
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: 0, y: 100 }))
    setClock(1000)
    h.element.dispatchEvent(pointerEvent('pointerup', { x: 0, y: 100 }))
    expect(h.onClose).toHaveBeenCalledTimes(1)
    expect(h.lastOffset()).toBe(0)
    expect(h.lastDragging()).toBe(false)
  })

  it('snaps back without dismissing below the distance threshold', () => {
    const h = createHarness()
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: 0, y: 50 }))
    setClock(1000)
    h.element.dispatchEvent(pointerEvent('pointerup', { x: 0, y: 50 }))
    expect(h.onClose).not.toHaveBeenCalled()
    expect(h.lastOffset()).toBe(0)
    expect(h.lastDragging()).toBe(false)
  })

  it('dismisses on a fast flick even below the distance threshold', () => {
    const h = createHarness()
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: 0, y: 30 }))
    setClock(40)
    h.element.dispatchEvent(pointerEvent('pointerup', { x: 0, y: 50 }))
    expect(h.onClose).toHaveBeenCalledTimes(1)
  })

  it('does not dismiss a slow drag of the same distance', () => {
    const h = createHarness()
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: 0, y: 30 }))
    setClock(1500)
    h.element.dispatchEvent(pointerEvent('pointerup', { x: 0, y: 50 }))
    expect(h.onClose).not.toHaveBeenCalled()
  })

  it('abandons the gesture when horizontal motion dominates', () => {
    const h = createHarness()
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: 20, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: 100, y: 40 }))
    h.element.dispatchEvent(pointerEvent('pointerup', { x: 100, y: 40 }))
    expect(h.onClose).not.toHaveBeenCalled()
    expect(h.updates.filter(([, dragging]) => dragging)).toEqual([])
  })

  it('abandons the gesture on upward motion', () => {
    const h = createHarness()
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: 0, y: -30 }))
    h.element.dispatchEvent(pointerEvent('pointerup', { x: 0, y: -30 }))
    expect(h.onClose).not.toHaveBeenCalled()
    expect(h.updates.filter(([, dragging]) => dragging)).toEqual([])
  })

  it('snaps back and does not dismiss on pointercancel', () => {
    const h = createHarness()
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: 0, y: 100 }))
    h.element.dispatchEvent(pointerEvent('pointercancel', { x: 0, y: 100 }))
    expect(h.onClose).not.toHaveBeenCalled()
    expect(h.lastOffset()).toBe(0)
    expect(h.lastDragging()).toBe(false)
  })

  it('ignores mouse pointers entirely', () => {
    const h = createHarness()
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0, pointerType: 'mouse' }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: 0, y: 100, pointerType: 'mouse' }))
    setClock(20)
    h.element.dispatchEvent(pointerEvent('pointerup', { x: 0, y: 100, pointerType: 'mouse' }))
    expect(h.onClose).not.toHaveBeenCalled()
    expect(h.updates).toEqual([])
  })

  it('ignores drags starting on buttons so embedded controls keep working', () => {
    const h = createHarness()
    setClock(0)
    const button = document.createElement('button')
    h.element.appendChild(button)
    button.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    button.dispatchEvent(pointerEvent('pointermove', { x: 0, y: 100 }))
    setClock(20)
    button.dispatchEvent(pointerEvent('pointerup', { x: 0, y: 100 }))
    expect(h.onClose).not.toHaveBeenCalled()
    expect(h.updates).toEqual([])
  })

  it('does nothing when disabled', () => {
    const h = createHarness({ enabled: false })
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: 0, y: 100 }))
    setClock(20)
    h.element.dispatchEvent(pointerEvent('pointerup', { x: 0, y: 100 }))
    expect(h.onClose).not.toHaveBeenCalled()
    expect(h.updates).toEqual([])
  })

  it('stops tracking after destroy', () => {
    const h = createHarness()
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    h.destroy()
    h.element.dispatchEvent(pointerEvent('pointermove', { x: 0, y: 100 }))
    setClock(1000)
    h.element.dispatchEvent(pointerEvent('pointerup', { x: 0, y: 100 }))
    expect(h.onClose).not.toHaveBeenCalled()
    expect(h.updates).toEqual([])
  })
})
