<script lang="ts">
  import { onMount, tick } from 'svelte'
  import CodeEditor from '$lib/components/CodeEditor.svelte'
  import Button from '$lib/components/Button.svelte'
  import BaseDialog from '$lib/components/BaseDialog.svelte'
  import EditableText from '$lib/components/EditableText.svelte'
  import SearchInput from '$lib/components/SearchInput.svelte'
  import PanelMenu from '$lib/components/PanelMenu.svelte'
  import { REVEAL_CLASS, TOOLBAR_BANDS, menuFor, type PanelAction, type ToolbarMode } from '$lib/toolbar-ladder'
  import DocumentsDrawer from '$lib/components/DocumentsDrawer.svelte'
  import HeaderRadioMenu from '$lib/components/HeaderRadioMenu.svelte'
  import GlobeIcon from '$lib/icons/GlobeIcon.svelte'
  import SunIcon from '$lib/icons/SunIcon.svelte'
  import MoonIcon from '$lib/icons/MoonIcon.svelte'
  import FireIcon from '$lib/icons/FireIcon.svelte'
  import LightBulbIcon from '$lib/icons/LightBulbIcon.svelte'
  import SparklesIcon from '$lib/icons/SparklesIcon.svelte'
  import CloudIcon from '$lib/icons/CloudIcon.svelte'
  import SettingsIcon from '$lib/icons/SettingsIcon.svelte'
  import InfoIcon from '$lib/icons/InfoIcon.svelte'
  import FollowIcon from '$lib/icons/FollowIcon.svelte'
  import ChevronDownIcon from '$lib/icons/ChevronDownIcon.svelte'
  import SpeakerIcon from '$lib/icons/SpeakerIcon.svelte'
  import StopIcon from '$lib/icons/StopIcon.svelte'
  import MenuIcon from '$lib/icons/MenuIcon.svelte'
  import SaveIcon from '$lib/icons/SaveIcon.svelte'
  import DocumentIcon from '$lib/icons/DocumentIcon.svelte'
  import DeleteIcon from '$lib/icons/DeleteIcon.svelte'
  import RefreshIcon from '$lib/icons/RefreshIcon.svelte'
  import CopyIcon from '$lib/icons/CopyIcon.svelte'
  import CheckIcon from '$lib/icons/CheckIcon.svelte'
  import UploadIcon from '$lib/icons/UploadIcon.svelte'

  import { UI_LANGUAGE_OPTIONS, UI_TEXT, segmentLanguageName, type UiLocale } from '$lib/ui-text'
  import { formatClock, usePlayback, type CodeEditorHandle } from '$lib/use-playback.svelte'
  import { useMetadata } from '$lib/use-metadata.svelte'
  import { useSettings, type UiTheme } from '$lib/use-settings.svelte'
  import { useDocuments } from '$lib/use-documents.svelte'
  import { useDocumentEditor } from '$lib/use-document-editor.svelte'
  import { useDocumentsDrawer } from '$lib/use-documents-drawer.svelte'

  const settings = useSettings()
  const documents = useDocuments()
  const drawer = useDocumentsDrawer(documents)

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

  const editor = useDocumentEditor({
    settings,
    documents,
    stopPlayback: () => {
      if (playback.isPlaying) {
        playback.stopPlayback()
      }
    },
    closeDrawer: () => drawer.closeDrawer(),
    focusEditor: () => {
      // Focus must land after the drawer-close render: on narrow screens the
      // open drawer hides <main>, and focus into a hidden subtree is dropped.
      void tick().then(() => editorRef?.focus())
    },
    openFilePicker: () => fileInputRef?.click(),
  })

  let settingsOpen = $state(false)
  let showMetadata = $state(false)

  const THEME_MENU_OPTIONS: { value: UiTheme }[] = [
    { value: 'dark' },
    { value: 'ember' },
    { value: 'nebula' },
    { value: 'light' },
    { value: 'sepia' },
    { value: 'sky' },
  ]

  const THEME_ICONS: Record<UiTheme, typeof MoonIcon> = {
    dark: MoonIcon,
    ember: FireIcon,
    nebula: SparklesIcon,
    light: SunIcon,
    sepia: LightBulbIcon,
    sky: CloudIcon,
  }

  let fileInputRef = $state<HTMLInputElement | null>(null)

  let uploadDragActive = $state(false)

  let drawerButtonRef = $state<HTMLElement | null>(null)
  let drawerPanelRef = $state<HTMLElement | null>(null)
  let drawerSearchRef = $state<HTMLInputElement | null>(null)

  let saveNameInputRef = $state<HTMLInputElement | null>(null)

  let editorRef = $state<CodeEditorHandle | null>(null)
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

  const themeLabels = $derived<Record<UiTheme, string>>({
    dark: text.themeDark,
    ember: text.themeEmber,
    nebula: text.themeNebula,
    light: text.themeLight,
    sepia: text.themeSepia,
    sky: text.themeSky,
  })

  const themeOptions = $derived(THEME_MENU_OPTIONS.map(option => ({ value: option.value, label: themeLabels[option.value] })))

  const statusMessage = $derived(
    editor.uploadNotice === 'uploaded'
      ? text.uploadSuccess
      : editor.uploadNotice === 'too-large'
        ? text.uploadTooLarge
        : editor.uploadNotice === 'read-failed'
          ? text.uploadFailed
          : editor.uploadNotice === 'binary'
            ? text.uploadBinary
            : playback.statusMessage,
  )
  const uploadNoticeIsError = $derived(editor.uploadNotice !== null && editor.uploadNotice !== 'uploaded')

  // Overflow-menu contents per band, derived from the single-source ladder so
  // band boundaries and menu contents cannot drift apart. Index parallels
  // TOOLBAR_BANDS; the last entry is empty because every action is inline.
  const toolbarMode: ToolbarMode = $derived(editor.currentDocId ? 'doc' : 'fresh')
  const toolbarMenus = $derived(TOOLBAR_BANDS.map(band => menuFor(band.name, toolbarMode)))

  function panelActionDisabled(action: PanelAction): boolean {
    if (action === 'copy') {
      return !settings.canPlay
    }
    if (action === 'save') {
      return editor.saveDisabled
    }
    if (action === 'reset') {
      return editor.currentDocId ? !editor.isDirty : !settings.canPlay
    }
    return false
  }

  function toggleDrawer() {
    const opened = drawer.toggleDrawer()
    if (!opened) {
      drawerButtonRef?.focus()
    }
  }

  function handlePanelAction(action: PanelAction) {
    if (action === 'reset') {
      editor.resetEditor()
    } else if (action === 'save') {
      editor.openSaveDialog()
    } else if (action === 'copy') {
      void editor.copyEditorContent()
    } else if (action === 'info') {
      showMetadata = !showMetadata
    } else if (action === 'clone') {
      editor.requestCloneDocument()
    } else if (action === 'upload') {
      editor.requestUpload()
    } else if (editor.currentDocId) {
      editor.requestDeleteDocument(editor.currentDocId)
    }
  }

  async function handleFileChange() {
    const file = fileInputRef?.files?.[0]
    if (!file) {
      return
    }
    await editor.importFile(file)
    if (fileInputRef) {
      fileInputRef.value = ''
    }
  }

  function handleUploadDragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) {
      return
    }
    event.preventDefault()
    uploadDragActive = true
  }

  function handleUploadDragLeave(event: DragEvent) {
    const target = event.currentTarget
    const next = event.relatedTarget
    if (target instanceof Node && next instanceof Node && target.contains(next)) {
      return
    }
    uploadDragActive = false
  }

  function handleUploadDrop(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) {
      return
    }
    event.preventDefault()
    uploadDragActive = false
    const file = event.dataTransfer.files[0]
    if (file) {
      editor.requestUploadFile(file)
    }
  }

  function dialogsOpen() {
    return settingsOpen || editor.saveDialogOpen || editor.discardDialogOpen || editor.deleteDialogOpen
  }

  function selectLanguage(value: UiLocale) {
    settings.setLocale(value)
    playback.onLocaleChanged(value)
  }

  function selectTheme(value: UiTheme) {
    settings.setTheme(value)
  }

  onMount(() => {
    const disposeSettings = settings.hydrate()
    documents.hydrate()
    editor.markBaseline()
    playback.initStatus()
    return () => {
      disposeSettings()
      playback.stopPlayback()
    }
  })

  $effect(() => {
    if (!drawer.drawerOpen) {
      return
    }
    function handleEscape(event: KeyboardEvent) {
      if (settingsOpen || editor.saveDialogOpen || editor.discardDialogOpen || editor.deleteDialogOpen) {
        return
      }
      if (event.key !== 'Escape') {
        return
      }
      const target = event.target
      // Two-stage Escape while focus is in the drawer: clear the search query
      // first, close the drawer once it is empty.
      if (target instanceof Node && drawerPanelRef?.contains(target) && drawer.documentSearch) {
        event.preventDefault()
        drawer.documentSearch = ''
        return
      }
      event.preventDefault()
      drawer.closeDrawer()
      drawerButtonRef?.focus()
    }
    // Document capture (not window) so the overflow menu's window-level
    // Escape handler can stop propagation before this runs while it is open.
    document.addEventListener('keydown', handleEscape, true)
    return () => document.removeEventListener('keydown', handleEscape, true)
  })

  $effect(() => {
    if (!drawer.drawerOpen) {
      return
    }
    const input = drawerSearchRef
    if (!input) {
      return
    }
    requestAnimationFrame(() => input.focus())
  })

  $effect(() => {
    if (!editor.saveDialogOpen) {
      return
    }
    const input = saveNameInputRef
    if (!input) {
      return
    }
    requestAnimationFrame(() => {
      input.focus()
      input.select()
    })
  })

  $effect(() => {
    function handleGlobalKeydown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
        return
      }
      if (event.key.toLowerCase() !== 's') {
        return
      }
      event.preventDefault()
      if (editor.saveDialogOpen || settingsOpen || editor.discardDialogOpen || editor.deleteDialogOpen) {
        return
      }
      editor.openSaveDialog()
    }
    window.addEventListener('keydown', handleGlobalKeydown)
    return () => window.removeEventListener('keydown', handleGlobalKeydown)
  })

  $effect(() => {
    if (!editor.isDirty) {
      return
    }
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  })
</script>

