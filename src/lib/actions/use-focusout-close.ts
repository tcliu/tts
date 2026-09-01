export interface FocusoutCloseRefs {
  container: HTMLElement | null
  panel: HTMLElement | null
}

export function createFocusoutClose(
  getOpen: () => boolean,
  getRefs: () => FocusoutCloseRefs,
  close: () => void,
): (event: FocusEvent) => void {
  return (event: FocusEvent) => {
    if (!getOpen()) return
    const { container, panel } = getRefs()
    const next = event.relatedTarget as Node | null
    if (next && (container?.contains(next) || panel?.contains(next))) return
    queueMicrotask(() => {
      if (!getOpen()) return
      const a = document.activeElement
      const { container: c2, panel: p2 } = getRefs()
      if (a && (c2?.contains(a) || p2?.contains(a))) return
      close()
    })
  }
}
