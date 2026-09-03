export function isEditableActiveElement(el: Element | null): boolean {
  if (!el) return false
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range') return true
  if ((el as HTMLElement).isContentEditable) return true
  return false
}

export function createSliderDraft() {
  let draft: string | null = null
  return {
    get draft() {
      return draft
    },
    setDraft(value: string | null) {
      draft = value
    },
    handleInput(event: Event) {
      const target = event.currentTarget
      if (!(target instanceof HTMLInputElement)) return
      draft = target.value
    },
    async commit(event: Event, seekTo: (elapsed: number) => Promise<void>) {
      const target = event.currentTarget
      if (!(target instanceof HTMLInputElement)) {
        draft = null
        return
      }
      draft = null
      await seekTo(Number(target.value))
    },
  }
}
