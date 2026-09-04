export function isEditableActiveElement(el: Element | null): boolean {
  if (!el) return false
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range') return true
  if ((el as HTMLElement).isContentEditable) return true
  return false
}
