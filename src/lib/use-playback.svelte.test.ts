import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'

vi.mock('./tts-client', () => ({
  getCachedSynthesis: vi.fn(async () => ({
    blob: new Blob(['audio'], { type: 'audio/mpeg' }),
    boundaries: [] as Array<{ offset: number; at: number }>,
  })),
  peekCachedSynthesis: vi.fn(() => null),
  isSynthesisCacheHydrated: vi.fn(() => true),
  onSynthesisCacheHydrated: vi.fn((callback: () => void) => callback()),
}))

import {
  usePlayback,
  type CodeEditorHandle,
  type PlaybackDeps,
  type PlaybackHandle,
  type SegmentMeta,
} from './use-playback.svelte'
import type { SettingsHandle } from './use-settings.svelte'
import { splitHighlightRanges, splitTtsSegments, type TtsBoundary, type TtsSegment } from './tts-reference'
import { createPlaybackHost } from '../test/create-playback.svelte'
import { getCachedSynthesis, peekCachedSynthesis } from './tts-client'

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
    hasFocus: () => false,
  }
}

function createSettings(content: string): SettingsHandle {
  return {
    locale: 'en',
    speed: 1,
    synthesisConcurrency: 2,
    canPlay: true,
    content,
    resolveVoiceForSegment: () => ({ edge: 'en-US-AriaNeural', name: 'Aria', gender: 'Female' }),
  } as unknown as SettingsHandle
}

