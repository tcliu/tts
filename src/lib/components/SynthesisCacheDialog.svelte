<script lang="ts">
  import { onDestroy } from 'svelte'
  import BaseDialog from '$lib/components/BaseDialog.svelte'
  import Button from '$lib/components/Button.svelte'
  import DataTable, { type DataTableColumn } from '$lib/components/DataTable.svelte'
  import { REFERENCE_LANGUAGES } from '$lib/tts-reference'
  import { UI_TEXT, segmentLanguageName, type UiLocale } from '$lib/ui-text'
  import { formatBytes } from '$lib/format-bytes'
  import type { SynthesisCacheEntry } from '$lib/tts-client'

  interface Props {
    locale: UiLocale
    entries: SynthesisCacheEntry[]
    loading?: boolean
    onCancel: () => void
    onClearSelected: (keys: string[]) => void | Promise<void>
    onBeforePlay?: () => void
  }

  let {
    locale,
    entries,
    loading = false,
    onCancel,
    onClearSelected,
    onBeforePlay,
  }: Props = $props()

  const text = $derived(UI_TEXT[locale])

  let search = $state('')
  let selectedKeys = $state(new Set<string>())
  let playing = $state(false)
  let currentAudio = $state<HTMLAudioElement | null>(null)
  let currentAudioUrl = $state('')
  let playGeneration = 0

  let page = $state(1)
  let pageSize = $state(10)
  let sortKey = $state<string | null>(null)
  let sortDir = $state<'asc' | 'desc'>('asc')

  const voiceLookup = new Map(
    REFERENCE_LANGUAGES.flatMap(language =>
      language.voices.map(voice => [
        voice.edge,
        {
          languageCode: language.code,
          languageName: language.name,
          voiceName: voice.name,
          gender: voice.gender,
          group: voice.group ?? '',
        },
      ]),
    ),
  )

  const query = $derived(search.trim().toLowerCase())

  const filteredEntries = $derived.by(() => {
    if (!query) return entries
    return entries.filter(entry => {
      const voice = voiceLookup.get(entry.voiceId)
      const haystack = [
        entry.text,
        entry.voiceId,
        entry.docId ?? '',
        voice?.voiceName ?? '',
        voice?.group ?? '',
        voice?.languageCode ?? '',
        voice?.languageName ?? '',
      ]
        .join('\n')
        .toLowerCase()
      return haystack.includes(query)
    })
  })

  const sortedEntries = $derived.by(() => {
    if (!sortKey) return filteredEntries
    const copy = [...filteredEntries]
    copy.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'lang': {
          cmp = languageLabel(a).localeCompare(languageLabel(b))
          break
        }
        case 'voice': {
          cmp = voiceLabel(a).localeCompare(voiceLabel(b))
          break
        }
        case 'text': {
          cmp = a.text.localeCompare(b.text)
          break
        }
        case 'size': {
          cmp = a.bytes - b.bytes
          break
        }
        case 'saved': {
          cmp = a.savedAt - b.savedAt
          break
        }
        default:
          cmp = 0
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  })

  const total = $derived(sortedEntries.length)
  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)))
  const paginatedEntries = $derived(sortedEntries.slice((page - 1) * pageSize, page * pageSize))

  $effect(() => {
    void total
    void pageSize
    if (page > totalPages) page = totalPages
  })
  $effect(() => {
    void query
    void sortKey
    void sortDir
    page = 1
  })

  const selectedEntries = $derived(entries.filter(entry => selectedKeys.has(entry.key)))
  const visibleSelectedCount = $derived(paginatedEntries.filter(entry => selectedKeys.has(entry.key)).length)
  const allVisibleSelected = $derived(paginatedEntries.length > 0 && visibleSelectedCount === paginatedEntries.length)
  const someVisibleSelected = $derived(visibleSelectedCount > 0 && !allVisibleSelected)
  const hasSelection = $derived(selectedKeys.size > 0)
  const totalBytes = $derived(entries.reduce((sum, entry) => sum + entry.bytes, 0))

  const columns = $derived.by<DataTableColumn<SynthesisCacheEntry>[]>(() => [
    {
      key: 'lang',
      header: text.tableLang,
      width: '14%',
      minWidth: 120,
      sortable: true,
      searchable: true,
      cell: langCell,
    },
    {
      key: 'voice',
      header: text.tableVoice,
      width: '20%',
      minWidth: 160,
      sortable: true,
      searchable: true,
      cell: voiceCell,
    },
    {
      key: 'text',
      header: text.tableText,
      width: '36%',
      minWidth: 200,
      searchable: true,
      cell: textCell,
    },
    {
      key: 'size',
      header: text.tableSize,
      width: '12%',
      minWidth: 90,
      sortable: true,
      cell: sizeCell,
    },
    {
      key: 'saved',
      header: text.tableSaved,
      width: '18%',
      minWidth: 140,
      sortable: true,
      cell: savedCell,
    },
  ])

  $effect(() => {
    const liveKeys = new Set(entries.map(entry => entry.key))
    let changed = false
    const next = new Set<string>()
    for (const key of selectedKeys) {
      if (liveKeys.has(key)) {
        next.add(key)
      } else {
        changed = true
      }
    }
    if (changed) {
      selectedKeys = next
    }
  })

  onDestroy(() => {
    stopPlayback()
  })

  const savedAtFormatter = $derived(
    new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }),
  )

  function formatSavedAt(savedAt: number): string {
    return savedAtFormatter.format(savedAt)
  }

  function voiceMeta(entry: SynthesisCacheEntry) {
    return voiceLookup.get(entry.voiceId)
  }

  function voiceLabel(entry: SynthesisCacheEntry): string {
    const meta = voiceMeta(entry)
    if (!meta && !entry.voiceId) return '\u2014'
    if (!meta) return entry.voiceId
    const pieces = [meta.voiceName, meta.gender]
    if (meta.group) pieces.push(meta.group)
    return pieces.join(' · ')
  }

  function languageLabel(entry: SynthesisCacheEntry): string {
    const code = voiceMeta(entry)?.languageCode
    return code ? `${segmentLanguageName(locale, code)} · ${code}` : '\u2014'
  }

  function snippet(textValue: string): string {
    const trimmed = textValue.trim()
    if (!trimmed) return '\u2014'
    return trimmed.length > 160 ? `${trimmed.slice(0, 160)}...` : trimmed
  }

  function toggleSelection(key: string, checked: boolean) {
    const next = new Set(selectedKeys)
    if (checked) {
      next.add(key)
    } else {
      next.delete(key)
    }
    selectedKeys = next
  }

  function toggleAllVisible() {
    const next = new Set(selectedKeys)
    if (allVisibleSelected) {
      for (const entry of paginatedEntries) {
        next.delete(entry.key)
      }
    } else {
      for (const entry of paginatedEntries) {
        next.add(entry.key)
      }
    }
    selectedKeys = next
  }

  function handleSort(key: string, direction: 'asc' | 'desc') {
    sortKey = key
    sortDir = direction
  }

  function handlePageChange(next: number) {
    if (next < 1 || next > totalPages || next === page) return
    page = next
  }

  function handlePageSizeChange(size: number) {
    pageSize = size
    page = 1
  }

  async function clearSelected() {
    const keys = [...selectedKeys]
    if (keys.length === 0) return
    stopPlayback()
    await onClearSelected(keys)
    selectedKeys = new Set()
  }

  function cleanupAudio() {
    currentAudio?.pause()
    currentAudio = null
    if (currentAudioUrl) {
      URL.revokeObjectURL(currentAudioUrl)
      currentAudioUrl = ''
    }
  }

  function stopPlayback() {
    playGeneration += 1
    playing = false
    cleanupAudio()
  }

  function playBlob(blob: Blob, generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio()
      const url = URL.createObjectURL(blob)
      currentAudio = audio
      currentAudioUrl = url
      audio.src = url
      audio.onended = () => {
        if (playGeneration === generation) {
          cleanupAudio()
        }
        resolve()
      }
      audio.onerror = () => {
        if (playGeneration === generation) {
          cleanupAudio()
        }
        reject(new Error(UI_TEXT[locale].playbackFailed))
      }
      audio.play().catch(error => {
        if (playGeneration === generation) {
          cleanupAudio()
        }
        reject(error)
      })
    })
  }

  async function playSelected() {
    if (playing) {
      stopPlayback()
      return
    }
    const queue = selectedEntries.filter(entry => entry.segment.blob)
    if (queue.length === 0) return
    stopPlayback()
    onBeforePlay?.()
    const generation = playGeneration
    playing = true
    try {
      for (const entry of queue) {
        if (playGeneration !== generation) return
        await playBlob(entry.segment.blob, generation)
      }
    } catch (error) {
      console.error(error)
    } finally {
      if (playGeneration === generation) {
        playing = false
        cleanupAudio()
      }
    }
  }
