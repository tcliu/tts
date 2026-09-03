export function readAudioDuration(blob: Blob, signal: AbortSignal): Promise<number> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve(0)
      return
    }
    const audio = new Audio()
    const url = URL.createObjectURL(blob)
    let settled = false
    const cleanup = () => {
      signal.removeEventListener('abort', handleAbort)
      audio.onloadedmetadata = null
      audio.onerror = null
      audio.pause()
      audio.src = ''
      URL.revokeObjectURL(url)
    }
    const finish = (duration: number) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Number.isFinite(duration) ? duration : 0)
    }
    const handleAbort = () => finish(0)
    signal.addEventListener('abort', handleAbort, { once: true })
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => finish(audio.duration)
    audio.onerror = () => finish(0)
    audio.src = url
  })
}
