/**
 * Global keyboard shortcuts for the TTS page.
 * Currently handles Ctrl/Cmd+S to save the current document.
 */
export function useKeyboardShortcuts(getEditor: () => { saveDocument: () => void } | null, dialogsOpen: () => boolean) {
  $effect(() => {
    function handleGlobalKeydown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
        return
      }
      if (event.key.toLowerCase() !== 's') {
        return
      }
      event.preventDefault()
      if (dialogsOpen()) {
        return
      }
      getEditor()?.saveDocument()
    }
    window.addEventListener('keydown', handleGlobalKeydown)
    return () => window.removeEventListener('keydown', handleGlobalKeydown)
  })
}