</script>

<BaseDialog title={text.synthesisCacheDetailsTitle} maxWidth="wide" height="tall" closeLabel={text.close} onCancel={onCancel}>
  <div class="flex min-h-0 flex-1 flex-col gap-1.5">
    <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-slate-100">{text.synthesisCache}</p>
        <p class="mt-0.5 text-xs text-slate-400" aria-live="polite">
          {#if selectedKeys.size === 0}
            {entries.length} {text.segmentsUnit} · {formatBytes(totalBytes)}
          {:else}
            {selectedKeys.size} {text.cacheEntriesSelected} · {entries.length} {text.segmentsUnit} · {formatBytes(totalBytes)}
          {/if}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={!hasSelection} ariaLabel={text.clearSelectedCacheEntries} onClick={() => void clearSelected()}>
          {text.clear}
        </Button>
        <Button variant={playing ? 'outline' : 'primary'} disabled={!hasSelection} ariaLabel={playing ? text.stopSelectedCachePlayback : text.playSelectedCacheEntries} onClick={() => void playSelected()}>
          {playing ? text.stop : text.playback}
        </Button>
      </div>
    </div>

    <DataTable
      rows={paginatedEntries}
      rowId={entry => entry.key}
      {columns}
      loading={loading}
      emptyMessage={search.trim() ? text.noMatchingCacheEntries : text.cachedSegmentsNone}
      bind:searchValue={search}
      searchAriaLabel={text.cacheSearch}
      searchPlaceholder={text.cacheSearch}
      selectable
      selectedIds={selectedKeys}
      onToggleSelection={toggleSelection}
      onToggleAll={toggleAllVisible}
      allSelected={allVisibleSelected}
      someSelected={someVisibleSelected}
      selectAllAriaLabel={text.selectAllCacheEntries}
      rowSelectAriaLabel={() => text.selectCacheEntry}
      total={total}
      pageSize={pageSize}
      currentPage={page}
      onPageChange={handlePageChange}
      onPageSizeChange={handlePageSizeChange}
      bind:sortKey={sortKey}
      bind:sortDirection={sortDir}
      onSort={handleSort}
      sortAriaLabel={(col, dir) => (dir === 'asc' ? text.tableSortAsc : text.tableSortDesc).replace('{name}', col.header)}
      resizeAriaLabel={col => text.tableResize.replace('{name}', col.header)}
      paginationPreviousLabel={text.paginationPrevious}
      paginationNextLabel={text.paginationNext}
      paginationPageSizeLabel={text.paginationPageSize}
      paginationCurrentLabel={text.paginationPage}
      paginationLabel={text.paginationPage}
      fillHeight
      tableClass="w-full"
      resizable
      storageKey="synthesis-cache" />
  </div>
</BaseDialog>

{#snippet langCell(entry: SynthesisCacheEntry)}
  <span class="text-slate-400">{languageLabel(entry)}</span>
{/snippet}

{#snippet voiceCell(entry: SynthesisCacheEntry)}
  <div class="truncate text-slate-300">{voiceLabel(entry)}</div>
  {#if entry.voiceId}
    <div class="mt-1 truncate text-xs text-slate-500">{entry.voiceId}</div>
  {/if}
{/snippet}

{#snippet textCell(entry: SynthesisCacheEntry)}
  <div class="whitespace-pre-wrap break-words text-slate-200">{snippet(entry.text)}</div>
{/snippet}

{#snippet sizeCell(entry: SynthesisCacheEntry)}
  <span class="text-slate-400">{formatBytes(entry.bytes)}</span>
{/snippet}

{#snippet savedCell(entry: SynthesisCacheEntry)}
  <span class="text-slate-400">{formatSavedAt(entry.savedAt)}</span>
{/snippet}
