<script lang="ts">
  import { tick } from 'svelte'
  import Button from './Button.svelte'
  import RefreshIcon from '$lib/icons/RefreshIcon.svelte'
  import FollowIcon from '$lib/icons/FollowIcon.svelte'
  import MaximizeIcon from '$lib/icons/MaximizeIcon.svelte'
  import MinimizeIcon from '$lib/icons/MinimizeIcon.svelte'
  import ChevronDownIcon from '$lib/icons/ChevronDownIcon.svelte'
  import ChevronDownSmallIcon from '$lib/icons/ChevronDownSmallIcon.svelte'
  import SpeakerIcon from '$lib/icons/SpeakerIcon.svelte'
  import type { MetadataHandle } from '$lib/use-metadata.svelte'
  import type { PlaybackHandle } from '$lib/use-playback.svelte'
  import type { UiText } from '$lib/ui-text'

  interface Props {
    metadata: MetadataHandle
    playback: PlaybackHandle
    text: UiText
    isDocked: boolean
    expanded: boolean
    onToggleExpand: () => void
    onCollapse: () => void
    onResetCache: () => void
  }

  let { metadata, playback, text, isDocked, expanded, onToggleExpand, onCollapse, onResetCache }: Props = $props()

  let tableBodyRef = $state<HTMLDivElement | null>(null)
  let expandedRows = $state<Set<number>>(new Set())
  const wordContainers = new Map<number, HTMLDivElement>()
  const SENTENCE_COLS = ['w-6', 'w-6', 'w-10', 'w-14', 'w-12', ''] as const
  const WORD_COLS = ['w-6', 'w-10', 'w-14', ''] as const

  function attachWordContainer(node: HTMLDivElement, sentenceIndex: number) {
    wordContainers.set(sentenceIndex, node)
    return {
      destroy() {
        wordContainers.delete(sentenceIndex)
      }
    }
  }

  $effect(() => {
    metadata.attachScrollContainer(tableBodyRef)
  })

  $effect(() => {
    void metadata.rows
    void metadata.followSentence
    if (!metadata.followSentence) return
    // Defer until the word rows have been rendered for the active sentence
    void tick().then(() => {
      for (const container of wordContainers.values()) {
        const active = container.querySelector<HTMLElement>('tr[data-active="true"]')
        if (!active) continue
        const containerRect = container.getBoundingClientRect()
        const activeRect = active.getBoundingClientRect()
        const isVisible = activeRect.top >= containerRect.top && activeRect.bottom <= containerRect.bottom
        if (isVisible) continue
        const reduceMotion =
          typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
        active.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
      }
    })
  })

  function sentenceKey(row: { sentenceIndex: number }): number {
    return row.sentenceIndex
  }

  function toggleRow(row: { sentenceIndex: number; hasWords: boolean }) {
    if (!row.hasWords) return
    const key = sentenceKey(row)
    const next = new Set(expandedRows)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    expandedRows = next
  }

  function isExpanded(row: { sentenceIndex: number }): boolean {
    return expandedRows.has(sentenceKey(row))
  }
</script>

