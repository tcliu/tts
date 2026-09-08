import type { TtsI18n } from '../i18n.svelte'

import type { PlaybackController } from './types'

interface AudioPlaybackDeps {
  i18n: TtsI18n
  getCurrentAudio: () => HTMLAudioElement | null
  setCurrentAudio: (audio: HTMLAudioElement | null) => void
  getCurrentAudioUrl: () => string
  setCurrentAudioUrl: (url: string) => void
  setPlaybackElapsed: (value: number) => void
  setPlaybackDuration: (value: number) => void
}

export function createAudioPlayer(deps: AudioPlaybackDeps) {
  return function playAudioBlob(
    controller: PlaybackController,
    blob: Blob,
    onProgress?: (currentTime: number) => void,
    onDuration?: (duration: number) => void,
    startAt = 0,
    spokenStart = 0,
    spokenEnd?: number,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const audio = new Audio()
      const url = URL.createObjectURL(blob)
      const prev = deps.getCurrentAudio()
      prev?.pause()
      const prevUrl = deps.getCurrentAudioUrl()
      if (prevUrl) {
        URL.revokeObjectURL(prevUrl)
      }
      deps.setCurrentAudioUrl(url)
      deps.setCurrentAudio(audio)
      audio.src = url

      let rafId = 0
      let settled = false

      const cleanup = () => {
        stopTick()
        audio.pause()
        controller.cancelAudio = undefined
        if (deps.getCurrentAudioUrl() === url) {
          URL.revokeObjectURL(url)
          deps.setCurrentAudioUrl('')
          deps.setCurrentAudio(null)
        }
      }
      const spokenDuration = () =>
        spokenEnd != null
          ? Math.max(0, spokenEnd - spokenStart)
          : Number.isFinite(audio.duration)
            ? audio.duration
            : 0
      const cancelResolve = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }
      controller.cancelAudio = cancelResolve

      const stopTick = () => {
        if (rafId) {
          cancelAnimationFrame(rafId)
          rafId = 0
        }
      }
      const elapsedWithin = (currentTime: number) => {
        const spoken = spokenDuration()
        const value = currentTime - spokenStart
        return spoken > 0 ? Math.min(Math.max(0, value), spoken) : Math.max(0, value)
      }
      const finishSegment = (endedAt?: number) => {
        if (settled) return
        settled = true
        const spoken = spokenDuration()
        const elapsed =
          endedAt != null
            ? endedAt
            : spokenEnd != null
              ? spoken
              : Number.isFinite(audio.currentTime)
                ? audio.currentTime
                : spoken
        deps.setPlaybackElapsed(elapsed)
        deps.setPlaybackDuration(elapsed)
        onDuration?.(elapsed)
        audio.pause()
        cleanup()
        resolve()
      }
      const tick = () => {
        rafId = 0
        if (controller.cancelled || audio.paused || audio.ended) return
        const current = audio.currentTime
        deps.setPlaybackElapsed(elapsedWithin(current))
        onProgress?.(current)
        if (spokenEnd != null && current >= spokenEnd - 0.01) {
          finishSegment()
          return
        }
        rafId = requestAnimationFrame(tick)
      }

      audio.onloadedmetadata = () => {
        const full = Number.isFinite(audio.duration) ? audio.duration : 0
        deps.setPlaybackDuration(spokenDuration())
        onDuration?.(spokenDuration())
        const seekTo = spokenStart + startAt
        if (seekTo > 0 && full > 0) {
          audio.currentTime = Math.min(seekTo, full)
        }
      }
      audio.ontimeupdate = () => {
        if (settled || audio.paused || audio.ended) return
        if (!document.hidden && rafId) return
        if (controller.cancelled) return
        const current = audio.currentTime
        deps.setPlaybackElapsed(elapsedWithin(current))
        onProgress?.(current)
        if (spokenEnd != null && current >= spokenEnd - 0.01) {
          finishSegment()
        }
      }
      audio.onended = () => {
        if (settled) return
        finishSegment()
      }
      audio.onerror = () => {
        if (settled) return
        settled = true
        cleanup()
        if (controller.cancelled) {
          resolve()
          return
        }
        reject(new Error(deps.i18n.t('playback.failed')))
      }

      audio.play().then(() => {
        if (!rafId && !settled) {
          rafId = requestAnimationFrame(tick)
        }
      }).catch(error => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      })
    })
  }
}
