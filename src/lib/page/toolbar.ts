import { isEditableActiveElement } from './slider'

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

export function createPlaybackArrowHandler(deps: {
  getEditorRef: () => { hasFocus?: () => boolean } | null
  getDrawerPanelRef: () => HTMLElement | null
  getPlayback: () => { synthesizedCount: number; totalElapsed: number; seekTo: (n: number) => void }
  getSliderMax: () => number
  dialogsOpen: () => boolean
}) {
  return (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    if (deps.getEditorRef()?.hasFocus?.()) return
    if (isEditableActiveElement(document.activeElement)) return
    if (deps.dialogsOpen()) return
    if (deps.getDrawerPanelRef()?.contains(document.activeElement)) return
    const playback = deps.getPlayback()
    const sliderMax = deps.getSliderMax()
    if (playback.synthesizedCount === 0 || sliderMax <= 0) return
    event.preventDefault()
    const step = sliderMax * 0.05
    const delta = event.key === 'ArrowRight' ? step : -step
    const next = Math.min(sliderMax, Math.max(0, playback.totalElapsed + delta))
    void playback.seekTo(next)
  }
}