function createDeps(content = 'Hello world. Second segment here.', editor?: CodeEditorHandle): PlaybackDeps {
  return {
    settings: createSettings(content),
    getEditor: editor ? () => editor : createEditor,
    getCacheScopeId: () => 'doc-a',
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
    hasFocus: () => false,
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

  it('keeps a selection on the last character of a segment in that segment', async () => {
    const content = 'Hello world.\n\nSecond sentence.'
    const segments = splitTtsSegments(content)
    const firstSegment = segments[0]
    const editor = createSelectionEditor({ from: firstSegment.indexEnd, to: firstSegment.indexEnd + 1 })
    const { playback, dispose } = createPlaybackHost(createDeps(content, editor))

    playback.primeSession(segments, 0, { from: firstSegment.indexEnd, to: firstSegment.indexEnd + 1 })
    playback.recordSegment(0, createSegmentMeta(0, firstSegment))

    playback.syncSelectionStart({ from: firstSegment.indexEnd, to: firstSegment.indexEnd + 1 })
    flushSync()

    expect(playback.currentSegmentIndex).toBe(1)
    dispose()
  })

  it('keeps resuming from the dragged slider position when Play follows the seek', async () => {
    // Reproduces the multi-segment report: boot primes the session with null
    // selections, dragging paints an editor selection that was never recorded,
    // and Play used to treat that mismatch as a brand-new session, wiping the
    // warmed metadata and restarting from zero.
    const content = 'First paragraph here.\n\nSecond paragraph here.'
    const segments = splitTtsSegments(content)
    let selection: { from: number; to: number } | null = null
    const editor: CodeEditorHandle = {
      getSelectionText: () => '',
      getSelectionRange: () => selection,
      setSelection: (from, to) => {
        selection = { from, to }
        return true
      },
      clearSelection: () => {
        selection = null
      },
      focus: () => {},
    hasFocus: () => false,
    }
    const { playback, dispose } = createPlaybackHost(createDeps(content, editor))

    playback.primeSession(segments, 0)
    playback.recordSegment(0, createSegmentMeta(0, segments[0], { duration: 4, spokenEnd: 4 }))
    playback.recordSegment(1, createSegmentMeta(1, segments[1], { duration: 6, spokenEnd: 6 }))
    playback.setSegmentDuration(0, 4)
    playback.setSegmentDuration(1, 6)

    await playback.seekTo(5.5)
    flushSync()
    expect(selection).not.toBeNull()
    expect(playback.totalElapsed).toBeCloseTo(5.5, 2)

    vi.mocked(getCachedSynthesis).mockClear()
    const finished = playback.startPlayback()
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))

    expect(vi.mocked(getCachedSynthesis).mock.calls[0]?.[0]).toBe(segments[1].text)
    expect(playback.playedDuration).toBeCloseTo(4, 2)
    const audio = await vi.waitFor(() => {
      const instance = AudioStub.instances[AudioStub.instances.length - 1]
      expect(instance).toBeDefined()
      return instance
    })
    await vi.waitFor(() => expect(audio.currentTime).toBeCloseTo(1.5, 2))

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

  it('drops stale segment metadata when the content changes between selections', () => {
    const contentA = 'First paragraph here.\n\nSecond paragraph here.'
    const deps = createDeps(contentA, createEditor())
    const { playback, dispose } = createPlaybackHost(deps)

    const segmentsA = splitTtsSegments(contentA)
    playback.primeSession(segmentsA, 0)
    playback.recordSegment(0, createSegmentMeta(0, segmentsA[0]))
    playback.recordSegment(1, createSegmentMeta(1, segmentsA[1]))
    expect(playback.synthesizedCount).toBe(2)

    // A caret move after the content changed must re-split; metadata recorded
    // under the old numbering would otherwise bleed into the new session.
    const contentB = 'First paragraph here.\n\nSecond paragraph here. Third sentence added.'
    ;(deps.settings as unknown as { content: string }).content = contentB
    playback.syncSelectionStart({ from: 0, to: 5 })
    flushSync()

    const segmentsB = splitTtsSegments(contentB)
    expect(playback.sessionSource).toBe(contentB)
    expect(playback.totalSegments).toBe(segmentsB.length)
    expect(playback.synthesizedCount).toBe(0)
    expect(Object.keys(playback.segments)).toHaveLength(0)
    dispose()
  })

  it('ignores incompatible existing metadata when recording a synthesized segment', async () => {
    const content = 'Hello world. Second segment here.'
    const segments = splitTtsSegments(content)
    const editor = createEditor()
    const { playback, dispose } = createPlaybackHost(createDeps(content, editor))

    playback.primeSession(segments, 0)
    // Simulate a leftover entry from an older split: same index, other text.
    playback.recordSegment(0, createSegmentMeta(0, segments[0], { text: 'WRONG', duration: 99 }))

    const finished = playback.startPlayback()
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
    await vi.waitFor(() => expect(playback.segments[0]?.text).toBe(segments[0].text))

    expect(playback.segments[0]?.duration).not.toBe(99)
    expect(playback.segments[0]?.text).not.toBe('WRONG')

    playback.stopPlayback()
    await finished
    dispose()
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

    // The primed session stays intact; the selection change without metadata
    // must not zero or re-prime it.
    expect(playback.totalSegments).toBe(2)
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

    it('treats a stop at the spoken end as a completed playback', async () => {
      const { playback, dispose } = createPlayback()
      playback.primeSession(splitTtsSegments('One sentence here.'), 0)

      const finished = playback.playFromSegment(0)
      await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
      await vi.waitFor(() => expect(playback.totalDuration).toBeGreaterThan(0))

      // Stop lands after the spoken end (e.g. during the trailing silence).
      const audio = AudioStub.instances[AudioStub.instances.length - 1]
      audio.currentTime = 2.31
      playback.stopPlayback()

      expect(playback.isPlaybackEnded).toBe(true)
      expect(playback.totalElapsed).toBeCloseTo(2.3 - 0.1, 5)
      expect(playback.totalDuration).toBeCloseTo(2.3 - 0.1, 5)

      await finished
      dispose()
    })
  })

  it('keeps a seek to the end at the end instead of snapping back to a word', () => {
    // The editor echoes programmatic selections back through
    // syncSelectionStart, like CodeEditor's updateListener does.
    let echo: ((from: number, to: number) => void) | null = null
    const editor: CodeEditorHandle = {
      getSelectionText: () => '',
      getSelectionRange: () => null,
      setSelection: (from, to) => {
        echo?.(from, to)
        return true
      },
      clearSelection: () => {},
      focus: () => {},
    hasFocus: () => false,
    }
    const { playback, dispose } = createPlaybackHost(createDeps('First paragraph here.', editor))
    echo = (from, to) => playback.syncSelectionStart({ from, to })

    const segments = splitTtsSegments('First paragraph here.')
    playback.primeSession(segments, 0)
    playback.recordSegment(0, createSegmentMeta(0, segments[0]))

    playback.seekTo(1.5)
    flushSync()

    // The selection echo of the seek must not rewind the position to the
    // last word boundary (1.1s).
    expect(playback.playbackElapsed).toBeCloseTo(1.5, 5)
    expect(playback.totalElapsed).toBeCloseTo(1.5, 5)

    dispose()
  })

  it('derives status-strip facts from the segment at the slider position', () => {
    const { playback, dispose } = createPlayback()
    const segments = splitTtsSegments('First paragraph here.\n\nSecond paragraph here.')
    playback.primeSession(segments, 0)
    playback.recordSegment(0, createSegmentMeta(0, segments[0]))
    playback.recordSegment(1, createSegmentMeta(1, segments[1], {
      boundaries: SECOND_SEGMENT_BOUNDARIES,
      wordBoundaries: SECOND_SEGMENT_BOUNDARIES,
      spokenEnd: 1,
      duration: 1,
    }))

    // Before any playback the position sits at the first segment.
    expect(playback.positionSegmentIndex).toBe(0)
    expect(playback.positionSegmentLang).toBe('en')
    expect(playback.positionVoiceName).toBe('Aria')

    playback.seekTo(2.5)
    flushSync()

    // 2.5s lands inside the second segment (first spans 0-1.5s).
    expect(playback.positionSegmentIndex).toBe(1)
    expect(playback.positionSegmentLang).toBe('en')
    expect(playback.positionVoiceName).toBe('Aria')

    dispose()
  })

  it('warmFromCache surfaces only cached segments without playing', () => {
    const content = 'First paragraph here.\n\nSecond paragraph here.'
    const segments = splitTtsSegments(content)
    vi.mocked(peekCachedSynthesis).mockImplementation((text) =>
      text === segments[0].text
        ? {
            blob: new Blob(['audio'], { type: 'audio/mpeg' }),
            boundaries: FIRST_SEGMENT_BOUNDARIES,
            wordBoundaries: FIRST_SEGMENT_BOUNDARIES,
            spokenStart: 0,
            spokenEnd: 1.5,
          }
        : null,
    )

    const { playback, dispose } = createPlaybackHost(createDeps(content))

    playback.warmFromCache()

    expect(playback.hasSession).toBe(true)
    expect(playback.totalSegments).toBe(2)
    expect(playback.synthesizedCount).toBe(1)
    expect(playback.totalDuration).toBeCloseTo(1.5, 5)
    expect(playback.positionSegmentIndex).toBe(0)
    expect(playback.isPlaying).toBe(false)

    vi.mocked(peekCachedSynthesis).mockReset()
    dispose()
  })

  it('synthesizes segments ahead of playback, not just on demand', async () => {
    const content = 'First paragraph here.\n\nSecond paragraph here.'
    const segments = splitTtsSegments(content)
    const requested: string[] = []
    let releaseSynthesis: () => void = () => {}
    const firstGate = new Promise<void>(resolve => {
      releaseSynthesis = resolve
    })
    vi.mocked(getCachedSynthesis).mockImplementation(async text => {
      requested.push(text)
      if (text === segments[0].text) {
        await firstGate
      }
      return {
        blob: new Blob(['audio'], { type: 'audio/mpeg' }),
        boundaries: [] as Array<{ offset: number; at: number }>,
      }
    })

    const { playback, dispose } = createPlaybackHost(createDeps(content))
    const finished = playback.startPlayback()
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))

    // Both segments are requested while the first audio is still playing.
    await vi.waitFor(() => expect(requested).toContain(segments[1].text))
    expect(requested).toContain(segments[0].text)

    releaseSynthesis()
    playback.stopPlayback()
    await finished

    vi.mocked(getCachedSynthesis).mockReset()
    dispose()
  })
})

