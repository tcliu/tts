export type ClickOutsideOptions = {
  enabled?: boolean
  handler: (event: PointerEvent) => void
  include?: Array<HTMLElement | null | undefined>
}

export function clickOutside(node: HTMLElement, options: ClickOutsideOptions | (() => void)) {
  const getOptions = (): ClickOutsideOptions =>
    typeof options === 'function' ? { handler: options } : options

  function handlePointerDown(event: PointerEvent) {
    const { enabled = true, handler, include = [] } = getOptions()
    if (!enabled) return
    const target = event.target as Node
    if (node.contains(target)) return
    for (const extra of include) {
      if (extra?.contains(target)) return
    }
    handler(event)
  }

  document.addEventListener('pointerdown', handlePointerDown, true)

  return {
    update(newOptions: ClickOutsideOptions | (() => void)) {
      options = newOptions
    },
    destroy() {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    },
  }
}
