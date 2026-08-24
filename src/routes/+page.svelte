<script lang="ts">
  import { onMount } from 'svelte'
  import CodeEditor from '$lib/components/CodeEditor.svelte'
  import Button from '$lib/components/Button.svelte'
  import SettingsDialog from '$lib/components/SettingsDialog.svelte'
  import GlobeIcon from '$lib/icons/GlobeIcon.svelte'
  import SettingsIcon from '$lib/icons/SettingsIcon.svelte'
  import InfoIcon from '$lib/icons/InfoIcon.svelte'
  import FollowIcon from '$lib/icons/FollowIcon.svelte'
  import SpeakerIcon from '$lib/icons/SpeakerIcon.svelte'
  import StopIcon from '$lib/icons/StopIcon.svelte'

  import { positionPanel } from '$lib/position-panel.svelte'
  import { UI_LANGUAGE_OPTIONS, UI_TEXT, segmentLanguageName, type UiLocale } from '$lib/ui-text'
  import { formatClock, usePlayback, type CodeEditorHandle } from '$lib/use-playback.svelte'
  import { useMetadata } from '$lib/use-metadata.svelte'
  import { useSettings } from '$lib/use-settings.svelte'

  const settings = useSettings()

  // Late-bound so playback can notify the metadata layer without a circular
  // factory dependency; assigned once the metadata composable exists below.
  const hooks: { prepareForPlayback: () => void } = { prepareForPlayback: () => {} }

  const playback = usePlayback({
    settings,
    getEditor: () => editorRef,
    segmentLabel: lang => segmentLanguageName(settings.locale, lang),
    prepareForPlayback: () => hooks.prepareForPlayback(),
  })
  const metadata = useMetadata({
    settings,
    playback,
    getEditor: () => editorRef,
    getShowMetadata: () => showMetadata,
  })
  hooks.prepareForPlayback = () => metadata.prepareForPlayback()

  let settingsOpen = $state(false)
  let showMetadata = $state(false)
  let languageMenuOpen = $state(false)

  let editorRef = $state<CodeEditorHandle | null>(null)
  let languageButtonRef = $state<HTMLElement | null>(null)
  let languagePanelRef = $state<HTMLDivElement | null>(null)
  let languageMenuIndex = $state(0)
  let tableBodyRef = $state<HTMLDivElement | null>(null)

  $effect(() => {
    metadata.attachScrollContainer(tableBodyRef)
  })

  let isWide = $state(false)
  $effect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(min-width: 1024px)')
    const update = () => (isWide = mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  })

  const text = $derived(UI_TEXT[settings.locale])

  function toggleLanguageMenu() {
    if (languageMenuOpen) {
      languageMenuOpen = false
      languageButtonRef?.focus()
      return
    }
    languageMenuIndex = Math.max(0, UI_LANGUAGE_OPTIONS.findIndex(option => option.value === settings.locale))
    languageMenuOpen = true
  }

  function focusLanguageMenuItem(index: number) {
    const count = UI_LANGUAGE_OPTIONS.length
    const next = ((index % count) + count) % count
    languageMenuIndex = next
    const items = languagePanelRef?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    items?.[next]?.focus()
  }

  function handleLanguageMenuKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusLanguageMenuItem(languageMenuIndex + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusLanguageMenuItem(languageMenuIndex - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusLanguageMenuItem(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusLanguageMenuItem(UI_LANGUAGE_OPTIONS.length - 1)
    } else if (event.key === 'Tab') {
      languageMenuOpen = false
    }
  }

  function selectLanguage(value: UiLocale) {
    settings.setLocale(value)
    playback.onLocaleChanged(value)
    languageMenuOpen = false
    languageButtonRef?.focus()
  }

  onMount(() => {
    const disposeSettings = settings.hydrate()
    playback.initStatus()
    return () => {
      disposeSettings()
      playback.stopPlayback()
    }
  })

  $effect(() => {
    if (!languageMenuOpen) {
      return
    }
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (languageButtonRef && !languageButtonRef.contains(target) && languagePanelRef && !languagePanelRef.contains(target)) {
        languageMenuOpen = false
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        languageMenuOpen = false
        languageButtonRef?.focus()
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape, true)
    }
  })

  $effect(() => {
    if (!languageMenuOpen || !languagePanelRef) {
      return
    }
    const items = languagePanelRef.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    items?.[languageMenuIndex]?.focus()
  })
</script>

<svelte:head>
  <title>TTS</title>
</svelte:head>

