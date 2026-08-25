import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'

vi.mock('./tts-client', () => ({
  getCachedSynthesis: vi.fn(async () => ({
    blob: new Blob(['audio'], { type: 'audio/mpeg' }),
    boundaries: [] as Array<{ offset: number; at: number }>,
  })),
}))

import {
  usePlayback,
  type CodeEditorHandle,
  type PlaybackDeps,
} from './use-playback.svelte'
import type { SettingsHandle } from './use-settings.svelte'
import { splitTtsSegments } from './tts-reference'
import { createPlaybackHost } from '../test/create-playback.svelte'

class AudioStub {
  static instances: AudioStub[] = []

  src = ''
  currentTime = 0
  duration = NaN
  paused = true
  ended = false
  playbackRate = 1
  onloadedmetadata: (() => void) | null = null
  ontimeupdate: (() => void) | null = null
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  pauseCalls = 0

  constructor() {
    AudioStub.instances.push(this)
  }

  play() {
    this.paused = false
    this.onloadedmetadata?.()
    return Promise.resolve()
  }

  pause() {
    this.paused = true
    this.pauseCalls += 1
  }
}

function createEditor(): CodeEditorHandle {
  return {
    getSelectionText: () => '',
    getSelectionRange: () => null,
    setSelection: () => false,
    clearSelection: () => {},
    focus: () => {},
  }
}

function createDeps(): PlaybackDeps {
  const settings = {
    locale: 'en',
    speed: 1,
    synthesisConcurrency: 2,
    canPlay: true,
    content: 'Hello world. Second segment here.',
    resolveVoiceForSegment: () => ({ edge: 'en-US-AriaNeural', name: 'Aria' }),
  } as unknown as SettingsHandle
  return {
    settings,
    getEditor: createEditor,
    segmentLabel: () => 'English',
    prepareForPlayback: () => {},
  }
}

function createPlayback() {
  return createPlaybackHost(createDeps())
}

describe('usePlayback stop', () => {
  beforeEach(() => {
    AudioStub.instances.length = 0
    vi.stubGlobal('Audio', AudioStub)
    URL.createObjectURL = vi.fn(() => `blob:test-${Math.random()}`)
    URL.revokeObjectURL = vi.fn()
  })

  it('pauses the audio element when playback is stopped', async () => {
    const { playback, dispose } = createPlayback()

    const finished = playback.startPlayback()
    await vi.waitFor(() => expect(AudioStub.instances).toHaveLength(1))
    const audio = AudioStub.instances[0]
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
    expect(audio.paused).toBe(false)

    playback.stopPlayback()
    flushSync()

    expect(playback.isPlaying).toBe(false)
    expect(audio.pauseCalls).toBeGreaterThan(0)

    await finished
    playback.clearSegments()
    dispose()
  })

  it('plays a sentence row without a prior full playback', async () => {
    const { playback, dispose } = createPlayback()

    playback.primeSession(splitTtsSegments('Hello world. Second sentence.'), 0)

    const finished = playback.playFromSegment(0)
    await vi.waitFor(() => expect(AudioStub.instances).toHaveLength(1))
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
    expect(AudioStub.instances[0].paused).toBe(false)

    playback.stopPlayback()
    await finished
    dispose()
  })

  it('replays a row from a session re-primed by metadata sync', async () => {
    const { playback, dispose } = createPlayback()

    playback.primeSession(splitTtsSegments('Old text only.'), 0)
    playback.primeSession(splitTtsSegments('New first sentence.\n\nNew second sentence.'), 0)

    const finished = playback.playFromSegment(1)
    await vi.waitFor(() => expect(AudioStub.instances).toHaveLength(1))
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))

    playback.stopPlayback()
    await finished
    dispose()
  })
})