<svelte:head>
  <title>TTS</title>
</svelte:head>

<div class="flex h-dvh flex-col bg-slate-950 text-slate-100">
  {#snippet copyIcon()}
    {#if editor.copyFeedback === 'copied'}
      <CheckIcon className="h-4 w-4 text-emerald-400" />
    {:else if editor.copyFeedback === 'failed'}
      <CopyIcon className="h-4 w-4 text-rose-400" />
    {:else}
      <CopyIcon className="h-4 w-4" />
    {/if}
  {/snippet}

  <header class="flex shrink-0 items-center justify-between gap-4 border-b border-slate-800 px-3 py-3 sm:px-4">
    <div class="flex items-center gap-2">
      <span bind:this={drawerButtonRef} class="inline-flex">
        <Button
          variant="secondary"
          size="sm"
          ariaLabel={text.documents}
          ariaExpanded={drawer.drawerOpen}
          tooltip={text.documents}
          onClick={toggleDrawer}>
          {#snippet icon()}
            <MenuIcon className="h-4 w-4" />
          {/snippet}
        </Button>
      </span>
      <h1 class="text-base font-semibold tracking-tight sm:text-lg">TTS</h1>
    </div>
    <div class="flex items-center gap-2">
      <HeaderRadioMenu
        label={text.language}
        menuLabel={text.languageMenuLabel}
        options={UI_LANGUAGE_OPTIONS}
        selected={settings.locale}
        onSelect={selectLanguage}
        escapeYield={dialogsOpen}>
        {#snippet icon()}
          <GlobeIcon className="h-4 w-4" />
        {/snippet}
      </HeaderRadioMenu>
      <HeaderRadioMenu
        label={text.theme}
        menuLabel={text.themeMenuLabel}
        options={themeOptions}
        selected={settings.theme}
        onSelect={selectTheme}
        escapeYield={dialogsOpen}>
        {#snippet icon()}
          {@const ThemeIcon = THEME_ICONS[settings.theme]}
          <ThemeIcon className="h-4 w-4" />
        {/snippet}
      </HeaderRadioMenu>
      <Button variant="secondary" size="sm" ariaLabel={text.settings} tooltip={text.settings} onClick={() => (settingsOpen = true)}>
        {#snippet icon()}
          <SettingsIcon className="h-4 w-4" />
        {/snippet}
      </Button>
    </div>
  </header>

  <div class="flex min-h-0 flex-1 overflow-hidden">
    {#if drawer.drawerOpen}
      <DocumentsDrawer
        locale={settings.locale}
        documents={drawer.visibleDocuments}
        bind:search={() => drawer.documentSearch, v => (drawer.documentSearch = v)}
        currentDocId={editor.currentDocId}
        bind:panelRef={drawerPanelRef}
        bind:inputRef={drawerSearchRef}
        onNew={editor.requestNewDocument}
        onOpen={editor.requestOpenDocument}
        onDelete={editor.requestDeleteDocument} />
    {/if}

    <main class={`flex min-w-0 flex-1 flex-col px-3 py-3 sm:px-4 sm:py-4 ${drawer.drawerOpen ? 'max-md:hidden' : ''}`}>
      {#if editor.currentDocId}
        <div class="mb-2 flex flex-none min-w-0 items-center">
          <EditableText locale={settings.locale} text={editor.currentDocName} onChange={editor.renameDocument} size="lg" maxWidth={480} />
        </div>
      {/if}
      <section aria-label="Playback controls" class="@container flex flex-none flex-wrap items-center gap-1.5">
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

      <span class={REVEAL_CLASS.reset}>
        <Button
          variant="secondary"
          size="sm"
          disabled={editor.currentDocId ? !editor.isDirty : !settings.canPlay}
          ariaLabel={text.reset}
          tooltip={text.reset}
          onClick={editor.resetEditor}
          className="px-2.5 py-1.5 text-sm">
          {#snippet icon()}
            <RefreshIcon className="h-4 w-4" />
          {/snippet}
          {text.reset}
        </Button>
      </span>

      <span class={REVEAL_CLASS.save}>
        <Button
          variant="secondary"
          size="sm"
          disabled={editor.saveDisabled}
          ariaLabel={text.save}
          tooltip={text.save}
          onClick={editor.openSaveDialog}
          className="px-2.5 py-1.5 text-sm">
          {#snippet icon()}
            <SaveIcon className="h-4 w-4" />
          {/snippet}
          {text.save}
        </Button>
      </span>

      <span class={REVEAL_CLASS.copy}>
        <Button
          variant="secondary"
          size="sm"
          disabled={!settings.canPlay}
          ariaLabel={text.copy}
          tooltip={text.copy}
          onClick={() => void editor.copyEditorContent()}
          className="px-2.5 py-1.5 text-sm"
          icon={copyIcon}>
          {text.copy}
        </Button>
      </span>

      {#if editor.currentDocId}
        <span class={REVEAL_CLASS.delete}>
          <Button
            variant="secondary"
            size="sm"
            ariaLabel={text.delete}
            tooltip={text.delete}
            onClick={() => {
              if (editor.currentDocId) {
                editor.requestDeleteDocument(editor.currentDocId)
              }
            }}
            className="px-2.5 py-1.5 text-sm">
            {#snippet icon()}
              <DeleteIcon className="h-4 w-4" />
            {/snippet}
            {text.delete}
          </Button>
        </span>
      {/if}

      <span class={toolbarMode === 'doc' ? REVEAL_CLASS.info.doc : REVEAL_CLASS.info.fresh}>
        <Button
          variant="secondary"
          size="sm"
          ariaPressed={showMetadata}
          disabled={!settings.canPlay}
          ariaLabel={text.info}
          tooltip={text.info}
          onClick={() => (showMetadata = !showMetadata)}
          className="px-2.5 py-1.5 text-sm">
          {#snippet icon()}
            <InfoIcon className="h-4 w-4" />
          {/snippet}
          {text.info}
        </Button>
      </span>

      {#if editor.currentDocId}
        <span class={REVEAL_CLASS.clone}>
          <Button
            variant="secondary"
            size="sm"
            ariaLabel={text.clone}
            tooltip={text.clone}
            onClick={editor.requestCloneDocument}
            className="px-2.5 py-1.5 text-sm">
            {#snippet icon()}
              <DocumentIcon className="h-4 w-4" />
            {/snippet}
            {text.clone}
          </Button>
        </span>
      {/if}

      <span
        role="presentation"
        class={`rounded-md hidden ${toolbarMode === 'doc' ? REVEAL_CLASS.upload.doc : REVEAL_CLASS.upload.fresh} ${uploadDragActive ? 'ring-2 ring-cyan-500' : ''}`}
        ondragover={handleUploadDragOver}
        ondragleave={handleUploadDragLeave}
        ondrop={handleUploadDrop}>
        <Button
          variant="secondary"
          size="sm"
          ariaLabel={text.upload}
          tooltip={text.upload}
          onClick={editor.requestUpload}
          className="px-2.5 py-1.5 text-sm">
          {#snippet icon()}
            <UploadIcon className="h-4 w-4" />
          {/snippet}
          {text.upload}
        </Button>
      </span>

      {#each TOOLBAR_BANDS as band, i}
        {#if band.menuClass && toolbarMenus[i].length > 0}
          <span class={band.menuClass}>
            <PanelMenu locale={settings.locale} actions={toolbarMenus[i]} onSelect={handlePanelAction} isDisabled={panelActionDisabled} />
          </span>
        {/if}
      {/each}
    </section>

      <div class="mt-3 flex min-h-0 flex-1 flex-col gap-3">
        <div class="flex flex-none items-center gap-2 text-sm text-slate-400">
          <span aria-live="polite" class={uploadNoticeIsError ? 'text-rose-400' : ''}>
            {editor.uploadNotice || !playback.isPlaying ? statusMessage : text.playbackRunning}
          </span>
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
              theme={settings.theme}
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
                  <!-- Mobile only: the panel stacks below the editor, so it
                       needs an in-panel collapse control; desktop toggles via
                       the Info button in the toolbar. -->
                  <Button
                    variant="ghost"
                    size="sm"
                    ariaLabel={text.infoCollapse}
                    tooltip={text.infoCollapse}
                    onClick={() => {
                      showMetadata = false
                      editorRef?.focus()
                    }}
                    className="border border-slate-700 text-slate-400 hover:text-slate-200 lg:hidden">
                    {#snippet icon()}
                      <ChevronDownIcon className="h-4 w-4" />
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
                            class="relative border-t border-slate-800 align-top {row.active ? 'bg-cyan-500/15 text-cyan-100' : 'text-slate-300 hover:bg-slate-800/60'}">
                            <td class="px-2 py-1 whitespace-nowrap">
                              <!-- Stretched over the row so the entire line plays the sentence; the tr is the positioning context. -->
                              <button
                                type="button"
                                aria-label={`${text.playSegment} ${row.segmentIndex + 1}`}
                                onclick={() => playback.playFromSegment(row.segmentIndex, row.offset)}
                                class="absolute inset-0 flex cursor-pointer items-start rounded px-2 py-1 text-left font-mono outline-none transition hover:text-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-500 motion-reduce:transition-none">
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
  </div>

  <input
    bind:this={fileInputRef}
    type="file"
    accept="text/plain,.txt,.md,.json,.csv,.html,.js,.xml,.yml,.yaml,application/json,text/markdown,text/html,text/xml,text/javascript"
    class="hidden"
    onchange={handleFileChange} />

  {#if settingsOpen}
    {#await import('$lib/components/SettingsDialog.svelte') then { default: SettingsDialog }}
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
    {:catch}
      <!-- Chunk load failed; drop the dialog instead of leaving an unhandled rejection. -->
      {settingsOpen = false}
    {/await}
  {/if}

  {#if editor.saveDialogOpen}
    <BaseDialog title={text.saveDialogTitle} maxWidth="md" closeLabel={text.close} onCancel={editor.cancelSave}>
      <form
        class="flex flex-col gap-4"
        onsubmit={event => {
          event.preventDefault()
          editor.confirmSave()
        }}>
        <label class="flex flex-col gap-1.5 text-sm text-slate-300">
          <span>{text.documentNameLabel}</span>
          <input
            bind:this={saveNameInputRef}
            type="text"
            bind:value={() => editor.saveName, v => (editor.saveName = v)}
            required
            oninput={() => {
              if (editor.saveName.trim()) {
                editor.showNameError = false
              }
            }}
            placeholder={text.documentNamePlaceholder}
            aria-label={text.documentNameLabel}
            class="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50" />
          {#if editor.showNameError}
            <p role="alert" class="text-xs text-rose-400">{text.documentNameRequired}</p>
          {/if}
        </label>
        <div class="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              editor.resetSaveDraft()
              saveNameInputRef?.focus()
            }}
            disabled={!editor.saveDirty}>
            {text.reset}
          </Button>
          <Button variant="primary" accent="cyan" type="submit" disabled={editor.saveDisabled || (!editor.saveDirty && !editor.isDirty)}>
            {text.save}
          </Button>
        </div>
      </form>
    </BaseDialog>
  {/if}

  {#if editor.saveDialogOpen && editor.overwriteConfirmOpen}
    <BaseDialog title={text.overwriteTitle} maxWidth="md" closeLabel={text.close} onCancel={editor.cancelOverwrite}>
      <div class="flex flex-col gap-4">
        <p class="text-sm leading-6 text-slate-400">{text.overwriteMessage}</p>
        <div class="flex flex-wrap items-center justify-end gap-3">
          <Button variant="primary" accent="rose" onClick={editor.applyOverwrite}>{text.save}</Button>
        </div>
      </div>
    </BaseDialog>
  {/if}

  {#if editor.discardDialogOpen}
    <BaseDialog title={text.discardTitle} maxWidth="md" closeLabel={text.close} onCancel={editor.cancelDiscard}>
      <div class="flex flex-col gap-4">
        <p class="text-sm leading-6 text-slate-400">{text.discardMessage}</p>
        <div class="flex flex-wrap items-center justify-end gap-3">
          <Button variant="primary" accent="rose" onClick={editor.confirmDiscard}>{text.discardConfirm}</Button>
        </div>
      </div>
    </BaseDialog>
  {/if}

  {#if editor.deleteDialogOpen}
    <BaseDialog title={text.deleteConfirmTitle} maxWidth="md" closeLabel={text.close} onCancel={editor.cancelDelete}>
      <div class="flex flex-col gap-4">
        <div class="flex min-w-0 flex-col gap-1">
          <p class="truncate text-sm font-medium text-slate-100">{editor.deleteTargetName}</p>
          <p class="text-sm leading-6 text-slate-400">{text.deleteConfirmMessage}</p>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-3">
          <Button variant="primary" accent="rose" onClick={editor.confirmDelete}>{text.delete}</Button>
        </div>
      </div>
    </BaseDialog>
  {/if}
</div>
