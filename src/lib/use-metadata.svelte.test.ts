import { describe, expect, it } from 'vitest'
import { useMetadata, type MetadataHandle } from './use-metadata.svelte'
import type { PlaybackHandle, SegmentMeta } from './use-playback.svelte'
import type { SettingsHandle } from './use-settings.svelte'
import { splitHighlightRanges } from './tts-reference'

function segment(index: number, text: string, overrides: Partial<SegmentMeta> = {}): SegmentMeta {
  return {
    index,
    lang: 'en',
    text,
    ranges: splitHighlightRanges(text),
    boundaries: [],
    baseOffset: index * 100,
    ...overrides,
  }
}

function createMetadata(playback: PlaybackHandle): { metadata: MetadataHandle; dispose: () => void } {
  let handle: MetadataHandle | null = null
  const dispose = $effect.root(() => {
    handle = useMetadata({
      settings: { content: '' } as unknown as SettingsHandle,
      playback,
      getEditor: () => null,
      getShowMetadata: () => true,
    })
  })
  if (!handle) {
    throw new Error('metadata handle was not created')
  }
  return { metadata: handle, dispose }
}

describe('useMetadata rows', () => {
  it('keeps boundary-less segments visible in document order', () => {
    const segments: Record<number, SegmentMeta> = {
      0: segment(0, 'Hello world.', {
        boundaries: [
          { offset: 0, at: 0, text: 'Hello' },
          { offset: 6, at: 0.5, text: 'world.' },
        ],
        duration: 2,
      }),
      // A segment whose synthesis returned no sentence boundaries must still
      // produce a row, or the Seg column shows a gap that reads as disorder.
      1: segment(1, 'Второй абзац без границ.', { duration: 3 }),
      2: segment(2, 'Third paragraph.', {
        boundaries: [{ offset: 0, at: 0, text: 'Third paragraph.' }],
        duration: 4,
      }),
    }
    const playback = {
      isPlaying: false,
      currentSegmentIndex: 0,
      playbackElapsed: 0,
      segments,
    } as unknown as PlaybackHandle

    const { metadata, dispose } = createMetadata(playback)
    try {
      expect(metadata.rows.map(row => row.segmentIndex)).toEqual([0, 0, 1, 2])
      expect(metadata.rows.map(row => row.at)).toEqual([0, 0.5, 2, 5])
      expect(metadata.rows[2]).toMatchObject({
        segmentIndex: 1,
        at: 2,
        offset: 100,
        text: 'Второй абзац без границ.',
      })
      expect(metadata.rows[3].at).toBe(5)
    } finally {
      dispose()
    }
  })

  it('uses spoken duration for cumulative row timing when spoken bounds are known', () => {
    const segments: Record<number, SegmentMeta> = {
      0: segment(0, 'Intro with leading silence.', {
        boundaries: [{ offset: 0, at: 2, text: 'Intro' }],
        duration: 10,
        spokenStart: 2,
        spokenEnd: 5,
      }),
      1: segment(1, 'Next paragraph.', {
        boundaries: [{ offset: 0, at: 0, text: 'Next paragraph.' }],
        duration: 4,
      }),
    }
    const playback = {
      isPlaying: false,
      currentSegmentIndex: 0,
      playbackElapsed: 0,
      segments,
    } as unknown as PlaybackHandle

    const { metadata, dispose } = createMetadata(playback)
    try {
      expect(metadata.rows.map(row => row.at)).toEqual([2, 3])
    } finally {
      dispose()
    }
  })
})
