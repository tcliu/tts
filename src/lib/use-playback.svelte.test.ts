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
    setPlaybackHighlight: () => {},
    setPlaybackHighlightSelected: () => {},
    clearPlaybackHighlight: () => {},
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
    setPlaybackHighlight: (from: number, to: number) => {
      onSetSelection?.(from, to)
    },
    setPlaybackHighlightSelected: (from: number, to: number) => {
      onSetSelection?.(from, to)
    },
    clearPlaybackHighlight: () => {},
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

  it('treats a one-character selection at a segment edge as scoped playback', async () => {
    const content = 'Hello world.\n\nSecond sentence.'
    const segments = splitTtsSegments(content)
    const firstSegment = segments[0]
    const editor = createSelectionEditor({ from: firstSegment.indexEnd, to: firstSegment.indexEnd + 1 })
    const { playback, dispose } = createPlaybackHost(createDeps(content, editor))

    playback.primeSession(segments, 0, { from: firstSegment.indexEnd, to: firstSegment.indexEnd + 1 })
    playback.recordSegment(0, createSegmentMeta(0, firstSegment))

    playback.syncSelectionStart({ from: firstSegment.indexEnd, to: firstSegment.indexEnd + 1 })
    flushSync()

    expect(playback.currentSegmentIndex).toBe(0)
    expect(playback.playbackElapsed).toBe(0)
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
    let highlight: { from: number; to: number } | null = null
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
      setPlaybackHighlight: (from, to) => {
        highlight = { from, to }
      },
      setPlaybackHighlightSelected: (from, to) => {
        highlight = { from, to }
      },
      clearPlaybackHighlight: () => {
        highlight = null
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
    expect(highlight).not.toBeNull()
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

  it('treats a collapsed selection as caret positioning for the next Play', async () => {
    const content = 'First paragraph here.\n\nSecond paragraph here.'
    const caret = content.indexOf('Second')
    const editor = createSelectionEditor({ from: caret, to: caret })
    const { playback, dispose } = createPlaybackHost(createDeps(content, editor))

    const segments = splitTtsSegments(content)
    playback.primeSession(segments, 0, { from: caret, to: caret })
    playback.recordSegment(0, createSegmentMeta(0, segments[0], { duration: 4, spokenEnd: 4 }))
    playback.recordSegment(1, createSegmentMeta(1, segments[1], { duration: 6, spokenEnd: 6 }))

    playback.syncSelectionStart({ from: caret, to: caret })
    flushSync()

    expect(playback.currentSegmentIndex).toBe(2)
    expect(playback.playbackElapsed).toBe(0)

    vi.mocked(getCachedSynthesis).mockClear()
    const finished = playback.startPlayback()
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
    expect(vi.mocked(getCachedSynthesis).mock.calls[0]?.[0]).toBe(segments[1].text)

    playback.stopPlayback()
    await finished
    dispose()
  })

  it('plays only the selected text before playback starts', async () => {
    const content = 'First paragraph here.\n\nSecond paragraph here.'
    const selectionStart = content.indexOf('Second')
    const editor = createSelectionEditor({ from: selectionStart, to: selectionStart + 'Second'.length })
    const { playback, dispose } = createPlaybackHost(createDeps(content, editor))

    vi.mocked(getCachedSynthesis).mockClear()
    const finished = playback.startPlayback()
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))

    expect(playback.totalSegments).toBe(1)
    expect(playback.currentSegmentIndex).toBe(1)
    expect(vi.mocked(getCachedSynthesis).mock.calls.map(call => call[0])).toEqual(['Second'])

    playback.stopPlayback()
    await finished
    dispose()
  })

  it('keeps the native selection untouched while selected-text playback drives a separate highlight', async () => {
    const content = 'First paragraph here.\n\nSecond paragraph here.'
    const selectionStart = content.indexOf('Second')
    const selection = { from: selectionStart, to: selectionStart + 'Second paragraph here.'.length }
    const highlights: Array<{ from: number; to: number }> = []
    const editor: CodeEditorHandle = {
      getSelectionText: () => content.slice(selection.from, selection.to),
      getSelectionRange: () => selection,
      setSelection: () => false,
      clearSelection: () => {},
      setPlaybackHighlight: (from, to) => {
        highlights.push({ from, to })
      },
      setPlaybackHighlightSelected: (from, to) => {
        highlights.push({ from, to })
      },
      clearPlaybackHighlight: () => {},
      focus: () => {},
      hasFocus: () => false,
    }
    const { playback, dispose } = createPlaybackHost(createDeps(content, editor))

    vi.mocked(getCachedSynthesis).mockClear()
    vi.mocked(getCachedSynthesis).mockImplementationOnce(async () => ({
      blob: new Blob(['audio'], { type: 'audio/mpeg' }),
      boundaries: [{ offset: 0, at: 0, text: 'Second paragraph here.' }],
      wordBoundaries: [
        { offset: 0, at: 0, text: 'Second' },
        { offset: 7, at: 0.6, text: 'paragraph' },
        { offset: 17, at: 1.2, text: 'here.' },
      ],
      spokenStart: 0,
      spokenEnd: 1.8,
    }))
    const finished = playback.startPlayback()
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
    await vi.waitFor(() => expect(highlights.length).toBeGreaterThan(0))

    expect(editor.getSelectionRange()).toEqual(selection)
    expect(vi.mocked(getCachedSynthesis).mock.calls[0]?.[0]).toBe('Second paragraph here.')

    playback.stopPlayback()
    await finished
    dispose()
  })

  it('reuses cached synthesis for whole-word selections without including earlier words', async () => {
    const content = 'First second third fourth fifth sixth'
    const selectionText = 'third fourth fifth'
    const selectionStart = content.indexOf(selectionText)
    const selection = { from: selectionStart, to: selectionStart + selectionText.length }
    const highlights: Array<{ from: number; to: number }> = []
    const editor: CodeEditorHandle = {
      getSelectionText: () => content.slice(selection.from, selection.to),
      getSelectionRange: () => selection,
      setSelection: () => false,
      clearSelection: () => {},
      setPlaybackHighlight: (from, to) => {
        highlights.push({ from, to })
      },
      setPlaybackHighlightSelected: (from, to) => {
        highlights.push({ from, to })
      },
      clearPlaybackHighlight: () => {},
      focus: () => {},
      hasFocus: () => false,
    }
    vi.mocked(peekCachedSynthesis).mockImplementation((text) => {
      if (text !== content) return null
      return {
        blob: new Blob(['audio'], { type: 'audio/mpeg' }),
        boundaries: [
          { offset: 0, at: 0, text: content },
        ],
        wordBoundaries: [
          { offset: 0, at: 0, text: 'First' },
          { offset: 6, at: 0.4, text: 'second' },
          { offset: 13, at: 0.8, text: 'third' },
          { offset: 19, at: 1.2, text: 'fourth' },
          { offset: 26, at: 1.6, text: 'fifth' },
          { offset: 32, at: 2.0, text: 'sixth' },
        ],
        spokenStart: 0,
        spokenEnd: 2.4,
      }
    })
    const { playback, dispose } = createPlaybackHost(createDeps(content, editor))

    const finished = playback.startPlayback()
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
    await vi.waitFor(() => expect(AudioStub.instances.length).toBeGreaterThan(0))
    const audio = AudioStub.instances[AudioStub.instances.length - 1]

    expect(playback.totalSegments).toBe(1)
    expect(playback.positionSegmentText).toBe(selectionText)
    expect(audio.currentTime).toBeCloseTo(0.8, 5)
    expect(highlights[0]).toEqual({ from: selectionStart, to: selectionStart + 'third'.length })

    playback.stopPlayback()
    await finished
    vi.mocked(peekCachedSynthesis).mockReset()
    dispose()
  })

  it('stops selected cached playback at the last selected word end instead of the next word start', async () => {
    const content = 'First second third fourth fifth sixth'
    const selectionText = 'third fourth fifth'
    const selectionStart = content.indexOf(selectionText)
    const selection = { from: selectionStart, to: selectionStart + selectionText.length }
    const editor = createSelectionEditor(selection)
    vi.mocked(peekCachedSynthesis).mockImplementation((text) => {
      if (text !== content) return null
      return {
        blob: new Blob(['audio'], { type: 'audio/mpeg' }),
        boundaries: [{ offset: 0, at: 0, text: content }],
        wordBoundaries: [
          { offset: 0, at: 0, text: 'First', duration: 0.25 },
          { offset: 6, at: 0.4, text: 'second', duration: 0.25 },
          { offset: 13, at: 0.8, text: 'third', duration: 0.25 },
          { offset: 19, at: 1.2, text: 'fourth', duration: 0.25 },
          { offset: 26, at: 1.6, text: 'fifth', duration: 0.25 },
          { offset: 32, at: 2.0, text: 'sixth', duration: 0.25 },
        ],
        spokenStart: 0,
        spokenEnd: 2.4,
      }
    })
    const { playback, dispose } = createPlaybackHost(createDeps(content, editor))

    const finished = playback.startPlayback()
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
    await vi.waitFor(() => expect(playback.totalDuration).toBeGreaterThan(0))

    expect(playback.totalDuration).toBeCloseTo((1.6 + 0.25) - 0.8, 5)

    playback.stopPlayback()
    await finished
    vi.mocked(peekCachedSynthesis).mockReset()
    dispose()
  })

  it('plays isolated short words from the start of the audio blob instead of a trimmed spoken window', async () => {
    const content = 'the city completely wakes up'
    const segments = splitTtsSegments(content)
    const editor = createSelectionEditor(null)
    const { playback, dispose } = createPlaybackHost(createDeps(content, editor))

    playback.primeSession(segments, 0)
    playback.recordSegment(0, createSegmentMeta(0, segments[0], {
      boundaries: [{ offset: 0, at: 0.1, text: content }],
      wordBoundaries: [
        { offset: 0, at: 0.1, text: 'the' },
        { offset: 4, at: 0.21, text: 'city' },
      ],
      spokenStart: 0.1,
      spokenEnd: 1.5,
      duration: 1.4,
    }))

    vi.mocked(getCachedSynthesis).mockImplementationOnce(async () => ({
      blob: new Blob(['audio'], { type: 'audio/mpeg' }),
      boundaries: [{ offset: 0, at: 0.1, text: 'the' }],
      wordBoundaries: [{ offset: 0, at: 0.1, text: 'the' }],
      spokenStart: 0.1,
      spokenEnd: 0.18,
    }))

    const finished = playback.playWord(0, segments[0].indexStart)
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))
    const audio = await vi.waitFor(() => {
      const instance = AudioStub.instances[AudioStub.instances.length - 1]
      expect(instance).toBeDefined()
      return instance
    })
    await vi.waitFor(() => expect(audio.currentTime).toBe(0))

    playback.stopPlayback()
    await finished
    dispose()
  })

  it('scopes sentence-row playback highlight to the clicked sentence even when boundary text is shorter than the sentence', async () => {
    const content = 'First sentence here. Second sentence there.'
    const segments = splitTtsSegments(content)
    const highlights: Array<{ from: number; to: number }> = []
    const editor: CodeEditorHandle = {
      getSelectionText: () => '',
      getSelectionRange: () => null,
      setSelection: () => false,
      clearSelection: () => {},
      setPlaybackHighlight: (from, to) => {
        highlights.push({ from, to })
      },
      setPlaybackHighlightSelected: (from, to) => {
        highlights.push({ from, to })
      },
      clearPlaybackHighlight: () => {},
      focus: () => {},
      hasFocus: () => false,
    }
    const { playback, dispose } = createPlaybackHost(createDeps(content, editor))

    playback.primeSession(segments, 0)
    playback.recordSegment(0, createSegmentMeta(0, segments[0], {
      boundaries: [
        { offset: 0, at: 0, text: 'First' },
        { offset: 'First sentence here. '.length, at: 1.2, text: 'Second' },
      ],
      wordBoundaries: [
        { offset: 0, at: 0, text: 'First' },
        { offset: 6, at: 0.3, text: 'sentence' },
        { offset: 15, at: 0.6, text: 'here.' },
        { offset: 21, at: 1.2, text: 'Second' },
        { offset: 28, at: 1.5, text: 'sentence' },
        { offset: 37, at: 1.8, text: 'there.' },
      ],
      spokenStart: 0,
      spokenEnd: 2.4,
      duration: 2.4,
    }))

    const finished = playback.playSentence(0, segments[0].indexStart)
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))

    expect(highlights[0]).toEqual({ from: 0, to: 'First sentence here.'.length })

    playback.stopPlayback()
    await finished
    dispose()
  })

  it('keeps sentence-row highlight scoped when isolated playback only has sentence boundaries', async () => {
    const content = 'First sentence here. Second sentence there.'
    const segments = splitTtsSegments(content)
    const highlights: Array<{ from: number; to: number }> = []
    const editor: CodeEditorHandle = {
      getSelectionText: () => '',
      getSelectionRange: () => null,
      setSelection: () => false,
      clearSelection: () => {},
      setPlaybackHighlight: (from, to) => {
        highlights.push({ from, to })
      },
      setPlaybackHighlightSelected: (from, to) => {
        highlights.push({ from, to })
      },
      clearPlaybackHighlight: () => {},
      focus: () => {},
      hasFocus: () => false,
    }
    const { playback, dispose } = createPlaybackHost(createDeps(content, editor))

    playback.primeSession(segments, 0)
    playback.recordSegment(0, createSegmentMeta(0, segments[0], {
      boundaries: [
        { offset: 0, at: 0, text: 'First' },
        { offset: 'First sentence here. '.length, at: 1.2, text: 'Second' },
      ],
      wordBoundaries: [],
      spokenStart: 0,
      spokenEnd: 2.4,
      duration: 2.4,
    }))

    vi.mocked(getCachedSynthesis).mockImplementationOnce(async () => ({
      blob: new Blob(['audio'], { type: 'audio/mpeg' }),
      boundaries: [{ offset: 0, at: 0, text: 'First sentence here.' }],
      wordBoundaries: [],
      spokenStart: 0,
      spokenEnd: 1.2,
    }))

    const finished = playback.playSentence(0, segments[0].indexStart)
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))

    expect(highlights[0]).toEqual({ from: 0, to: 'First sentence here.'.length })

    playback.stopPlayback()
    await finished
    dispose()
  })

  it('isolates a synthetic sentence row instead of the whole segment when Edge under-splits boundaries', async () => {
    const content = '塔尖仍舊記得 這擁抱極美好'
    const segments = splitTtsSegments(content)
    const highlights: Array<{ from: number; to: number }> = []
    const editor: CodeEditorHandle = {
      getSelectionText: () => '',
      getSelectionRange: () => null,
      setSelection: () => false,
      clearSelection: () => {},
      setPlaybackHighlight: (from, to) => {
        highlights.push({ from, to })
      },
      setPlaybackHighlightSelected: (from, to) => {
        highlights.push({ from, to })
      },
      clearPlaybackHighlight: () => {},
      focus: () => {},
      hasFocus: () => false,
    }
    const { playback, dispose } = createPlaybackHost(createDeps(content, editor))

    playback.primeSession(segments, 0)
    playback.recordSegment(0, createSegmentMeta(0, segments[0], {
      lang: 'zh',
      boundaries: [{ offset: 0, at: 0, text: content }],
      wordBoundaries: [],
      spokenStart: 0,
      spokenEnd: 2,
      duration: 2,
    }))

    const finished = playback.playSentence(0, segments[0].indexStart)
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true))

    expect(highlights[0]).toEqual({ from: 0, to: '塔尖仍舊記得'.length })

    playback.stopPlayback()
    await finished
    dispose()
  })

  it('stores a non-empty manual selection as playback scope instead of seek position', () => {
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

    expect(playback.currentSegmentIndex).toBe(0)
    expect(playback.playbackElapsed).toBe(0)
    expect(playback.totalElapsed).toBe(0)
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

  it('keeps mid-word manual selection scoped instead of snapping playback immediately', () => {
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

    expect(playback.currentSegmentIndex).toBe(0)
    expect(playback.playbackElapsed).toBe(0)
    expect(playback.totalElapsed).toBe(0)
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
    expect(playback.playbackElapsed).toBe(0)
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

  it('updates the cached playback session when selection scope changes', () => {
    const content = 'First paragraph here.\n\nSecond paragraph here.'
    const fullSegments = splitTtsSegments(content)
    const scopedStart = content.indexOf('Second')
    const scopedEnd = scopedStart + 'Second paragraph here.'.length
    let selection: { from: number; to: number } | null = null
    const editor: CodeEditorHandle = {
      getSelectionText: () => (selection ? content.slice(selection.from, selection.to) : ''),
      getSelectionRange: () => selection,
      getCaretPosition: () => selection?.to ?? 0,
      setSelection: () => false,
      clearSelection: () => {},
      setPlaybackHighlight: () => {},
      setPlaybackHighlightSelected: () => {},
      clearPlaybackHighlight: () => {},
      focus: () => {},
      hasFocus: () => false,
    }

    vi.mocked(peekCachedSynthesis).mockImplementation((text) => {
      if (text === fullSegments[0].text) {
        return {
          blob: new Blob(['audio'], { type: 'audio/mpeg' }),
          boundaries: FIRST_SEGMENT_BOUNDARIES,
          wordBoundaries: FIRST_SEGMENT_BOUNDARIES,
          spokenStart: 0,
          spokenEnd: 1.5,
        }
      }
      if (text === fullSegments[1].text) {
        return {
          blob: new Blob(['audio'], { type: 'audio/mpeg' }),
          boundaries: SECOND_SEGMENT_BOUNDARIES,
          wordBoundaries: SECOND_SEGMENT_BOUNDARIES,
          spokenStart: 0,
          spokenEnd: 1,
        }
      }
      if (text === 'Second paragraph here.') {
        return {
          blob: new Blob(['audio'], { type: 'audio/mpeg' }),
          boundaries: [{ offset: 0, at: 0, text: 'Second paragraph here.' }],
          wordBoundaries: [
            { offset: 0, at: 0, text: 'Second' },
            { offset: 7, at: 0.6, text: 'paragraph' },
            { offset: 17, at: 0.9, text: 'here.' },
          ],
          spokenStart: 0,
          spokenEnd: 1.2,
        }
      }
      return null
    })

    const { playback, dispose } = createPlaybackHost(createDeps(content, editor))

    playback.warmFromCache()
    expect(playback.synthesizedCount).toBe(2)
    expect(playback.totalDuration).toBeCloseTo(2.5, 5)

    selection = { from: scopedStart, to: scopedEnd }
    playback.syncSelectionStart(selection)
    flushSync()

    expect(playback.totalSegments).toBe(1)
    expect(playback.positionSegmentText).toBe('Second paragraph here.')
    expect(playback.totalDuration).toBeCloseTo(1, 5)

    selection = null
    playback.syncSelectionStart(null)
    flushSync()

    expect(playback.totalSegments).toBe(2)
    expect(playback.synthesizedCount).toBe(2)
    expect(playback.totalDuration).toBeCloseTo(2.5, 5)

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

  it('keeps the chip voice model stable when manual selections change within the same written language', async () => {
    const content = '嘅咗唔啲佢嗰哋畀 你好世界'
    const resolveVoiceForSegment = vi.fn((segmentLang: string) => {
      if (segmentLang === 'yue') return { edge: 'zh-HK-HiuMaanNeural', name: 'HiuMaan', gender: 'Female' }
      if (segmentLang === 'zh') return { edge: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao', gender: 'Female' }
      return { edge: 'en-US-AriaNeural', name: 'Aria', gender: 'Female' }
    })
    const deps: PlaybackDeps = {
      settings: {
        locale: 'en',
        speed: 1,
        synthesisConcurrency: 2,
        canPlay: true,
        content,
        resolveVoiceForSegment,
      } as unknown as SettingsHandle,
      getEditor: createEditor,
      getCacheScopeId: () => 'doc-a',
      prepareForPlayback: () => {},
    }
    const { playback, dispose } = createPlaybackHost(deps)
    const segments = splitTtsSegments(content)

    playback.primeSession([segments[0]], 0)
    playback.recordSegment(0, createSegmentMeta(0, segments[0], { lang: 'yue' }))
    flushSync()
    expect(playback.positionSegmentLang).toBe('yue')
    expect(playback.positionLanguageCode).toBe('zh')
    expect(playback.positionVoiceName).toBe('Xiaoxiao')
    expect(playback.positionVoiceEdge).toBe('zh-CN-XiaoxiaoNeural')

    playback.primeSession([segments[1]], 0)
    playback.recordSegment(0, createSegmentMeta(0, segments[1], { lang: 'zh' }))
    flushSync()
    expect(playback.positionSegmentLang).toBe('zh')
    expect(playback.positionLanguageCode).toBe('zh')
    expect(playback.positionVoiceName).toBe('Xiaoxiao')
    expect(playback.positionVoiceEdge).toBe('zh-CN-XiaoxiaoNeural')

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

  it('reuses an already-scoped manual-selection session after a paused voice change', async () => {
    mockSynthesisPerVoice()
    const content = 'First paragraph here.'
    const selectionStart = content.indexOf('paragraph')
    const selection = { from: selectionStart, to: selectionStart + 'paragraph'.length }
    const editor = createSelectionEditor(selection)
    const { deps } = createSpyDeps(content)

    vi.mocked(peekCachedSynthesis).mockImplementation((text, voiceId) => {
      if (text !== content) return null
      return {
        blob: new Blob(['audio'], { type: 'audio/mpeg' }),
        boundaries: [{ offset: 0, at: 0, text: content }],
        wordBoundaries: voiceId === OVERRIDE_VOICE ? OVERRIDE_BOUNDARIES : FIRST_SEGMENT_BOUNDARIES,
        spokenStart: 0,
        spokenEnd: voiceId === OVERRIDE_VOICE ? 2 : 1.5,
      }
    })

    const host = createPlaybackHost({ ...deps, getEditor: () => editor })
    const selectedPlayback = host.playback
    const segments = splitTtsSegments(content)
    selectedPlayback.primeSession(segments, 0, selection)
    selectedPlayback.recordSegment(0, createSegmentMeta(0, segments[0], {
      text: 'paragraph',
      boundaries: [{ offset: 0, at: 0, text: 'paragraph' }],
      wordBoundaries: [{ offset: 0, at: 0, text: 'paragraph' }],
      baseOffset: selectionStart,
      spokenStart: 0,
      spokenEnd: 0.5,
      duration: 0.5,
    }))

    await selectedPlayback.overrideSegmentVoice(0, OVERRIDE_VOICE)
    expect(selectedPlayback.effectiveVoiceEdge('en')).toBe(OVERRIDE_VOICE)

    vi.mocked(getCachedSynthesis).mockClear()
    const finished = selectedPlayback.startPlayback()
    await vi.waitFor(() => expect(selectedPlayback.isPlaying).toBe(true))

    expect(vi.mocked(getCachedSynthesis).mock.calls[0]?.[1]).toBe(OVERRIDE_VOICE)

    selectedPlayback.stopPlayback()
    await finished
    vi.mocked(peekCachedSynthesis).mockReset()
    host.dispose()
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

  it('takes the re-synthesized duration when merging into same-text boundary-less meta', async () => {
    // A boundary-less segment synthesized ahead (same text, stale duration)
    // must not keep its old voice timing when the pipeline re-synthesizes it:
    // the fresh duration drives totalDuration and the row time.
    vi.mocked(getCachedSynthesis).mockImplementation(async () => ({
      blob: new Blob(['audio'], { type: 'audio/mpeg' }),
      boundaries: [],
      wordBoundaries: [],
      spokenStart: undefined,
      spokenEnd: undefined,
    }))
    const { deps, content } = createSpyDeps('First paragraph here.\n\nSecond paragraph here.')
    const { playback, dispose } = createPlaybackHost(deps)
    const segments = splitTtsSegments(content)
    playback.primeSession(segments, 0)
    playback.recordSegment(1, createSegmentMeta(1, segments[1], {
      boundaries: [],
      wordBoundaries: [],
      spokenStart: undefined,
      spokenEnd: undefined,
      duration: 3,
    }))

    const finished = playback.startPlayback()
    await vi.waitFor(() => expect(playback.segments[1]?.duration).toBe(5))
    // Segment 0 is freshly synthesized (duration 5 from the stub), segment 1
    // must reflect the re-synthesized duration, not the stale 3.
    expect(playback.totalDuration).toBeCloseTo(10, 5)
    playback.stopPlayback()
    await finished
    dispose()
  })
})

describe('usePlayback playback speed session', () => {
  beforeEach(() => {
    AudioStub.instances.length = 0
    vi.stubGlobal('Audio', AudioStub)
    URL.createObjectURL = vi.fn(() => `blob:test-${Math.random()}`)
    URL.revokeObjectURL = vi.fn()
  })

  it('defaults playbackSpeed to the persisted default speed', () => {
    const { playback, dispose } = createPlayback()
    expect(playback.playbackSpeed).toBe(1)
    expect(playback.effectiveSpeed).toBe(1)
    dispose()
  })

  it('adjusting the speed chip overrides the session without mutating the default', () => {
    const deps = createDeps()
    const { playback, dispose } = createPlaybackHost(deps)
    const defaultSpeed = deps.settings.speed
    expect(defaultSpeed).toBe(1)

    playback.setPlaybackSpeed(3)
    // Override applies to the session and the audio rate divisor.
    expect(playback.playbackSpeed).toBe(3)
    expect(playback.effectiveSpeed).toBe(3)
    // The persisted default setting is untouched.
    expect(deps.settings.speed).toBe(defaultSpeed)

    // Selecting the default clears the override so future default changes win.
    playback.setPlaybackSpeed(defaultSpeed)
    expect(playback.effectiveSpeed).toBe(defaultSpeed)
    expect(playback.playbackSpeed).toBe(defaultSpeed)
    dispose()
  })

  it('ignores out-of-range speeds outside SPEEDS', () => {
    const deps = createDeps()
    const { playback, dispose } = createPlaybackHost(deps)
    playback.setPlaybackSpeed(9)
    expect(playback.effectiveSpeed).toBe(deps.settings.speed)
    dispose()
  })

  it('clears the per-session speed when the session is re-primed with new segments', () => {
    const deps = createDeps('First paragraph here.\n\nSecond paragraph here.')
    const { playback, dispose } = createPlaybackHost(deps)
    playback.setPlaybackSpeed(2)
    expect(playback.effectiveSpeed).toBe(2)

    // Re-prime with a different segment array; the override must not leak.
    const nextSegments = splitTtsSegments('First paragraph here.\n\nSecond paragraph here.\n\nExtra paragraph.')
    playback.primeSession(nextSegments, 0)
    expect(playback.effectiveSpeed).toBe(deps.settings.speed)
    dispose()
  })
})
