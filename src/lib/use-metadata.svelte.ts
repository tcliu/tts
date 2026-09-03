import type { PlaybackHandle, CodeEditorHandle } from './use-playback.svelte'
import type { SettingsHandle } from './use-settings.svelte'
import { activeBoundaryIndexFor, activeWordBoundaryFor } from './metadata/active-index'
import { buildSortedRows, type MetadataWord, type MetadataRow } from './metadata/rows'
export type { MetadataWord, MetadataRow } from './metadata/rows'

interface MetadataDeps {
  settings: SettingsHandle
  playback: PlaybackHandle
  getEditor: () => CodeEditorHandle | null
  getShowMetadata: () => boolean
}

export interface MetadataHandle {
  readonly rows: MetadataRow[]
  readonly totalSentences: number
  readonly positionSentenceIndex: number
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
  const activeInfoOffset = $derived(playback.activeInfoOffset)
  const activeInfoKind = $derived(playback.activeInfoKind)

  // Depends only on the per-frame playbackElapsed, isolating the heavy table
  // rebuild below so it is memoized and does not re-run every animation frame.
  const activeBoundaryIndex = $derived.by(() => {
    if (activeSeg < 0) return -1
    return activeBoundaryIndexFor(playback.segments[activeSeg], activeInfoOffset, playback.playbackElapsed)
  })

  const activeWordBoundary = $derived.by(() => {
    if (activeSeg < 0) return null
    return activeWordBoundaryFor(playback.segments[activeSeg], activeInfoOffset, activeInfoKind, playback.playbackElapsed)
  })

  // Heavy build (segmentation, range matching, sort) depends only on the
  // segment metadata and search query, so it is memoized and re-runs only
  // when those change, not on every playback tick.
  const sortedRows = $derived.by(() => buildSortedRows(playback.segments))

  const baseRows = $derived.by(() => {
    const rows = sortedRows
    const query = metaSearch.trim().toLowerCase()
    if (query) {
      return rows.filter(
        row =>
          row.text.toLowerCase().includes(query) ||
          String(row.offset).includes(query) ||
          row.lang.toLowerCase().includes(query) ||
          row.words.some(word => word.text.toLowerCase().includes(query) || String(word.offset).includes(query)),
      )
    }
    return rows
  })

  const rows = $derived.by(() => {
    const activeWord = activeWordBoundary
    return baseRows.map(row => ({
      ...row,
      active: row.segmentIndex === activeSeg && row.boundaryIndex === activeBoundaryIndex,
      words: row.words.map(word => ({
        ...word,
        active: !!activeWord && row.segmentIndex === activeSeg && word.offsetInSegment === activeWord.offset,
      })),
    }))
  })

  const totalSentences = $derived(sortedRows.length)

  const positionSentenceIndex = $derived.by(() => {
    const rows = sortedRows
    if (rows.length === 0) return -1
    const elapsed = playback.totalElapsed
    let idx = 0
    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i].at <= elapsed) idx = i
      else break
    }
    return idx
  })

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
    get totalSentences() {
      return totalSentences
    },
    get positionSentenceIndex() {
      return positionSentenceIndex
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