describe('usePlayback segment language override', () => {
  beforeEach(() => {
    AudioStub.instances.length = 0
    vi.stubGlobal('Audio', AudioStub)
    URL.createObjectURL = vi.fn(() => `blob:test-${Math.random()}`)
    URL.revokeObjectURL = vi.fn()
  })

  function createSpyDeps() {
    const resolveVoiceForSegment = vi.fn((segmentLang: string) => {
      if (segmentLang === 'ja') return { edge: 'ja-JP-NanamiNeural', name: 'Nanami', gender: 'Female' }
      if (segmentLang === 'yue') return { edge: 'zh-HK-HiuMaanNeural', name: 'HiuMaan', gender: 'Female' }
      return { edge: 'en-US-AriaNeural', name: 'Aria', gender: 'Female' }
    })
    const selectVoice = vi.fn()
    const content = 'First paragraph here.\n\nSecond paragraph here.'
    const deps: PlaybackDeps = {
      settings: {
        locale: 'en',
        speed: 1,
        synthesisConcurrency: 2,
        canPlay: true,
        content,
        resolveVoiceForSegment,
        selectVoice,
      } as unknown as SettingsHandle,
      getEditor: createEditor,
      getCacheScopeId: () => 'doc-a',
      prepareForPlayback: () => {},
    }
    return { deps, content, resolveVoiceForSegment, selectVoice }
  }

  it('resynthesizes with the resolved voice and applies the override to the position', async () => {
    const { deps, content, resolveVoiceForSegment, selectVoice } = createSpyDeps()
    const { playback, dispose } = createPlaybackHost(deps)
    const segments = splitTtsSegments(content)
    playback.primeSession(segments, 0)
    playback.recordSegment(0, createSegmentMeta(0, segments[0]))

    await playback.overrideSegmentLanguage(0, 'ja')
    flushSync()

    expect(resolveVoiceForSegment).toHaveBeenCalledWith('ja')
    expect(selectVoice).not.toHaveBeenCalled()
    expect(getCachedSynthesis).toHaveBeenCalledWith(segments[0].text, 'ja-JP-NanamiNeural', 1, undefined, 'doc-a')
    expect(playback.positionSegmentLang).toBe('ja')
    dispose()
  })

  it('maps spoken overrides onto the written language without touching global voice selection', async () => {
    const { deps, content, selectVoice } = createSpyDeps()
    const { playback, dispose } = createPlaybackHost(deps)
    const segments = splitTtsSegments(content)
    playback.primeSession(segments, 0)
    playback.recordSegment(0, createSegmentMeta(0, segments[0]))

    await playback.overrideSegmentLanguage(0, 'yue')
    flushSync()

    expect(selectVoice).not.toHaveBeenCalled()
    expect(playback.positionSegmentLang).toBe('yue')
    expect(playback.positionLanguageCode).toBe('zh')
    dispose()
  })

  it('leaves the segment untouched when no voice resolves for the language', async () => {
    const { deps, content, resolveVoiceForSegment } = createSpyDeps()
    resolveVoiceForSegment.mockImplementation((segmentLang: string) =>
      segmentLang === 'ko'
        ? (undefined as unknown as { edge: string; name: string; gender: string })
        : { edge: 'en-US-AriaNeural', name: 'Aria', gender: 'Female' },
    )
    const { playback, dispose } = createPlaybackHost(deps)
    const segments = splitTtsSegments(content)
    playback.primeSession(segments, 0)
    playback.recordSegment(0, createSegmentMeta(0, segments[0]))

    await playback.overrideSegmentLanguage(0, 'ko')
    flushSync()

    expect(resolveVoiceForSegment).toHaveBeenCalledWith('ko')
    expect(playback.positionSegmentLang).toBe('en')
    expect(getCachedSynthesis).not.toHaveBeenCalledWith(segments[0].text, undefined, 1, undefined, 'doc-a')
    dispose()
  })

  it('keeps overrides when re-priming the same split and clears them on a new split or reset', async () => {
    const { deps, content } = createSpyDeps()
    const { playback, dispose } = createPlaybackHost(deps)
    const segments = splitTtsSegments(content)
    playback.primeSession(segments, 0)
    playback.recordSegment(0, createSegmentMeta(0, segments[0]))
    await playback.overrideSegmentLanguage(0, 'ja')
    flushSync()
    expect(playback.positionSegmentLang).toBe('ja')

    // Re-priming the same array keeps index-keyed overrides.
    playback.primeSession(segments, 0)
    expect(playback.positionSegmentLang).toBe('ja')

    // A new split invalidates the overrides.
    playback.primeSession(splitTtsSegments(content), 0)
    flushSync()
    expect(playback.positionSegmentLang).toBe('en')

    playback.resetSession()
    flushSync()
    expect(playback.positionSegmentLang).toBe('')
    dispose()
  })
})

