/**
 * Guards page unload (refresh/close/navigation away) while there are unsaved
 * changes, triggering the browser's built-in "leave site?" confirmation.
 */
export function useBeforeUnloadGuard(getIsDirty: () => boolean) {
  $effect(() => {
    if (!getIsDirty()) {
      return
    }
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  })
}
