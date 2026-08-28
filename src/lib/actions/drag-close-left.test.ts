import { afterEach, describe, expect, it, vi } from 'vitest'
import { dragCloseLeft, type DragCloseLeftOptions } from './drag-close-left'

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

function createPanel(width: number): HTMLElement {
  const element = document.createElement('aside')
  Object.defineProperty(element, 'offsetWidth', { value: width })
  document.body.appendChild(element)
  return element
}

function createHarness({ width = 256, enabled = true }: { width?: number; enabled?: boolean } = {}) {
  const element = createPanel(width)
  const updates: Array<[number, boolean]> = []
  const onClose = vi.fn()
  const options: DragCloseLeftOptions = {
    isEnabled: () => enabled,
    onDragUpdate: (offset, dragging) => updates.push([offset, dragging]),
    onClose,
    getPanelWidth: () => width,
  }
  const action = dragCloseLeft(element, options)
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

describe('dragCloseLeft', () => {
  it('follows the pointer with clamped offsets while dragging left', () => {
    const h = createHarness()
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: -5, y: 0 }))
    expect(h.lastOffset()).toBeNull()
    h.element.dispatchEvent(pointerEvent('pointermove', { x: -60, y: 0 }))
    expect(h.lastOffset()).toBe(-60)
    expect(h.lastDragging()).toBe(true)
    h.element.dispatchEvent(pointerEvent('pointermove', { x: -400, y: 0 }))
    expect(h.lastOffset()).toBe(-256)
  })

  it('dismisses when released past 30% of the panel width', () => {
    const h = createHarness()
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: -80, y: 0 }))
    setClock(1000)
    h.element.dispatchEvent(pointerEvent('pointerup', { x: -80, y: 0 }))
    expect(h.onClose).toHaveBeenCalledTimes(1)
    expect(h.lastOffset()).toBe(0)
    expect(h.lastDragging()).toBe(false)
  })

  it('snaps back without dismissing below the distance threshold', () => {
    const h = createHarness()
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: -50, y: 0 }))
    setClock(1000)
    h.element.dispatchEvent(pointerEvent('pointerup', { x: -50, y: 0 }))
    expect(h.onClose).not.toHaveBeenCalled()
    expect(h.lastOffset()).toBe(0)
    expect(h.lastDragging()).toBe(false)
  })

  it('dismisses on a fast flick even below the distance threshold', () => {
    const h = createHarness()
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: -30, y: 0 }))
    setClock(40)
    h.element.dispatchEvent(pointerEvent('pointerup', { x: -50, y: 0 }))
    expect(h.onClose).toHaveBeenCalledTimes(1)
  })

  it('does not dismiss a slow drag of the same distance', () => {
    const h = createHarness()
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: -30, y: 0 }))
    setClock(1500)
    h.element.dispatchEvent(pointerEvent('pointerup', { x: -50, y: 0 }))
    expect(h.onClose).not.toHaveBeenCalled()
  })

  it('abandons the gesture when vertical motion dominates', () => {
    const h = createHarness()
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: 0, y: 20 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: -100, y: 40 }))
    h.element.dispatchEvent(pointerEvent('pointerup', { x: -100, y: 40 }))
    expect(h.onClose).not.toHaveBeenCalled()
    expect(h.updates.filter(([, dragging]) => dragging)).toEqual([])
  })

  it('abandons the gesture on rightward motion', () => {
    const h = createHarness()
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: 30, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointerup', { x: 30, y: 0 }))
    expect(h.onClose).not.toHaveBeenCalled()
    expect(h.updates.filter(([, dragging]) => dragging)).toEqual([])
  })

  it('snaps back and does not dismiss on pointercancel', () => {
    const h = createHarness()
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: -100, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointercancel', { x: -100, y: 0 }))
    expect(h.onClose).not.toHaveBeenCalled()
    expect(h.lastOffset()).toBe(0)
    expect(h.lastDragging()).toBe(false)
  })

  it('ignores mouse pointers entirely', () => {
    const h = createHarness()
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0, pointerType: 'mouse' }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: -100, y: 0, pointerType: 'mouse' }))
    setClock(20)
    h.element.dispatchEvent(pointerEvent('pointerup', { x: -100, y: 0, pointerType: 'mouse' }))
    expect(h.onClose).not.toHaveBeenCalled()
    expect(h.updates).toEqual([])
  })

  it('ignores a second pointer during an active drag', () => {
    const h = createHarness()
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0, pointerId: 1 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: -30, y: 0, pointerId: 1 }))
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 10, y: 10, pointerId: 2 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: 5, y: 0, pointerId: 2 }))
    setClock(1000)
    h.element.dispatchEvent(pointerEvent('pointerup', { x: -80, y: 0, pointerId: 1 }))
    expect(h.onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores drags starting on form controls', () => {
    const h = createHarness()
    setClock(0)
    const input = document.createElement('input')
    h.element.appendChild(input)
    input.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    input.dispatchEvent(pointerEvent('pointermove', { x: -100, y: 0 }))
    setClock(20)
    input.dispatchEvent(pointerEvent('pointerup', { x: -100, y: 0 }))
    expect(h.onClose).not.toHaveBeenCalled()
    expect(h.updates).toEqual([])
  })

  it('does nothing when disabled', () => {
    const h = createHarness({ enabled: false })
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    h.element.dispatchEvent(pointerEvent('pointermove', { x: -100, y: 0 }))
    setClock(20)
    h.element.dispatchEvent(pointerEvent('pointerup', { x: -100, y: 0 }))
    expect(h.onClose).not.toHaveBeenCalled()
    expect(h.updates).toEqual([])
  })

  it('stops tracking after destroy', () => {
    const h = createHarness()
    setClock(0)
    h.element.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
    h.destroy()
    h.element.dispatchEvent(pointerEvent('pointermove', { x: -100, y: 0 }))
    setClock(1000)
    h.element.dispatchEvent(pointerEvent('pointerup', { x: -100, y: 0 }))
    expect(h.onClose).not.toHaveBeenCalled()
    expect(h.updates).toEqual([])
  })
})
