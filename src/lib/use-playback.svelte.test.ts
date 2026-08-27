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
  type SegmentMeta,
} from './use-playback.svelte'
import type { SettingsHandle } from './use-settings.svelte'
import { splitHighlightRanges, splitTtsSegments, type TtsBoundary, type TtsSegment } from './tts-reference'
import { createPlaybackHost } from '../test/create-playback.svelte'
import { getCachedSynthesis } from './tts-client'

class AudioStub {
  static instances: AudioStub[] = []

  #src = ''
  currentTime = 0
  duration = 5
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

  get src() {
    return this.#src
  }

  set src(value: string) {
    this.#src = value
    queueMicrotask(() => this.onloadedmetadata?.())
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

function createSettings(content: string): SettingsHandle {
  return {
    locale: 'en',
    speed: 1,
    synthesisConcurrency: 2,
    canPlay: true,
    content,
    resolveVoiceForSegment: () => ({ edge: 'en-US-AriaNeural', name: 'Aria' }),
  } as unknown as SettingsHandle
}

function createDeps(content = 'Hello world. Second segment here.', editor?: CodeEditorHandle): PlaybackDeps {
  return {
    settings: createSettings(content),
    getEditor: editor ? () => editor : createEditor,
    segmentLabel: () => 'English',
    prepareForPlayback: () => {},
  }
}

const FIRST_SEGMENT_BOUNDARIES: TtsBoundary[] = [
  { offset: 0, at: 0, text: 'First' },
  { offset: 6, at: 0.5, text: 'paragraph' },
  { offset: 16, at: 1.1, text: 'here.' },
]

const SECOND_SEGMENT_BOUNDARIES: TtsBoundary[] = [
  { offset: 0, at: 0, text: 'Second' },
  { offset: 7, at: 0.6, text: 'paragraph' },
]

function createSegmentMeta(index: number, segment: TtsSegment, overrides: Partial<SegmentMeta> = {}): SegmentMeta {
  return {
    index,
    lang: segment.lang,
    text: segment.text,
    ranges: splitHighlightRanges(segment.text),
    boundaries: FIRST_SEGMENT_BOUNDARIES,
    wordBoundaries: FIRST_SEGMENT_BOUNDARIES,
    baseOffset: segment.indexStart,
    spokenStart: 0,
    spokenEnd: 1.5,
    duration: 1.5,
    ...overrides,
  }
}

function createPlayback() {
  return createPlaybackHost(createDeps())
}

function createSelectionEditor(selection: { from: number; to: number } | null, onSetSelection?: (from: number, to: number) => void): CodeEditorHandle {
  return {
    getSelectionText: () => '',
    getSelectionRange: () => selection,
    setSelection: (from: number, to: number) => {
      onSetSelection?.(from, to)
      return true
    },
    clearSelection: () => {},
    focus: () => {},
  }
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
    await vi.waitFor(() => expect(AudioStub.instances.length).toBeGreaterThanOrEqual(2))
    const audio = AudioStub.instances[AudioStub.instances.length - 1]
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

  it('exposes total duration as soon as playback starts', async () => {
    const { playback, dispose } = createPlayback()

    const finished = playback.startPlayback()
    await vi.waitFor(() => expect(AudioStub.instances.length).toBeGreaterThanOrEqual(2))
    await vi.waitFor(() => expect(playback.totalDuration).toBeGreaterThan(0))
    expect(playback.playbackDuration).toBeGreaterThan(0)

    playback.stopPlayback()
    await finished
    dispose()
  })

  it('does not accumulate total duration across repeated plays', async () => {
    const { playback, dispose } = createPlayback()

    const first = playback.startPlayback()
    await vi.waitFor(() => expect(AudioStub.instances.length).toBeGreaterThanOrEqual(2))
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
    await vi.waitFor(() => expect(playback.totalDuration).toBeGreaterThan(0))
    const firstTotal = playback.totalDuration
    playback.stopPlayback()
    await first

    const second = playback.startPlayback()
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
    await vi.waitFor(() => expect(playback.totalDuration).toBeGreaterThan(0))
    expect(playback.totalDuration).toBeCloseTo(firstTotal, 5)

    playback.stopPlayback()
    await second
    dispose()
  })

  it('uses the actual ended position when a segment ends before its metadata duration', async () => {
    const { playback, dispose } = createPlayback()

    const finished = playback.startPlayback()
    await vi.waitFor(() => expect(AudioStub.instances.length).toBeGreaterThanOrEqual(1))
    const audio = AudioStub.instances[AudioStub.instances.length - 1]
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))

    audio.currentTime = 4.5
    audio.onended?.()

    await finished
    await vi.waitFor(() => expect(playback.isPlaybackEnded).toBe(true))

    expect(playback.totalDuration).toBeCloseTo(4.5, 5)

    playback.stopPlayback()
    dispose()
  })