describe('usePlayback voice override during playback', () => {
  beforeEach(() => {
    AudioStub.instances.length = 0
    vi.stubGlobal('Audio', AudioStub)
    URL.createObjectURL = vi.fn(() => `blob:test-${Math.random()}`)
    URL.revokeObjectURL = vi.fn()
  })

  const DEFAULT_VOICE = 'en-US-AriaNeural'
  const OVERRIDE_VOICE = 'en-US-GuyNeural'

  // The override voice times the same words differently: 'paragraph' starts
  // at 0.7s instead of 0.5s and the spoken range runs to 2s instead of 1.5s.
  const OVERRIDE_BOUNDARIES: TtsBoundary[] = [
    { offset: 0, at: 0, text: 'First' },
    { offset: 6, at: 0.7, text: 'paragraph' },
    { offset: 16, at: 1.5, text: 'here.' },
  ]

  let releaseOverrideSynthesis: (() => void) | null = null

  function mockSynthesisPerVoice({ holdOverride = false }: { holdOverride?: boolean } = {}) {
    releaseOverrideSynthesis = null
    vi.mocked(getCachedSynthesis).mockImplementation(async (_text: string, voiceId: string) => {
      if (voiceId === OVERRIDE_VOICE && holdOverride) {
        await new Promise<void>(resolve => {
          releaseOverrideSynthesis = resolve
        })
      }
      return {
        blob: new Blob(['audio'], { type: 'audio/mpeg' }),
        boundaries: [],
        wordBoundaries: voiceId === OVERRIDE_VOICE ? OVERRIDE_BOUNDARIES : FIRST_SEGMENT_BOUNDARIES,
        spokenStart: 0,
        spokenEnd: voiceId === OVERRIDE_VOICE ? 2 : 1.5,
      }
    })
    vi.mocked(getCachedSynthesis).mockClear()
  }

  function createSpyDeps(content = 'First paragraph here.\n\nSecond paragraph here.') {
    const deps: PlaybackDeps = {
      settings: {
        locale: 'en',
        speed: 1,
        synthesisConcurrency: 2,
        canPlay: true,
        content,
        resolveVoiceForSegment: () => ({ edge: DEFAULT_VOICE, name: 'Aria', gender: 'Female' }),
      } as unknown as SettingsHandle,
      getEditor: createEditor,
      getCacheScopeId: () => 'doc-a',
      prepareForPlayback: () => {},
    }
    return { deps, content }
  }

  // Only playback-audio stubs ever play; duration-reading stubs stay paused.
  function playingAudio(): AudioStub[] {
    return AudioStub.instances.filter(item => !item.paused)
  }

  async function startPlaybackAndGetAudio(playback: PlaybackHandle) {
    const finished = playback.startPlayback()
    await vi.waitFor(() => expect(playingAudio().length).toBeGreaterThan(0))
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
    return { finished, audio: playingAudio()[playingAudio().length - 1] }
  }

  it('pauses, resynthesizes with the new voice, and resumes from the same word', async () => {
    mockSynthesisPerVoice()
    const { deps, content } = createSpyDeps()
    const { playback, dispose } = createPlaybackHost(deps)
    const segments = splitTtsSegments(content)
    playback.primeSession(segments, 0)
    playback.recordSegment(0, createSegmentMeta(0, segments[0]))

    const { finished, audio } = await startPlaybackAndGetAudio(playback)
    audio.currentTime = 0.6

    await playback.overrideSegmentVoice(0, OVERRIDE_VOICE)

    expect(getCachedSynthesis).toHaveBeenCalledWith(segments[0].text, OVERRIDE_VOICE, 1, undefined, 'doc-a')
    expect(playback.effectiveVoiceEdge('en')).toBe(OVERRIDE_VOICE)
    // 'paragraph' (offset 6) starts at 0.7s in the override voice's timing.
    await vi.waitFor(() => expect(playback.playbackElapsed).toBeCloseTo(0.7, 5))
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
    // The rest of the session synthesizes with the override voice too.
    await vi.waitFor(() =>
      expect(getCachedSynthesis).toHaveBeenCalledWith(
        segments[1].text,
        OVERRIDE_VOICE,
        1,
        expect.any(AbortSignal),
        'doc-a',
      ),
    )

    playback.stopPlayback()
    await finished
    dispose()
  })

  it('finishes instead of resuming when the stop lands at the spoken end', async () => {
    mockSynthesisPerVoice()
    const { deps, content } = createSpyDeps('First paragraph here.')
    const { playback, dispose } = createPlaybackHost(deps)
    const segments = splitTtsSegments(content)
    playback.primeSession(segments, 0)
    playback.recordSegment(0, createSegmentMeta(0, segments[0]))

    const { finished, audio } = await startPlaybackAndGetAudio(playback)
    audio.currentTime = 1.5

    await playback.overrideSegmentVoice(0, OVERRIDE_VOICE)

    expect(playback.isPlaybackEnded).toBe(true)
    expect(playback.isPlaying).toBe(false)
    expect(getCachedSynthesis).not.toHaveBeenCalledWith(segments[0].text, OVERRIDE_VOICE, 1, undefined, 'doc-a')
    expect(playback.effectiveVoiceEdge('en')).toBe(OVERRIDE_VOICE)

    await finished
    dispose()
  })

  it('ignores a pick of the already-active voice during playback', async () => {
    mockSynthesisPerVoice()
    const { deps } = createSpyDeps('First paragraph here.')
    const { playback, dispose } = createPlaybackHost(deps)
    const segments = splitTtsSegments('First paragraph here.')
    playback.primeSession(segments, 0)
    playback.recordSegment(0, createSegmentMeta(0, segments[0]))

    const { finished, audio } = await startPlaybackAndGetAudio(playback)
    const audioCount = AudioStub.instances.length

    await playback.overrideSegmentVoice(0, DEFAULT_VOICE)

    await Promise.resolve()
    expect(AudioStub.instances.length).toBe(audioCount)
    expect(playingAudio()).toEqual([audio])
    expect(playback.isPlaying).toBe(true)

    playback.stopPlayback()
    await finished
    dispose()
  })

  it('remaps the paused resume time onto the new voice timing', async () => {
    mockSynthesisPerVoice()
    const { deps, content } = createSpyDeps('First paragraph here.')
    const { playback, dispose } = createPlaybackHost(deps)
    const segments = splitTtsSegments(content)
    playback.primeSession(segments, 0)
    playback.recordSegment(0, createSegmentMeta(0, segments[0]))

    playback.seekTo(0.6)
    flushSync()
    expect(playback.playbackElapsed).toBeCloseTo(0.6, 5)

    await playback.overrideSegmentVoice(0, OVERRIDE_VOICE)

    // 'paragraph' starts at 0.7s in the override voice's timing.
    expect(playback.playbackElapsed).toBeCloseTo(0.7, 5)

    // The next Play resumes at the remapped word position.
    const finished = playback.startPlayback()
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
    await vi.waitFor(() => expect(playback.playbackElapsed).toBeCloseTo(0.7, 5))
    playback.stopPlayback()
    await finished
    dispose()
  })

  it('gates Play and abandons the resume when stopped while switching', async () => {
    mockSynthesisPerVoice({ holdOverride: true })
    const { deps } = createSpyDeps('First paragraph here.')
    const { playback, dispose } = createPlaybackHost(deps)
    const segments = splitTtsSegments('First paragraph here.')
    playback.primeSession(segments, 0)
    playback.recordSegment(0, createSegmentMeta(0, segments[0]))

    const { audio } = await startPlaybackAndGetAudio(playback)
    audio.currentTime = 0.6

    const switched = playback.overrideSegmentVoice(0, OVERRIDE_VOICE)
    await vi.waitFor(() => expect(playback.voiceSwitching).toBe(true))
    expect(playback.isPlaying).toBe(false)

    // Play during the switch's synthesis must not start a second session.
    await playback.startPlayback()
    expect(playback.isPlaying).toBe(false)

    // Seek and row-play are inert during the switch's synthesis too; the
    // pending resume must not be clobbered or raced.
    const elapsedDuringSwitch = playback.playbackElapsed
    await playback.seekTo(0.2)
    await playback.playFromSegment(0)
    expect(playback.playbackElapsed).toBe(elapsedDuringSwitch)
    expect(playback.isPlaying).toBe(false)

    // Stop during the switch abandons the pending resume entirely.
    playback.stopPlayback()
    flushSync()
    releaseOverrideSynthesis?.()
    await switched
    await Promise.resolve()
    expect(playback.voiceSwitching).toBe(false)
    expect(playback.isPlaying).toBe(false)
    expect(playingAudio()).toEqual([])
    expect(playback.effectiveVoiceEdge('en')).toBe(OVERRIDE_VOICE)
    dispose()
  })

  it('surfaces a failed paused voice change and keeps the previous voice', async () => {
    mockSynthesisPerVoice()
    const { deps } = createSpyDeps('First paragraph here.')
    const { playback, dispose } = createPlaybackHost(deps)
    const segments = splitTtsSegments('First paragraph here.')
    playback.primeSession(segments, 0)
    playback.recordSegment(0, createSegmentMeta(0, segments[0]))

    vi.mocked(getCachedSynthesis).mockRejectedValueOnce(new Error('synthesis down'))
    await playback.overrideSegmentVoice(0, OVERRIDE_VOICE)

    expect(playback.statusMessage).toBe('Playback failed.')
    expect(playback.effectiveVoiceEdge('en')).toBe(DEFAULT_VOICE)
    dispose()
  })
})
