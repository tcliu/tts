<script lang="ts">
  import { onDestroy } from 'svelte'
  import Button from './Button.svelte'
  import DataTable, { type DataTableColumn } from './DataTable.svelte'
  import DeleteIcon from '$lib/icons/DeleteIcon.svelte'
  import SpeakerIcon from '$lib/icons/SpeakerIcon.svelte'
  import StopIcon from '$lib/icons/StopIcon.svelte'
  import { adminErrorMessage } from '$lib/admin-client'
  import { getI18nContext } from '$lib/i18n.svelte'
  import { formatBytes } from '$lib/format-bytes'
  import type { AdminServerCacheEntry } from '$lib/admin-client'
  import type { useAdminSynthesisCache } from '$lib/use-admin-synthesis-cache.svelte'

  interface Props {
    cacheState: ReturnType<typeof useAdminSynthesisCache>
  }

  let { cacheState }: Props = $props()

  const i18n = getI18nContext()

  let search = $state('')
  let selectedKeys = $state(new Set<string>())
  let page = $state(1)
  let pageSize = $state(10)
  let sortKey = $state<string | null>(null)
  let sortDir = $state<'asc' | 'desc'>('asc')
  let playing = $state(false)
  let playError = $state('')
  let currentAudio = $state<HTMLAudioElement | null>(null)
  let currentAudioUrl = $state('')
  let playGeneration = 0

  const query = $derived(search.trim().toLowerCase())

  const filteredEntries = $derived.by(() => {
    if (!query) return cacheState.entries
    return cacheState.entries.filter(entry => {
      const haystack = [entry.key, entry.text ?? '', entry.voice ?? ''].join('\n').toLowerCase()
      return haystack.includes(query)
    })
  })

  const sortedEntries = $derived.by(() => {
    if (!sortKey) return filteredEntries
    const copy = [...filteredEntries]
    copy.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'text': {
          cmp = (a.text ?? '').localeCompare(b.text ?? '')
          break
        }
        case 'voice': {
          cmp = (a.voice ?? '').localeCompare(b.voice ?? '')
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

  const visibleSelectedCount = $derived(paginatedEntries.filter(entry => selectedKeys.has(entry.key)).length)
  const allVisibleSelected = $derived(paginatedEntries.length > 0 && visibleSelectedCount === paginatedEntries.length)
  const someVisibleSelected = $derived(visibleSelectedCount > 0 && !allVisibleSelected)
  const hasSelection = $derived(selectedKeys.size > 0)

  const columns = $derived.by<DataTableColumn<AdminServerCacheEntry>[]>(() => [
    {
      key: 'text',
      header: i18n.t('table.text'),
      width: '52%',
      minWidth: 200,
      sortable: true,
      searchable: true,
      cell: textCell,
    },
    {
      key: 'voice',
      header: i18n.t('table.voice'),
      width: '20%',
      minWidth: 120,
      sortable: true,
      searchable: true,
      cell: voiceCell,
    },
    {
      key: 'size',
      header: i18n.t('table.size'),
      width: '10%',
      minWidth: 76,
      sortable: true,
      cellClass: 'whitespace-nowrap',
      cell: sizeCell,
    },
    {
      key: 'saved',
      header: i18n.t('table.saved'),
      width: '18%',
      minWidth: 132,
      sortable: true,
      cellClass: 'whitespace-nowrap',
      cell: savedCell,
    },
  ])

  $effect(() => {
    const liveKeys = new Set(cacheState.entries.map(entry => entry.key))
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

  const savedAtFormatter = $derived(
    new Intl.DateTimeFormat(i18n.locale, {
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
    if (await cacheState.clearSelected(keys)) {
      selectedKeys = new Set()
    }
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

  function decodeBase64Audio(base64: string): Blob {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new Blob([bytes], { type: 'audio/mpeg' })
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
        reject(new Error(i18n.t('playback.failed')))
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
    const keys = [...selectedKeys]
    if (keys.length === 0) return
    stopPlayback()
    playError = ''
    const generation = playGeneration
    playing = true
    try {
      for (const key of keys) {
        if (playGeneration !== generation) return
        const result = await cacheState.fetchAudio(key)
        // Expired admin session: the hook already signed out and reset the
        // listing, so stop without a misleading playback error.
        if (result === null || playGeneration !== generation) return
        await playBlob(decodeBase64Audio(result.audio), generation)
      }
    } catch {
      if (playGeneration === generation) {
        playError = i18n.t('playback.failed')
      }
    } finally {
      if (playGeneration === generation) {
        playing = false
        cleanupAudio()
      }
    }
  }

  onDestroy(() => {
    stopPlayback()
  })
</script>

<div class="flex min-h-0 flex-1 flex-col gap-1.5">
  {#if cacheState.loadError}
    <p class="rounded-lg border border-rose-700 bg-rose-950/50 px-3 py-2 text-sm text-rose-200" role="alert">
      {adminErrorMessage(cacheState.loadError, i18n)}
    </p>
  {/if}
  {#if playError}
    <p class="rounded-lg border border-rose-700 bg-rose-950/50 px-3 py-2 text-sm text-rose-200" role="alert">
      {playError}
    </p>
  {/if}
  <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
    <div class="min-w-0 flex-1">
      <p class="text-sm font-medium text-slate-100">{i18n.t('adminServerCache')}</p>
      <p class="mt-0.5 text-xs text-slate-400" aria-live="polite">
        {#if selectedKeys.size === 0}
          {cacheState.stats?.entries ?? 0} {i18n.t('cache.units')} · {formatBytes(cacheState.stats?.bytes ?? 0)}
        {:else}
          {selectedKeys.size} {i18n.t('cache.selected')} ·
          {cacheState.stats?.entries ?? 0} {i18n.t('cache.units')} · {formatBytes(cacheState.stats?.bytes ?? 0)}
        {/if}
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-1.5">
      <Button
        variant="outline"
        accent="cyan"
        size="sm"
        ariaPressed={playing}
        disabled={(!hasSelection && !playing) || cacheState.pending}
        ariaLabel={playing ? i18n.t('cache.stopPlayback') : i18n.t('cache.playSelected')}
        onClick={() => void playSelected()}>
        {#snippet icon()}
          {#if playing}
            <StopIcon className="h-4 w-4" />
          {:else}
            <SpeakerIcon className="h-4 w-4" />
          {/if}
        {/snippet}
        {playing ? i18n.t('stop') : i18n.t('playback.label')}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={!hasSelection || cacheState.pending}
        pending={cacheState.pending}
        ariaLabel={i18n.t('cache.clearSelected')}
        onClick={() => void clearSelected()}>
        {#snippet icon()}
          <DeleteIcon className="h-4 w-4" />
        {/snippet}
        {i18n.t('cache.clear')}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={cacheState.entries.length === 0 || cacheState.pending}
        pending={cacheState.pending}
        ariaLabel={i18n.t('adminClearAllServerCache')}
        onClick={() => void cacheState.clearAll()}>
        {#snippet icon()}
          <DeleteIcon className="h-4 w-4" />
        {/snippet}
        {i18n.t('cache.clearAll')}
      </Button>
    </div>
  </div>

  <DataTable
    rows={paginatedEntries}
    rowId={entry => entry.key}
    {columns}
    loading={cacheState.loading}
    emptyMessage={search.trim() ? i18n.t('cache.noMatching') : i18n.t('adminServerCacheEmpty')}
    bind:searchValue={search}
    searchAriaLabel={i18n.t('cache.search')}
    searchPlaceholder={i18n.t('cache.search')}
    selectable
    selectedIds={selectedKeys}
    onToggleSelection={toggleSelection}
    onToggleAll={toggleAllVisible}
    allSelected={allVisibleSelected}
    someSelected={someVisibleSelected}
    selectAllAriaLabel={i18n.t('cache.selectAll')}
    rowSelectAriaLabel={() => i18n.t('cache.select')}
    total={total}
    pageSize={pageSize}
    currentPage={page}
    onPageChange={handlePageChange}
    onPageSizeChange={handlePageSizeChange}
    bind:sortKey={sortKey}
    bind:sortDirection={sortDir}
    onSort={handleSort}
    sortAriaLabel={(col, dir) => i18n.t(dir === 'asc' ? 'table.sortAsc' : 'table.sortDesc', { name: col.header })}
    resizeAriaLabel={col => i18n.t('table.resize', { name: col.header })}
    paginationPreviousLabel={i18n.t('pagination.previous')}
    paginationNextLabel={i18n.t('pagination.next')}
    paginationPageSizeLabel={i18n.t('pagination.pageSize')}
    paginationCurrentLabel={i18n.t('pagination.page')}
    paginationLabel={i18n.t('pagination.page')}
    fillHeight
    tableClass="w-full"
    resizable
    storageKey="admin-synthesis-cache" />
</div>

{#snippet textCell(entry: AdminServerCacheEntry)}
  {#if entry.text}
    <div class="whitespace-pre-wrap break-words text-slate-200">{entry.text.slice(0, 200)}</div>
  {:else}
    <div class="truncate font-mono text-xs text-slate-500" title={entry.key}>{entry.key}</div>
  {/if}
{/snippet}

{#snippet voiceCell(entry: AdminServerCacheEntry)}
  {#if entry.voice}
    <div class="truncate text-slate-300">{entry.voice}</div>
  {:else}
    <span class="text-slate-500">—</span>
  {/if}
{/snippet}

{#snippet sizeCell(entry: AdminServerCacheEntry)}
  <span class="text-slate-400">{formatBytes(entry.bytes)}</span>
{/snippet}

{#snippet savedCell(entry: AdminServerCacheEntry)}
  <span class="text-slate-400">{formatSavedAt(entry.savedAt)}</span>
{/snippet}
