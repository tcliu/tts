import type { PlaybackHandle, CodeEditorHandle } from './use-playback.svelte'
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
  readonly stale: boolean
  followSentence: boolean
  attachScrollContainer: (element: HTMLDivElement | null) => void
  prepareForPlayback: () => void
}

export const RESYNC_DEBOUNCE_MS = 500

export function useMetadata(deps: MetadataDeps): MetadataHandle {
  let metaSearch = $state('')
  let metaStale = $state(false)
  let metaDirty = $state(false)

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

  // Content edits invalidate the session metadata; refresh the cached
  // segments in the background once typing pauses. Uncached synthesis stays
  // deferred to Play (warmFromCache only records cached results).
  $effect(() => {
    if (playback.isPlaying) {
      return
    }
    const signature = settings.content
    // Compare against the last-synced content. This bootstraps from an empty
    // baseline, so edits made before any playback still mark the table stale
    // and trigger a background refresh.
    if (signature !== metaBaseline && !metaDirty) {
      metaDirty = true
    }
    if (!metaDirty || !deps.getShowMetadata()) {
      return
    }
    metaDirty = false
    metaBaseline = signature
    cancelPendingResync()
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

  function cancelPendingResync() {
    if (metaDebounce) {
      clearTimeout(metaDebounce)
      metaDebounce = null
    }
  }

  function resyncMetadata() {
    cancelPendingResync()
    const signature = currentMetaSignature()
    // The page effect already primes the session from cache on open and on
    // debounced edits; skip the redundant full re-warm when it already did.
    if (playback.sessionSource !== signature) {
      playback.warmFromCache()
    }
    metaBaseline = signature
    metaDirty = false
    metaStale = false
  }

  function prepareForPlayback() {
    metaBaseline = currentMetaSignature()
    metaSearch = ''
    metaStale = false
    metaDirty = false
    cancelPendingResync()
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