<div class="flex h-dvh min-h-screen flex-col bg-slate-950 text-slate-100">
  <header class="flex items-center justify-between gap-4 border-b border-slate-800 px-3 py-3 sm:px-4">
    <h1 class="text-base font-semibold tracking-tight sm:text-lg">TTS</h1>
    <div class="flex items-center gap-2">
      <span bind:this={languageButtonRef} class="inline-flex">
        <Button
          variant="secondary"
          size="sm"
          ariaLabel={text.language}
          ariaExpanded={languageMenuOpen}
          tooltip={text.language}
          onClick={toggleLanguageMenu}>
          {#snippet icon()}
            <GlobeIcon className="h-4 w-4" />
          {/snippet}
        </Button>
      </span>
      <Button variant="secondary" size="sm" ariaLabel={text.settings} tooltip={text.settings} onClick={() => (settingsOpen = true)}>
        {#snippet icon()}
          <SettingsIcon className="h-4 w-4" />
        {/snippet}
      </Button>
    </div>
  </header>

  <main class="flex min-h-0 flex-1 flex-col px-3 py-3 sm:px-4 sm:py-4">
    <section aria-label="Playback controls" class="flex flex-wrap items-center gap-1.5">
      <Button
        variant="outline"
        accent="cyan"
        size="sm"
        ariaPressed={playback.isPlaying}
        disabled={playback.isPlaying ? false : !settings.canPlay}
        ariaLabel={playback.isPlaying ? text.stop : text.playback}
        tooltip={playback.isPlaying ? text.stop : text.playback}
        onClick={playback.isPlaying ? playback.stopPlayback : playback.startPlayback}
        className="px-2.5 py-1.5 text-sm">
        {#snippet icon()}
          {#if playback.isPlaying}
            <StopIcon className="h-4 w-4" />
          {:else}
            <SpeakerIcon className="h-4 w-4" />
          {/if}
        {/snippet}
        {playback.isPlaying ? text.stop : text.playback}
      </Button>

      <Button
        variant="secondary"
        size="sm"
        ariaPressed={showMetadata}
        ariaLabel={text.info}
        tooltip={text.info}
        onClick={() => (showMetadata = !showMetadata)}>
        {#snippet icon()}
          <InfoIcon className="h-4 w-4" />
        {/snippet}
      </Button>
    </section>

    <div class="mt-3 flex min-h-0 flex-1 flex-col gap-3">
      <div class="flex flex-none items-center gap-2 text-sm text-slate-400">
        <span aria-live="polite">{playback.isPlaying ? text.playbackRunning : playback.statusMessage}</span>
        {#if playback.isPlaying}
          <span aria-hidden="true" class="truncate">
            {`· ${playback.currentSegmentIndex}/${playback.totalSegments} · ${playback.currentSegmentLabel} · ${playback.currentVoiceName} · ${
              playback.totalDuration > 0 ? `${formatClock(playback.totalElapsed)}/${formatClock(playback.totalDuration)}` : formatClock(playback.totalElapsed)
            }`}
          </span>
        {/if}
      </div>
      {#if playback.isPlaying}
        <div class="flex-none">
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuemin={0} aria-valuemax={playback.totalSegments} aria-valuenow={playback.synthesizedCount}>
            <div
              class="h-full rounded-full bg-cyan-500 transition-[width] duration-200 motion-reduce:transition-none"
              style={`width: ${playback.totalSegments > 0 ? (playback.synthesizedCount / playback.totalSegments) * 100 : 0}%`}></div>
          </div>
          <div class="mt-1 text-xs text-slate-400">{text.synthesized} {playback.synthesizedCount}/{playback.totalSegments}</div>
        </div>
      {/if}
      <div class="flex min-h-0 flex-1 gap-2 {showMetadata ? (isWide ? 'flex-row' : 'flex-col') : 'flex-col'}">
        <div
          class="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 shadow-2xl shadow-slate-950/30">
          <CodeEditor
            bind:this={editorRef}
            bind:content={settings.content}
            editable={!playback.isPlaying}
            autoFocus={true}
            editorAriaLabel="TTS editor"
            containerClass="min-h-0 flex-1"
            editorClass="h-full" />
        </div>

        {#if showMetadata}
          <section aria-label={text.info} class="flex min-h-0 min-w-0 {isWide ? 'w-[32%] min-w-[18rem]' : 'flex-1'} flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <div class="flex min-h-0 w-full flex-1 flex-col gap-2">
              <div class="flex flex-none items-center gap-2">
                <label class="relative block flex-1">
                  <span class="sr-only">{text.metadataSearch}</span>
                  <input
                    type="search"
                    bind:value={metadata.search}
                    placeholder={text.metadataSearch}
                    aria-label={text.metadataSearch}
                    class="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50" />
                </label>
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
              </div>
              <div class="flex flex-none flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>{text.synthesized} {playback.synthesizedCount}/{playback.totalSegments}</span>
                <span aria-hidden="true">·</span>
                {#if metadata.syncing}
                  <span>{text.metadataRefreshing}</span>
                {:else if metadata.stale}
                  <span>{text.metadataStale}</span>
                {:else}
                  <span>{text.segmentHint}</span>
                {/if}
              </div>
              {#if metadata.rows.length === 0}
                <p class="text-xs text-slate-500">{metadata.search.trim() ? text.metadataNoResults : text.noMetadata}</p>
              {:else}
                <div bind:this={tableBodyRef} class="min-h-0 flex-1 overflow-auto">
                  <table class="w-full border-collapse text-sm">
                    <thead class="sticky top-0 z-10 bg-slate-950">
                      <tr class="text-left text-xs text-slate-400">
                        <th scope="col" class="px-2 py-1 font-medium">{text.tableSeg}</th>
                        <th scope="col" class="px-2 py-1 font-medium">{text.tableTime}</th>
                        <th scope="col" class="px-2 py-1 font-medium">{text.tableOffset}</th>
                        <th scope="col" class="px-2 py-1 font-medium">{text.tableLang}</th>
                        <th scope="col" class="px-2 py-1 font-medium">{text.tableText}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each metadata.rows as row}
                        <tr
                          data-active={row.active}
                          class="border-t border-slate-800 align-top {row.active ? 'bg-cyan-500/15 text-cyan-100' : 'text-slate-300 hover:bg-slate-800/60'}">
                          <td class="px-2 py-1 whitespace-nowrap">
                            <button
                              type="button"
                              aria-label={`${text.playSegment} ${row.segmentIndex + 1}`}
                              onclick={() => playback.playFromSegment(row.segmentIndex, row.offset)}
                              class="cursor-pointer rounded px-1 py-0.5 font-mono outline-none transition hover:text-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-500 motion-reduce:transition-none -mx-1">
                              {row.segmentIndex + 1}
                            </button>
                          </td>
                          <td class="px-2 py-1 font-mono whitespace-nowrap">{row.at.toFixed(2)}s</td>
                          <td class="px-2 py-1 font-mono whitespace-nowrap">{row.offset}</td>
                          <td class="px-2 py-1 whitespace-nowrap">{row.lang}</td>
                          <td class="px-2 py-1">{row.text}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            </div>
          </section>
        {/if}
      </div>
    </div>
  </main>

  {#if languageMenuOpen}
    <div
      bind:this={languagePanelRef}
      role="menu"
      aria-label={text.languageMenuLabel}
      tabindex="-1"
      onkeydown={handleLanguageMenuKeydown}
      use:positionPanel={() => ({ getTrigger: () => languageButtonRef, getOpen: () => languageMenuOpen, align: 'right', autoPlace: true })}
      class="fixed left-0 top-0 z-50 w-52 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/95 p-1 shadow-2xl shadow-slate-950/60 backdrop-blur">
      {#each UI_LANGUAGE_OPTIONS as option, i}
        <button
          type="button"
          role="menuitemradio"
          aria-checked={settings.locale === option.value}
          tabindex={i === languageMenuIndex ? 0 : -1}
          onclick={() => selectLanguage(option.value)}
          class={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm outline-none transition motion-reduce:transition-none ${settings.locale === option.value ? 'bg-cyan-500/15 text-cyan-200' : 'text-slate-300 hover:bg-slate-800 hover:text-cyan-200 focus:bg-slate-800 focus:text-cyan-200'}`}>
          {option.label}
        </button>
      {/each}
    </div>
  {/if}

  {#if settingsOpen}
    <SettingsDialog
      locale={settings.locale}
      speed={settings.speed}
      synthesisConcurrency={settings.synthesisConcurrency}
      voiceSelections={settings.voiceSelections}
      groupSelections={settings.groupSelections}
      onCancel={() => (settingsOpen = false)}
      onSelectVoice={settings.selectVoice}
      onSelectGroup={settings.selectGroup}
      onSelectSpeed={settings.setSpeed}
      onSelectConcurrent={settings.setSynthesisConcurrency} />
  {/if}
</div>