<section
  aria-label={text.info}
  class="flex min-h-0 min-w-0 {!isDocked || expanded ? 'flex-1' : 'w-[32%] min-w-[18rem]'} flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60 p-3">
  <div class="flex min-h-0 w-full flex-1 flex-col gap-2">
    <div class="flex flex-none items-center gap-2">
      <label class="relative block flex-1">
        <span class="sr-only">{text.metadataSearch}</span>
        <input
          type="search"
          bind:value={() => metadata.search, v => metadata.setSearch(v)}
          placeholder={text.metadataSearch}
          aria-label={text.metadataSearch}
          class="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition motion-reduce:transition-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50" />
      </label>
      <Button
        variant="ghost"
        size="sm"
        ariaLabel={text.resetPlaybackCache}
        tooltip={text.resetPlaybackCache}
        onClick={onResetCache}
        className="border border-slate-700 text-slate-400 hover:text-slate-200">
        {#snippet icon()}
          <RefreshIcon className="h-4 w-4" />
        {/snippet}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        ariaPressed={metadata.followSentence}
        ariaLabel={text.followSentence}
        tooltip={text.followSentence}
        onClick={() => (metadata.followSentence = !metadata.followSentence)}
        className={metadata.followSentence ? 'border border-cyan-500/50 bg-cyan-500/10 text-cyan-200' : 'border border-slate-700 text-slate-400 hover:text-slate-200'}>
        {#snippet icon()}
          <FollowIcon className="h-4 w-4" />
        {/snippet}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        ariaExpanded={!expanded}
        ariaLabel={expanded ? text.metadataRestore : text.metadataExpand}
        tooltip={expanded ? text.metadataRestore : text.metadataExpand}
        onClick={onToggleExpand}
        className={`border ${expanded ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-200' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}>
        {#snippet icon()}
          {#if expanded}
            <MinimizeIcon className="h-4 w-4" />
          {:else}
            <MaximizeIcon className="h-4 w-4" />
          {/if}
        {/snippet}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        ariaLabel={text.infoCollapse}
        tooltip={text.infoCollapse}
        onClick={onCollapse}
        className="border border-slate-700 text-slate-400 hover:text-slate-200 lg:hidden">
        {#snippet icon()}
          <ChevronDownIcon className="h-4 w-4" />
        {/snippet}
      </Button>
    </div>
    <div class="flex flex-none flex-wrap items-center gap-2 text-xs text-slate-400">
      {#if metadata.stale}
        <span>{text.metadataStale}</span>
      {:else}
        <span>{text.segmentHint}</span>
      {/if}
    </div>
    {#if metadata.rows.length === 0}
      <p class="text-xs text-slate-500">{metadata.search.trim() ? text.metadataNoResults : text.noMetadata}</p>
    {:else}
      <div bind:this={tableBodyRef} class="min-h-0 flex-1 overflow-auto">
        <table class="w-full table-fixed border-collapse text-sm">
          <colgroup>
            {#each SENTENCE_COLS as cls}
              <col class={cls} />
            {/each}
          </colgroup>
          <thead class="sticky top-0 z-10 bg-slate-950">
            <tr class="text-left text-xs text-slate-400">
              <th scope="col" class="w-6 px-1 py-1 font-medium" aria-label={text.tableExpand}></th>
              <th scope="col" class="w-6 px-1 py-1 font-medium" aria-label={text.tablePlay}></th>
              <th scope="col" class="px-2 py-1 font-medium" aria-label={text.tableSentence}>{text.tableNumber}</th>
              <th scope="col" class="px-2 py-1 font-medium">{text.tableOffset}</th>
              <th scope="col" class="px-2 py-1 font-medium">{text.tableLang}</th>
              <th scope="col" class="px-2 py-1 font-medium">{text.tableText}</th>
            </tr>
          </thead>
          <tbody>
            {#each metadata.rows as row}
              <tr
                data-active={row.active}
                aria-current={row.active ? 'true' : undefined}
                role="button"
                tabindex="0"
                aria-label={`${text.playSegment} ${row.sentenceIndex + 1}`}
                onclick={() => playback.playFromSegment(row.segmentIndex, row.offset)}
                onkeydown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    playback.playFromSegment(row.segmentIndex, row.offset)
                  }
                }}
                class="cursor-pointer border-t border-slate-800 align-top focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-inset {row.active ? 'bg-cyan-500/15 text-cyan-100' : 'text-slate-300 hover:bg-slate-800/60'}">
                <td class="px-1 py-1 text-center">
                  {#if row.hasWords}
                    <button
                      type="button"
                      aria-label={isExpanded(row) ? text.collapseSentence : text.expandSentence}
                      aria-expanded={isExpanded(row)}
                      onclick={(event) => {
                        event.stopPropagation()
                        toggleRow(row)
                      }}
                      onpointerdown={(e) => e.preventDefault()}
                      class="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 outline-none transition motion-reduce:transition-none hover:bg-slate-800 hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-cyan-500">
                      <ChevronDownSmallIcon className={`h-3 w-3 transition-transform motion-reduce:transition-none ${isExpanded(row) ? '' : '-rotate-90'}`} />
                    </button>
                  {/if}
                </td>
                <td class="px-1 py-1">
                  <button
                    type="button"
                    aria-label={`${text.playSegment} ${row.sentenceIndex + 1}`}
                    onclick={(event) => {
                      event.stopPropagation()
                      playback.playSentence(row.segmentIndex, row.offset)
                    }}
                    onpointerdown={(e) => e.preventDefault()}
                    class="inline-flex h-6 w-6 items-center justify-center rounded text-cyan-400 outline-none transition motion-reduce:transition-none hover:bg-cyan-500/10 hover:text-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-500">
                    <SpeakerIcon className="h-3.5 w-3.5" />
                  </button>
                </td>
                <td class="px-2 py-1 font-mono whitespace-nowrap">{row.sentenceIndex + 1}</td>
                <td class="px-2 py-1 font-mono whitespace-nowrap">{row.offset}</td>
                <td class="px-2 py-1 whitespace-nowrap">{row.lang}</td>
                <td class="px-2 py-1 break-words">{row.text}</td>
              </tr>
              {#if isExpanded(row)}
                <tr class="border-t border-slate-800 bg-slate-900/40">
                  <td colspan="6" class="p-0">
                    {#if row.words.length === 0}
                      <p class="px-3 py-2 text-xs text-slate-500">{text.noWords}</p>
                    {:else}
                      <div class="border-b border-slate-800 bg-slate-900">
                        <table class="w-full table-fixed border-collapse text-xs">
                          <colgroup>
                            {#each WORD_COLS as cls}
                              <col class={cls} />
                            {/each}
                          </colgroup>
                          <thead class="bg-slate-900">
                            <tr class="text-left text-slate-400">
                              <th scope="col" class="px-1 py-1 font-medium" aria-label={text.tablePlay}></th>
                              <th scope="col" class="px-2 py-1 font-medium">{text.tableWord}</th>
                              <th scope="col" class="px-2 py-1 font-medium">{text.tableOffset}</th>
                              <th scope="col" class="px-2 py-1 font-medium">{text.tableText}</th>
                            </tr>
                          </thead>
                        </table>
                      </div>
                      <div class="max-h-64 overflow-auto" use:attachWordContainer={row.sentenceIndex}>
                        <table class="w-full table-fixed border-collapse text-xs">
                          <colgroup>
                            {#each WORD_COLS as cls}
                              <col class={cls} />
                            {/each}
                          </colgroup>
                          <tbody>
                            {#each row.words as word, wIdx}
                              <tr
                                role="button"
                                tabindex="0"
                                data-active={word.active}
                                aria-label={`${text.playWord} ${word.text}`}
                                onclick={() => playback.playFromSegment(word.segmentIndex, word.offset)}
                                onkeydown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    playback.playFromSegment(word.segmentIndex, word.offset)
                                  }
                                }}
                                class="cursor-pointer border-t border-slate-800/60 align-top focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-inset {word.active ? 'bg-cyan-500/15 text-cyan-100' : 'text-slate-300 hover:bg-slate-800/60'}">
                                <td class="px-1 py-1">
                                  <button
                                    type="button"
                                    aria-label={`${text.playWord} ${word.text}`}
                                    onclick={(event) => {
                                      event.stopPropagation()
                                      playback.playWord(word.segmentIndex, word.offset)
                                    }}
                                    onpointerdown={(e) => e.preventDefault()}
                                    class="inline-flex h-5 w-5 items-center justify-center rounded text-cyan-400 outline-none transition motion-reduce:transition-none hover:bg-cyan-500/10 hover:text-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-500">
                                    <SpeakerIcon className="h-3 w-3" />
                                  </button>
                                </td>
                                <td class="px-2 py-1 font-mono whitespace-nowrap">{wIdx + 1}</td>
                                <td class="px-2 py-1 font-mono whitespace-nowrap">{word.offset}</td>
                                <td class="px-2 py-1 break-words">{word.text}</td>
                              </tr>
                            {/each}
                          </tbody>
                        </table>
                      </div>
                    {/if}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</section>
