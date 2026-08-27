import { splitHighlightRanges, splitTtsSegments, type TtsBoundary } from './tts-reference'
import { getCachedSynthesis } from './tts-client'
import type { PlaybackHandle, CodeEditorHandle, SegmentMeta } from './use-playback.svelte'
import type { SettingsHandle } from './use-settings.svelte'

export interface MetadataRow {
  segmentIndex: number
  at: number
  offset: number
  lang: string
  text: string
  boundaryIndex: number
  active: boolean
}

interface MetadataDeps {
  settings: SettingsHandle
  playback: PlaybackHandle
  getEditor: () => CodeEditorHandle | null
  getShowMetadata: () => boolean
}

export interface MetadataHandle {
  readonly rows: MetadataRow[]
  readonly search: string
  setSearch: (value: string) => void
  readonly syncing: boolean
  readonly stale: boolean
  followSentence: boolean
  attachScrollContainer: (element: HTMLDivElement | null) => void
  prepareForPlayback: () => void
}

const RESYNC_DEBOUNCE_MS = 500

export function useMetadata(deps: MetadataDeps): MetadataHandle {
  let metaSearch = $state('')
  let metaSyncing = $state(false)
  let metaStale = $state(false)
  let metaDirty = $state(false)

  let metaController: { cancelled: boolean } | null = null
  let metaAbort: AbortController | null = null
  let metaBaseline = ''
  let metaDebounce: ReturnType<typeof setTimeout> | null = null

  const { playback, settings } = deps
  let scrollContainer: HTMLDivElement | null = null
  let followSentence = $state(true)

  const activeSeg = $derived(playback.isPlaying ? playback.currentSegmentIndex - 1 : -1)

  // Depends only on the per-frame playbackElapsed, isolating the heavy table
  // rebuild below so it is memoized and does not re-run every animation frame.
  const activeBoundaryIndex = $derived.by(() => {
    if (activeSeg < 0) return -1
    const meta = playback.segments[activeSeg]
    if (!meta) return -1
    let idx = -1
    const boundaries = meta.boundaries
    for (let i = 0; i < boundaries.length; i += 1) {
      if (boundaries[i].at <= playback.playbackElapsed) idx = i
      else break
    }
    return idx
  })

  // Heavy build (segmentation, range matching, sort) depends only on the
  // segment metadata and search query, so it is memoized and re-runs only
  // when those change, not on every playback tick.
  const baseRows = $derived.by(() => {
    const result: MetadataRow[] = []
    const segmentMetaMap = playback.segments
    let cumulative = 0
    const indices = Object.keys(segmentMetaMap).map(Number).sort((a, b) => a - b)
    for (const i of indices) {
      const meta = segmentMetaMap[i]
      if (!meta) continue
      const lastAt = meta.boundaries.length > 0 ? meta.boundaries[meta.boundaries.length - 1].at : 0
      const segDuration = meta.duration ?? lastAt
      meta.boundaries.forEach((boundary, boundaryIndex) => {
        const range =
          meta.ranges.find(r => boundary.offset >= r.start && boundary.offset < r.end) ?? meta.ranges[meta.ranges.length - 1]
        const text = boundary.text ?? (range ? meta.text.slice(range.start, range.end) : '')
        result.push({
          segmentIndex: meta.index,
          at: cumulative + boundary.at,
          offset: meta.baseOffset + boundary.offset,
          lang: meta.lang,
          text,
          boundaryIndex,
          active: false,
        })
      })
      cumulative += segDuration
    }
    result.sort((a, b) => a.segmentIndex - b.segmentIndex || a.at - b.at)
    const query = metaSearch.trim().toLowerCase()
    if (query) {
      return result.filter(
        row =>
          row.text.toLowerCase().includes(query) ||
          String(row.offset).includes(query) ||
          row.lang.toLowerCase().includes(query),
      )
    }
    return result
  })

  const rows = $derived(
    baseRows.map(row => ({
      ...row,
      active: row.segmentIndex === activeSeg && row.boundaryIndex === activeBoundaryIndex,
    })),
  )

  function scrollActiveIntoView() {
    if (!followSentence || !scrollContainer) return
    const container = scrollContainer
    const el = container.querySelector<HTMLElement>('tr[data-active="true"]')
    if (!el) return
    const containerRect = container.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const elTop = elRect.top - containerRect.top + container.scrollTop
    const elBottom = elRect.bottom - containerRect.top + container.scrollTop
    const remaining = container.scrollHeight - elBottom
    const headerHeight = container.querySelector('thead')?.offsetHeight ?? 0
    const target = remaining <= container.clientHeight ? container.scrollHeight : Math.max(0, elTop - headerHeight)
    const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    container.scrollTo({ top: target, behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  const activeRowOffset = $derived.by(() => {
    const active = rows.find(row => row.active)
    return active ? active.offset : -1
  })

  // Keyed on the active row's offset only: re-running on every elapsed-time
  // write would re-measure and re-scroll ~60x/second during playback.
  $effect(() => {
    const offset = activeRowOffset
    if (offset < 0) {
      return
    }
    scrollActiveIntoView()
  })

  // Content edits invalidate the session metadata; refresh it in the
  // background once typing pauses.
  $effect(() => {
    if (playback.isPlaying) {
      return
    }
    const signature = settings.content
    // Compare against the last-synced content. Unlike the prior metaSignature
    // gate this bootstraps from an empty baseline, so edits made before any
    // playback still mark the table stale and trigger a background refresh.
    if (signature !== metaBaseline && !metaDirty) {
      metaDirty = true
    }
    if (!metaDirty || !deps.getShowMetadata()) {
      return
    }
    metaDirty = false
    metaBaseline = signature
    cancelPendingSynthesis()
    playback.clearSegments()
    playback.setMetadataAvailability(false)
    metaStale = true
    metaDebounce = setTimeout(() => {
      metaDebounce = null
      if (!playback.isPlaying) {
        resyncMetadata()
      }
    }, RESYNC_DEBOUNCE_MS)
  })

  function currentMetaSignature(): string {
    // Content only: replay-from-row uses the stored session, so selection
    // changes must not mark the metadata stale.
    return settings.content
  }

  function cancelPendingSynthesis() {
    if (metaController) {
      metaController.cancelled = true
    }
    metaAbort?.abort()
    metaAbort = null
    if (metaDebounce) {
      clearTimeout(metaDebounce)
      metaDebounce = null
    }
  }

  async function resyncMetadata() {
    cancelPendingSynthesis()
    const controller: { cancelled: boolean } = { cancelled: false }
    metaController = controller
    const abort = new AbortController()
    metaAbort = abort
    const editor = deps.getEditor()
    const selectedRange = editor?.getSelectionRange() ?? null
    const content = settings.content
    const signature = currentMetaSignature()
    // Playback always covers the full document; a selection only decides
    // where playback starts.
    const segments = splitTtsSegments(content)

    // Keep the replay session in lockstep with the table: rows are rendered
    // from this segmentation, so playFromSegment must index into exactly it.
    playback.clearSegments()
    playback.primeSession(segments, 0, selectedRange)
    metaStale = false
    if (segments.length === 0) {
      metaBaseline = signature
      if (metaController === controller) {
        metaController = null
      }
      metaAbort = null
      return
    }

    metaSyncing = true
    try {
      // Bounded parallel warm-up honoring the synthesis concurrency setting;
      // failures are best-effort and must not leak into the playback status line.
      let nextIndex = 0
      const workerCount = Math.max(1, Math.min(settings.synthesisConcurrency, segments.length))
      const recordSegment = (
        index: number,
        entry: { boundaries: TtsBoundary[]; wordBoundaries?: TtsBoundary[]; spokenStart?: number; spokenEnd?: number },
      ) => {
        const segment = segments[index]
        const record: SegmentMeta = {
          index,
          lang: segment.lang,
          text: segment.text,
          ranges: splitHighlightRanges(segment.text),
          boundaries: entry.boundaries,
          wordBoundaries: entry.wordBoundaries ?? [],
          baseOffset: segment.indexStart,
          spokenStart: entry.spokenStart,
          spokenEnd: entry.spokenEnd,
        }
        playback.recordSegment(index, record)
      }
      const workers = Array.from({ length: workerCount }, async () => {
        while (!controller.cancelled && !abort.signal.aborted) {
          const index = nextIndex
          if (index >= segments.length) return
          nextIndex += 1
          const segment = segments[index]
          const voice = settings.resolveVoiceForSegment(segment.lang)
          if (!voice?.edge) {
            continue
          }
          try {
            const entry = await getCachedSynthesis(segment.text, voice.edge, settings.speed, abort.signal)
            if (controller.cancelled || abort.signal.aborted) {
              return
            }
            recordSegment(index, entry)
          } catch {
            if (controller.cancelled || abort.signal.aborted) {
              return
            }
            console.error(`Metadata synthesis failed for segment ${index + 1}.`)
          }
        }
      })
      await Promise.all(workers)
      if (controller.cancelled || abort.signal.aborted) {
        return
      }
      metaBaseline = signature
      metaDirty = false
      metaStale = false
      playback.setMetadataAvailability(Object.keys(playback.segments).length > 0)
    } finally {
      if (metaController === controller) {
        metaController = null
        metaSyncing = false
      }
      if (metaAbort === abort) {
        metaAbort = null
      }
    }
  }

  function prepareForPlayback() {
    metaBaseline = currentMetaSignature()
    metaSearch = ''
    metaStale = false
    metaDirty = false
    cancelPendingSynthesis()
  }

  return {
    get rows() {
      return rows
    },
    get search() {
      return metaSearch
    },
    setSearch(value) {
      metaSearch = value
    },
    get syncing() {
      return metaSyncing
    },
    get stale() {
      return metaStale
    },
    get followSentence() {
      return followSentence
    },
    set followSentence(value) {
      followSentence = value
    },
    attachScrollContainer(element) {
      scrollContainer = element
    },
    prepareForPlayback,
  }
}