  it('resumes playback from the last stopped position', async () => {
    const { playback, dispose } = createPlayback()

    const firstRun = playback.startPlayback()
    await vi.waitFor(() => expect(AudioStub.instances.length).toBeGreaterThanOrEqual(2))
    const firstAudio = AudioStub.instances[AudioStub.instances.length - 1]
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))

    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    firstAudio.currentTime = 1.25
    firstAudio.ontimeupdate?.()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    playback.stopPlayback()
    await firstRun

    const resumedRun = playback.startPlayback()
    await vi.waitFor(() => expect(AudioStub.instances.length).toBeGreaterThanOrEqual(4))
    const resumedAudio = AudioStub.instances[AudioStub.instances.length - 1]
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
    await vi.waitFor(() => expect(resumedAudio.currentTime).toBeCloseTo(1.33, 2))

    playback.stopPlayback()
    await resumedRun
    dispose()
  })

  it('uses the live audio clock when remembering the stopped resume position', async () => {
    const { playback, dispose } = createPlayback()

    const firstRun = playback.startPlayback()
    await vi.waitFor(() => expect(AudioStub.instances.length).toBeGreaterThanOrEqual(2))
    const firstAudio = AudioStub.instances[AudioStub.instances.length - 1]
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))

    firstAudio.currentTime = 1.65
    playback.stopPlayback()
    await firstRun

    const resumedRun = playback.startPlayback()
    await vi.waitFor(() => expect(AudioStub.instances.length).toBeGreaterThanOrEqual(4))
    const resumedAudio = AudioStub.instances[AudioStub.instances.length - 1]
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
    await vi.waitFor(() => expect(resumedAudio.currentTime).toBeCloseTo(1.73, 2))

    playback.stopPlayback()
    await resumedRun
    dispose()
  })

  it('updates the paused resume position when seeking by elapsed time', async () => {
    const { playback, dispose } = createPlayback()
    const segments = splitTtsSegments('Hello world.\n\nSecond sentence.')

    playback.primeSession(segments, 0)
    playback.recordSegment(0, {
      index: 0,
      lang: segments[0].lang,
      text: segments[0].text,
      ranges: splitHighlightRanges(segments[0].text),
      boundaries: [],
      baseOffset: segments[0].indexStart,
    })
    playback.recordSegment(1, {
      index: 1,
      lang: segments[1].lang,
      text: segments[1].text,
      ranges: splitHighlightRanges(segments[1].text),
      boundaries: [],
      baseOffset: segments[1].indexStart,
    })
    playback.setSegmentDuration(0, 4)
    playback.setSegmentDuration(1, 6)

    await playback.seekTo(5.5)
    flushSync()

    expect(playback.isPlaying).toBe(false)
    expect(playback.currentSegmentIndex).toBe(2)
    expect(playback.playedDuration).toBe(4)
    expect(playback.playbackElapsed).toBeCloseTo(1.5, 2)
    expect(playback.totalElapsed).toBeCloseTo(5.5, 2)

    dispose()
  })

  it('plays a sentence row without a prior full playback', async () => {
    const { playback, dispose } = createPlayback()

    playback.primeSession(splitTtsSegments('Hello world. Second sentence.'), 0)

    const finished = playback.playFromSegment(0)
    await vi.waitFor(() => expect(AudioStub.instances.length).toBeGreaterThanOrEqual(2))
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
    expect(AudioStub.instances[AudioStub.instances.length - 1].paused).toBe(false)

    playback.stopPlayback()
    await finished
    dispose()
  })

  it('treats a manual selection as a full-document start position', async () => {
    const content = 'First paragraph here.\n\nSecond paragraph here.'
    const selectionStart = content.indexOf('Second')
    const editor = createSelectionEditor({ from: selectionStart, to: selectionStart + 'Second'.length })
    const { playback, dispose } = createPlaybackHost(createDeps(content, editor))

    vi.mocked(getCachedSynthesis).mockClear()
    const finished = playback.startPlayback()
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))

    expect(playback.totalSegments).toBe(2)
    expect(playback.currentSegmentIndex).toBe(2)
    expect(vi.mocked(getCachedSynthesis).mock.calls.map(call => call[0])).toEqual(
      expect.arrayContaining(['First paragraph here.', 'Second paragraph here.']),
    )

    playback.stopPlayback()
    await finished
    dispose()
  })

  it('snaps manual selection to the first word inside the selected text', () => {
    const content = 'First paragraph here.\n\nSecond paragraph here.'
    const selectionStart = content.indexOf('paragraph here.')
    const selectionEnd = selectionStart + 'paragraph here.'.length
    const segments = splitTtsSegments(content)
    const playback = createPlaybackHost(
      createDeps(content, createSelectionEditor({ from: selectionStart, to: selectionEnd })),
    ).playback

    playback.primeSession(segments, 0, { from: selectionStart, to: selectionEnd })
    playback.recordSegment(0, createSegmentMeta(0, segments[0]))

    playback.syncSelectionStart({ from: selectionStart, to: selectionEnd })

    expect(playback.currentSegmentIndex).toBe(1)
    expect(playback.playbackElapsed).toBeCloseTo(0.5, 5)
    expect(playback.totalElapsed).toBeCloseTo(0.5, 5)
  })

  it('exposes synthesizedCount only after synthesis results land', async () => {
    const content = 'First paragraph here.\n\nSecond paragraph here.'
    const segments = splitTtsSegments(content)
    const editor = createSelectionEditor({ from: 0, to: 0 })
    const { playback, dispose } = createPlaybackHost(createDeps(content, editor))

    expect(playback.synthesizedCount).toBe(0)
    const finished = playback.startPlayback()
    await vi.waitFor(() => expect(playback.synthesizedCount).toBeGreaterThan(0))
    playback.stopPlayback()
    await finished
    expect(playback.synthesizedCount).toBe(segments.length)
    playback.resetSession()
    expect(playback.synthesizedCount).toBe(0)
    dispose()
  })

  it('falls back to the nearest earlier boundary when a selection starts mid-word', () => {
    const content = 'First paragraph here.\n\nSecond paragraph here.'
    const selectionStart = content.indexOf('paragraph here.') + 2
    const selectionEnd = selectionStart + 4
    const segments = splitTtsSegments(content)
    const playback = createPlaybackHost(
      createDeps(content, createSelectionEditor({ from: selectionStart, to: selectionEnd })),
    ).playback

    playback.primeSession(segments, 0, { from: selectionStart, to: selectionEnd })
    playback.recordSegment(0, createSegmentMeta(0, segments[0]))

    playback.syncSelectionStart({ from: selectionStart, to: selectionEnd })

    expect(playback.currentSegmentIndex).toBe(1)
    // Mid-word start snaps to the nearest earlier boundary, not the next one.
    expect(playback.playbackElapsed).toBeCloseTo(0.5, 5)
    expect(playback.totalElapsed).toBeCloseTo(0.5, 5)
  })

  it('does not zero the playback session when selection changes before metadata exists', () => {
    const content = 'First paragraph here.\n\nSecond paragraph here.'
    const selectionStart = content.indexOf('Second')
    const selectionEnd = selectionStart + 'Second'.length
    const segments = splitTtsSegments(content)
    const playback = createPlaybackHost(
      createDeps(content, createSelectionEditor({ from: selectionStart, to: selectionEnd })),
    ).playback

    playback.primeSession(segments, 0, null)
    playback.syncSelectionStart({ from: selectionStart, to: selectionEnd })

    expect(playback.totalSegments).toBe(0)
    expect(playback.totalDuration).toBe(0)
    expect(playback.currentSegmentIndex).toBe(0)
  })

  it('does not clear synthesized timing during the collapsed-then-selected lifecycle', () => {
    const content = 'First paragraph here.\n\nSecond paragraph here.'
    const selectionStart = content.indexOf('paragraph here.')
    const selectionEnd = selectionStart + 'paragraph here.'.length
    const segments = splitTtsSegments(content)
    const playback = createPlaybackHost(
      createDeps(content, createSelectionEditor({ from: selectionStart, to: selectionEnd })),
    ).playback

    playback.primeSession(segments, 0, null)
    playback.recordSegment(0, createSegmentMeta(0, segments[0]))
    playback.recordSegment(1, createSegmentMeta(1, segments[1], {
      boundaries: SECOND_SEGMENT_BOUNDARIES,
      wordBoundaries: SECOND_SEGMENT_BOUNDARIES,
      spokenEnd: 1,
      duration: 1,
    }))

    playback.syncSelectionStart(null)
    expect(playback.totalDuration).toBeCloseTo(2.5, 5)

    playback.syncSelectionStart({ from: selectionStart, to: selectionEnd })
    expect(playback.totalDuration).toBeCloseTo(2.5, 5)
    expect(playback.playbackElapsed).toBeCloseTo(0.5, 5)
  })

  it('selects the current word during playback when word boundaries are present', () => {
    const content = 'First paragraph here.'
    const segments = splitTtsSegments(content)
    let selection: { from: number; to: number } | null = null
    const editor = createSelectionEditor(null, (from, to) => {
      selection = { from, to }
    })
    const { playback, dispose } = createPlaybackHost(createDeps(content, editor))

    playback.primeSession(segments, 0)
    playback.recordSegment(0, createSegmentMeta(0, segments[0]))

    playback.seekTo(0.6)
    flushSync()

    expect(selection).toEqual({ from: 6, to: 15 })
    dispose()
  })

  it('replays a row from a session re-primed by metadata sync', async () => {
    const { playback, dispose } = createPlayback()

    playback.primeSession(splitTtsSegments('Old text only.'), 0)
    playback.primeSession(splitTtsSegments('New first sentence.\n\nNew second sentence.'), 0)

    const finished = playback.playFromSegment(1)
    await vi.waitFor(() => expect(AudioStub.instances.length).toBeGreaterThanOrEqual(2))
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))

    playback.stopPlayback()
    await finished
    dispose()
  })

  describe('silence-free total duration', () => {
    beforeEach(() => {
      AudioStub.instances.length = 0
      vi.stubGlobal('Audio', AudioStub)
      URL.createObjectURL = vi.fn(() => `blob:test-${Math.random()}`)
      URL.revokeObjectURL = vi.fn()
      vi.mocked(getCachedSynthesis).mockImplementation(async () => ({
        blob: new Blob(['audio'], { type: 'audio/mpeg' }),
        boundaries: [] as Array<{ offset: number; at: number }>,
        spokenStart: 0.1,
        spokenEnd: 2.3,
      }))
    })
    afterEach(() => {
      vi.mocked(getCachedSynthesis).mockReset()
    })

    it('does not double the total duration after play then stop', async () => {
      const { playback, dispose } = createPlayback()
      playback.primeSession(splitTtsSegments('One sentence here.'), 0)

      const finished = playback.playFromSegment(0)
      await vi.waitFor(() => expect(AudioStub.instances.length).toBeGreaterThanOrEqual(1))
      await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
      AudioStub.instances[AudioStub.instances.length - 1].onended?.()
      await finished
      await vi.waitFor(() => expect(playback.isPlaybackEnded).toBe(true))

      const expected = 2.3 - 0.1
      expect(playback.totalDuration).toBeCloseTo(expected, 5)

      playback.stopPlayback()
      expect(playback.totalDuration).toBeCloseTo(expected, 5)

      dispose()
    })

    it('keeps the slider at the stopped position instead of jumping to the end', async () => {
      const { playback, dispose } = createPlayback()
      playback.primeSession(splitTtsSegments('One sentence here.'), 0)

      const finished = playback.playFromSegment(0)
      await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
      await vi.waitFor(() => expect(playback.totalDuration).toBeGreaterThan(0))
      playback.stopPlayback()

      expect(playback.isPlaying).toBe(false)
      expect(playback.totalDuration).toBeCloseTo(2.3 - 0.1, 5)
      // the stopped position must stay where playback was, not jump to the end
      expect(playback.totalElapsed).toBeLessThan(playback.totalDuration)

      dispose()
      await finished
    })

    it('reports correct totals after a multi-segment completion', async () => {
      const { playback, dispose } = createPlaybackHost(
        createDeps('First paragraph here.\n\nSecond paragraph here.'),
      )
      // two paragraphs -> two segments, each with a 2.2s spoken span
      const finished = playback.startPlayback()
      await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
      await vi.waitFor(() => expect(playback.totalSegments).toBe(2))
      let guard = 0
      while (!playback.isPlaybackEnded && guard++ < 10) {
        await vi.waitFor(() => {
          const playAudio = AudioStub.instances.filter(a => typeof a.onended === 'function').pop()
          if (!playAudio) throw new Error('play audio not ready')
          playAudio.onended?.()
        })
      }
      await finished
      await vi.waitFor(() => expect(playback.isPlaybackEnded).toBe(true))

      // total 4.4s, not 2.2 (one segment) or 8.8 (doubled)
      expect(playback.totalDuration).toBeCloseTo(2 * (2.3 - 0.1), 5)
      expect(playback.totalElapsed).toBeCloseTo(2 * (2.3 - 0.1), 5)
      dispose()
    })

    it('does not show a doubled elapsed when a stray stop lands at completion', async () => {
      const { playback, dispose } = createPlayback()
      playback.primeSession(splitTtsSegments('One sentence here.'), 0)

      const finished = playback.playFromSegment(0)
      await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
      await vi.waitFor(() => expect(playback.totalDuration).toBeGreaterThan(0))
      AudioStub.instances[AudioStub.instances.length - 1].onended?.()
      // a stray stop arrives right as the segment ends
      playback.stopPlayback()

      await finished
      const expected = 2.3 - 0.1
      // totals stay consistent (no 2x / middle-slider), not the doubled value
      expect(playback.totalElapsed).toBeCloseTo(expected, 5)
      expect(playback.totalDuration).toBeCloseTo(expected, 5)
      dispose()
    })

    it('ignores late timeupdate events after completion', async () => {
      const { playback, dispose } = createPlayback()
      playback.primeSession(splitTtsSegments('One sentence here.'), 0)

      const finished = playback.playFromSegment(0)
      await vi.waitFor(() => expect(AudioStub.instances.length).toBeGreaterThanOrEqual(1))
      await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
      const audio = AudioStub.instances[AudioStub.instances.length - 1]
      audio.currentTime = 2.3
      audio.onended?.()
      await finished
      await vi.waitFor(() => expect(playback.isPlaybackEnded).toBe(true))

      const expected = 2.3 - 0.1
      expect(playback.totalElapsed).toBeCloseTo(expected, 5)
      expect(playback.totalDuration).toBeCloseTo(expected, 5)

      // Some browsers dispatch a final timeupdate after ended/cleanup.
      audio.currentTime = 2.3
      audio.ontimeupdate?.()

      expect(playback.totalElapsed).toBeCloseTo(expected, 5)
      expect(playback.totalDuration).toBeCloseTo(expected, 5)
      dispose()
    })

    it('shows the full elapsed time after a resumed segment finishes', async () => {
      const { playback, dispose } = createPlayback()

      const firstRun = playback.startPlayback()
      await vi.waitFor(() => expect(AudioStub.instances.length).toBeGreaterThanOrEqual(2))
      const firstAudio = AudioStub.instances[AudioStub.instances.length - 1]
      await vi.waitFor(() => expect(playback.isPlaying).toBe(true))

      Object.defineProperty(document, 'hidden', { configurable: true, value: true })
      firstAudio.currentTime = 1.25
      firstAudio.ontimeupdate?.()
      Object.defineProperty(document, 'hidden', { configurable: true, value: false })
      playback.stopPlayback()
      await firstRun

      const resumedRun = playback.startPlayback()
      await vi.waitFor(() => expect(AudioStub.instances.length).toBeGreaterThanOrEqual(4))
      const resumedAudio = AudioStub.instances[AudioStub.instances.length - 1]
      await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
      resumedAudio.currentTime = 5
      resumedAudio.onended?.()

      await resumedRun
      await vi.waitFor(() => expect(playback.isPlaybackEnded).toBe(true))
      expect(playback.totalElapsed).toBeCloseTo(2.3 - 0.1, 5)
      expect(playback.totalDuration).toBeCloseTo(2.3 - 0.1, 5)
      dispose()
    })
  })
})
