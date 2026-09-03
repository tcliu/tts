export function panelActionDisabled(
  action: string,
  deps: { isPlaying: boolean; canPlay: boolean; saveDisabled: boolean; currentDocId: string | null; isDirty: boolean },
): boolean {
  if (action === 'play') return deps.isPlaying ? false : !deps.canPlay
  if (action === 'copy') return !deps.canPlay
  if (action === 'save') return deps.saveDisabled
  if (action === 'reset') return deps.currentDocId ? !deps.isDirty : !deps.canPlay
  return false
}

export function createPanelActionHandler(deps: {
  getPlayback: () => { isPlaying: boolean; stopPlayback: () => void; startPlayback: () => Promise<void> }
  getEditor: () => {
    resetEditor: () => void
    saveDocument: () => void
    copyEditorContent: () => Promise<void>
    requestCloneDocument: () => void
    requestUpload: () => void
    requestDeleteDocument: (id: string) => void
    currentDocId: string | null
  }
  getShowMetadata: () => boolean
  setShowMetadata: (v: boolean) => void
}) {
  return (action: string) => {
    const playback = deps.getPlayback()
    const editor = deps.getEditor()
    if (action === 'play') {
      if (playback.isPlaying) playback.stopPlayback()
      else void playback.startPlayback()
    } else if (action === 'reset') editor.resetEditor()
    else if (action === 'save') editor.saveDocument()
    else if (action === 'copy') void editor.copyEditorContent()
    else if (action === 'info') deps.setShowMetadata(!deps.getShowMetadata())
    else if (action === 'clone') editor.requestCloneDocument()
    else if (action === 'upload') editor.requestUpload()
    else if (editor.currentDocId) editor.requestDeleteDocument(editor.currentDocId)
  }
}
