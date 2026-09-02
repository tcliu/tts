import { splitTtsSegments, type TtsSegment } from './tts-reference'
import { isScopeInvalidatedByClearedKeys } from './tts-cache-clear'
import { synthesisCacheKey, CANONICAL_SYNTHESIS_RATE } from './tts-cache-key'
import {
  clearDocumentSynthesisCache,
  clearSynthesisCache,
  clearSynthesisCacheEntries,
  getSynthesisCacheEntries,
  getSynthesisCacheStats,
  peekCachedSynthesis,
  type SynthesisCacheEntry,
  type SynthesisCacheStats,
} from './tts-client'
import type { CodeEditorHandle, PlaybackHandle } from './use-playback.svelte'
import type { SettingsHandle } from './use-settings.svelte'

interface SynthesisCacheDeps {
  settings: SettingsHandle
  playback: PlaybackHandle
  getCacheScopeId: () => string
  getEditor: () => CodeEditorHandle | null
}

export interface SynthesisCacheHandle {
  readonly stats: SynthesisCacheStats | null
  setStatsOpen: (open: boolean) => void
  readonly dialogOpen: boolean
  readonly dialogLoading: boolean
  readonly entries: SynthesisCacheEntry[]
  openDialog: () => Promise<void>
  closeDialog: () => void
  clearAll: () => Promise<void>
  clearSelected: (keys: string[]) => Promise<void>
  resetCurrentDocument: () => void
}

export function useSynthesisCache(deps: SynthesisCacheDeps): SynthesisCacheHandle {
  let statsOpen = $state(false)
  let stats = $state<SynthesisCacheStats | null>(null)
  let dialogOpen = $state(false)
  let dialogLoading = $state(false)
  let entries = $state<SynthesisCacheEntry[]>([])

  $effect(() => {
    if (!statsOpen) return
    let current = true
    void getSynthesisCacheStats().then(next => {
      if (current) stats = next
    })
    return () => {
      current = false
    }
  })

  function currentScopeSegment(segments?: ReturnType<typeof splitTtsSegments>): TtsSegment | null {
    const content = deps.settings.content
    if (!content.trim()) return null
    const playbackSegment = deps.playback.currentSessionSegment
    if (playbackSegment) {
      return playbackSegment
    }
    const resolvedSegments = segments ?? splitTtsSegments(content)
    return resolveCaretScopeSegment(resolvedSegments)
  }

  function resolveCaretScopeSegment(segments: ReturnType<typeof splitTtsSegments>): TtsSegment | null {
    const editorHandle = deps.getEditor()
    const selectionRange = editorHandle?.getSelectionRange?.() ?? null
    const caret = editorHandle?.getCaretPosition?.() ?? selectionRange?.from ?? null
    if (caret == null) return null
    return segments.find(seg => caret >= seg.indexStart && caret <= seg.indexEnd) ?? null
  }

  function currentScopeInvalidatedByClearedKeys(
    clearedKeys: string[],
    cacheEntries = entries,
    segments?: ReturnType<typeof splitTtsSegments>,
  ): boolean {
    const scope = currentScopeSegment(segments)
    return isScopeInvalidatedByClearedKeys(scope, clearedKeys, cacheEntries, {
      resolveVoiceEdge: lang => deps.playback.effectiveVoiceEdge(lang),
    })
  }

  async function loadEntries() {
    dialogLoading = true
    try {
      entries = await getSynthesisCacheEntries()
    } finally {
      dialogLoading = false
    }
  }

  async function openDialog() {
    dialogOpen = true
    await loadEntries()
  }

  function closeDialog() {
    dialogOpen = false
  }

  async function clearAll() {
    const content = deps.settings.content
    let shouldReset = false
    if (content.trim()) {
      if (deps.playback.hasSession || deps.playback.synthesizedCount > 0) {
        shouldReset = true
      } else {
        const segments = splitTtsSegments(content)
        shouldReset = segments.some(seg => {
          const voiceEdge = deps.playback.effectiveVoiceEdge(seg.lang)
          if (!voiceEdge) return false
          return !!peekCachedSynthesis(seg.text, voiceEdge)
        })
        if (!shouldReset) {
          const snapshot = entries.length ? entries : await getSynthesisCacheEntries()
          if (snapshot.length > 0) {
            shouldReset = currentScopeInvalidatedByClearedKeys(
              snapshot.map(entry => entry.key),
              snapshot,
              segments,
            )
          }
        }
      }
    }
    await clearSynthesisCache()
    stats = { segments: 0, bytes: 0 }
    entries = []
    if (shouldReset) deps.playback.resetSession()
  }

  async function clearSelected(keys: string[]) {
    const shouldReset = keys.length > 0 && currentScopeInvalidatedByClearedKeys(keys)
    await clearSynthesisCacheEntries(keys)
    const nextEntries = entries.filter(entry => !keys.includes(entry.key))
    entries = nextEntries
    stats = {
      segments: nextEntries.length,
      bytes: nextEntries.reduce((total, entry) => total + entry.bytes, 0),
    }
    if (shouldReset) deps.playback.resetSession()
  }

  function documentSynthesisCacheKeys(): string[] {
    const content = deps.settings.content
    if (!content.trim()) return []
    return splitTtsSegments(content).flatMap(segment => {
      const edge = deps.playback.effectiveVoiceEdge(segment.lang)
      // rate retained for call-site compat; cache is canonical at 1× per tts-cache-key.ts:5
      return edge ? [synthesisCacheKey(segment.text, edge, CANONICAL_SYNTHESIS_RATE)] : []
    })
  }

  function resetCurrentDocument() {
    const keys = documentSynthesisCacheKeys()
    deps.playback.resetSession()
    void clearDocumentSynthesisCache(deps.getCacheScopeId(), keys)
  }

  return {
    get stats() {
      return stats
    },
    setStatsOpen(open) {
      statsOpen = open
    },
    get dialogOpen() {
      return dialogOpen
    },
    get dialogLoading() {
      return dialogLoading
    },
    get entries() {
      return entries
    },
    openDialog,
    closeDialog,
    clearAll,
    clearSelected,
    resetCurrentDocument,
  }
}
