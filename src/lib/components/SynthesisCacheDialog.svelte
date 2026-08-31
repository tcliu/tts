<script lang="ts">
  import { onDestroy } from 'svelte'
  import BaseDialog from '$lib/components/BaseDialog.svelte'
  import Button from '$lib/components/Button.svelte'
  import Checkbox from '$lib/components/Checkbox.svelte'
  import SearchInput from '$lib/components/SearchInput.svelte'
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

  const selectedEntries = $derived(entries.filter(entry => selectedKeys.has(entry.key)))
  const visibleSelectedCount = $derived(filteredEntries.filter(entry => selectedKeys.has(entry.key)).length)
  const allVisibleSelected = $derived(filteredEntries.length > 0 && visibleSelectedCount === filteredEntries.length)
  const someVisibleSelected = $derived(visibleSelectedCount > 0 && !allVisibleSelected)
  const hasSelection = $derived(selectedKeys.size > 0)
  const totalBytes = $derived(entries.reduce((sum, entry) => sum + entry.bytes, 0))

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
      for (const entry of filteredEntries) {
        next.delete(entry.key)
      }
    } else {
      for (const entry of filteredEntries) {
        next.add(entry.key)
      }
    }
    selectedKeys = next
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

<BaseDialog title={text.synthesisCacheDetailsTitle} maxWidth="7xl" closeLabel={text.close} onCancel={onCancel} className="flex h-[min(84vh,760px)] min-h-[520px] flex-col">
  <div class="flex min-h-0 flex-1 flex-col gap-3">
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

    <SearchInput bind:value={search} ariaLabel={text.cacheSearch} placeholder={text.cacheSearch} wrapperClass="shrink-0" />

    <div class="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-800 bg-slate-950/50 contain-layout">
      <table class="min-w-[66rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr class="text-left text-sm font-medium text-slate-400">
            <th scope="col" class="sticky top-0 z-10 w-10 border-b border-slate-800 bg-slate-900/95 px-3 py-2 backdrop-blur">
              <Checkbox
                checked={allVisibleSelected}
                indeterminate={someVisibleSelected}
                ariaLabel={text.selectAllCacheEntries}
                disabled={filteredEntries.length === 0}
                onChange={toggleAllVisible} />
            </th>
            <th scope="col" class="sticky top-0 z-10 min-w-24 border-b border-slate-800 bg-slate-900/95 px-3 py-2 backdrop-blur">{text.tableLang}</th>
            <th scope="col" class="sticky top-0 z-10 min-w-44 border-b border-slate-800 bg-slate-900/95 px-3 py-2 backdrop-blur">{text.tableVoice}</th>
            <th scope="col" class="sticky top-0 z-10 min-w-96 border-b border-slate-800 bg-slate-900/95 px-3 py-2 backdrop-blur">{text.tableText}</th>
            <th scope="col" class="sticky top-0 z-10 min-w-24 border-b border-slate-800 bg-slate-900/95 px-3 py-2 backdrop-blur">{text.tableRate}</th>
            <th scope="col" class="sticky top-0 z-10 min-w-28 border-b border-slate-800 bg-slate-900/95 px-3 py-2 backdrop-blur">{text.tableSize}</th>
            <th scope="col" class="sticky top-0 z-10 min-w-32 border-b border-slate-800 bg-slate-900/95 px-3 py-2 backdrop-blur">{text.tableDocument}</th>
            <th scope="col" class="sticky top-0 z-10 min-w-40 border-b border-slate-800 bg-slate-900/95 px-3 py-2 backdrop-blur">{text.tableSaved}</th>
          </tr>
        </thead>
        <tbody>
          {#if loading}
            <tr>
              <td colspan={8} class="px-3 py-10 text-center text-sm text-slate-400">{text.loadingCacheEntries}</td>
            </tr>
          {:else if filteredEntries.length === 0}
            <tr>
              <td colspan={8} class="px-3 py-10 text-center text-sm text-slate-400">{search.trim() ? text.noMatchingCacheEntries : text.cachedSegmentsNone}</td>
            </tr>
          {:else}
            {#each filteredEntries as entry (entry.key)}
              <tr class="hover:bg-slate-900/40">
                <td class="border-b border-slate-800/50 px-3 py-2 align-top">
                  <Checkbox
                    checked={selectedKeys.has(entry.key)}
                    ariaLabel={text.selectCacheEntry}
                    onChange={checked => toggleSelection(entry.key, checked)} />
                </td>
                <td class="border-b border-slate-800/50 px-3 py-2 align-top text-slate-400">{languageLabel(entry)}</td>
                <td class="max-w-0 border-b border-slate-800/50 px-3 py-2 align-top text-slate-300">
                  <div class="truncate">{voiceLabel(entry)}</div>
                  {#if entry.voiceId}
                    <div class="mt-1 truncate text-xs text-slate-500">{entry.voiceId}</div>
                  {/if}
                </td>
                <td class="max-w-0 border-b border-slate-800/50 px-3 py-2 align-top">
                  <div class="whitespace-pre-wrap break-words text-slate-200">{snippet(entry.text)}</div>
                </td>
                <td class="border-b border-slate-800/50 px-3 py-2 align-top text-slate-400">{entry.rate === null ? '\u2014' : `${entry.rate}x`}</td>
                <td class="border-b border-slate-800/50 px-3 py-2 align-top text-slate-400">{formatBytes(entry.bytes)}</td>
                <td class="border-b border-slate-800/50 px-3 py-2 align-top font-mono text-xs text-slate-500">{entry.docId || '\u2014'}</td>
                <td class="border-b border-slate-800/50 px-3 py-2 align-top text-slate-400">{formatSavedAt(entry.savedAt)}</td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</BaseDialog>
