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
  import Toast from '$lib/components/Toast.svelte'
  import Menu from '$lib/components/Menu.svelte'
  import GlobeIcon from '$lib/icons/GlobeIcon.svelte'
  import SettingsIcon from '$lib/icons/SettingsIcon.svelte'
  import InfoIcon from '$lib/icons/InfoIcon.svelte'

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
  import { SPEED_OPTIONS } from '$lib/tts-reference'
  import ChipDropdown from '$lib/components/ChipDropdown.svelte'
  import { THEME_ICONS, THEME_MENU_OPTIONS } from '$lib/page/theme'
  import PaletteIcon from '$lib/icons/PaletteIcon.svelte'
  import {
    buildChipLocaleOptions,
    buildChipGenderOptions,
    buildChipLangOptions,
    buildWrittenLabel,
    buildVoiceChipOptions,
    buildChipVoiceOptions,
    handleLocaleChipSelect as handleLocaleChipSelectImpl,
    handleGenderChipSelect as handleGenderChipSelectImpl,
    handleLangChipSelect as handleLangChipSelectImpl,
    handleVoiceChipSelect as handleVoiceChipSelectImpl,
    speedChipOptions,
  } from '$lib/page/chips'
  import { createPlaybackArrowHandler as handlePlaybackArrowKeyImpl } from '$lib/page/toolbar'
  import { panelActionDisabled as panelActionDisabledImpl, createPanelActionHandler } from '$lib/page/panel'
  import { createWarmCacheController } from '$lib/page/warm-cache'
  import { useKeyboardShortcuts } from '$lib/page/use-keyboard-shortcuts.svelte'
  import { useBeforeUnloadGuard } from '$lib/page/use-beforeunload-guard.svelte'
  import { goto, invalidateAll } from '$app/navigation'
  import { useAdminPresence } from '$lib/use-admin-presence.svelte'
  import ProfileIcon from '$lib/icons/ProfileIcon.svelte'
  import { logout as logoutUser } from '$lib/user-auth'
  import { usePlaybackSlider } from '$lib/page/use-playback-slider.svelte'
  import { usePlayback, type CodeEditorHandle } from '$lib/use-playback.svelte'
  import { useMetadata, RESYNC_DEBOUNCE_MS } from '$lib/use-metadata.svelte'
  import { useSynthesisCache } from '$lib/use-synthesis-cache.svelte'
  import PlaybackSlider from '$lib/components/PlaybackSlider.svelte'
  import MetadataPanel from '$lib/components/MetadataPanel.svelte'
  import { useSettings, type UiTheme } from '$lib/use-settings.svelte'
  import { useDocuments } from '$lib/use-documents.svelte'
  import { useDocumentEditor } from '$lib/use-document-editor.svelte'
  import { useDocumentsDrawer } from '$lib/use-documents-drawer.svelte'
  let { data }: { data: { user: { id: number; username: string; email: string } | null } } = $props()
  const settings = useSettings()
  const adminPresence = useAdminPresence()
  const documents = useDocuments()
  const drawer = useDocumentsDrawer(documents)

  // Mirrors Tailwind's `lg` breakpoint for JS-only interaction gating: the
  // drawer is docked into the layout at this width, overlay below it. Must
  // stay in sync with DocumentsDrawer's `lg:` docking classes.
  const DOCKED_QUERY = '(min-width: 64rem)'
  let isDocked = $state(false)
  $effect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(DOCKED_QUERY)
    const update = () => (isDocked = mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  })

  // Late-bound so playback can notify the metadata layer without a circular
  // factory dependency; assigned once the metadata composable exists below.
  const hooks: { prepareForPlayback: () => void } = { prepareForPlayback: () => {} }

  const playback = usePlayback({
    settings,
    getEditor: () => editorRef,
    getCacheScopeId: () => editor.cacheScopeId,
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
    resetPlaybackSession: () => {
      playback.resetSession()
    },
    closeDrawer: () => {
      if (!isDocked) drawer.closeDrawer()
    },
    focusEditor: () => {
      // Defer focus until after the drawer state has re-rendered.
      void tick().then(() => editorRef?.focus())
    },
    openFilePicker: () => fileInputRef?.click(),
    isPlaybackActive: () => playback.isPlaying,
  })

  let settingsOpen = $state(false)
  let showMetadata = $state(false)
  let dockedDrawerOpen = $state(true)
  // Hide the editor so the info panel fills the content area; the state
  // outlives panel close/reopen so toggling Info keeps the expanded layout.
  let metadataExpanded = $state(false)

  const synthesisCache = useSynthesisCache({
    settings,
    playback,
    getCacheScopeId: () => editor.cacheScopeId,
    getEditor: () => editorRef,
  })

  $effect(() => {
    synthesisCache.setStatsOpen(settingsOpen)
  })

  let fileInputRef = $state<HTMLInputElement | null>(null)

  let uploadDragActive = $state(false)

  let headerRef = $state<HTMLElement | null>(null)
  let drawerButtonRef = $state<HTMLButtonElement | null>(null)
  let drawerPanelRef = $state<HTMLElement | null>(null)
  let drawerSearchRef = $state<HTMLInputElement | null>(null)

  let editorRef = $state<CodeEditorHandle | null>(null)

  const text = $derived(UI_TEXT[settings.locale])

  const themeLabels = $derived<Record<UiTheme, string>>({
    dark: text.theme.dark,
    ember: text.theme.ember,
    forest: text.theme.forest,
    midnight: text.theme.midnight,
    nebula: text.theme.nebula,
    light: text.theme.light,
    mint: text.theme.mint,
    sepia: text.theme.sepia,
    lavender: text.theme.lavender,
    sky: text.theme.sky,
  })

  const themeOptions = $derived(
    THEME_MENU_OPTIONS.map(option => ({ value: option.value, label: themeLabels[option.value], icon: THEME_ICONS[option.value] })),
  )

  const chipLangOptions = $derived(buildChipLangOptions(settings.locale))
  const chipLocaleOptions = $derived(buildChipLocaleOptions(playback.positionLanguageCode))
  const chipGenderOptions = $derived(buildChipGenderOptions(playback.positionLanguageCode, playback.positionVoiceLocale))
  const writtenLabel = $derived(buildWrittenLabel(settings.locale, playback.positionLanguageCode))
  const voiceChipOptions = $derived(buildVoiceChipOptions(playback.positionLanguageCode, playback.positionVoiceLocale))
  const chipVoiceOptions = $derived(buildChipVoiceOptions(voiceChipOptions))
  const activeChipVoiceEdge = $derived(playback.positionVoiceEdge)

  function handleSpeedChipSelect(value: string) { playback.setPlaybackSpeed(Number(value)) }

  const statusMessage = $derived(
    editor.uploadNotice === 'uploaded'
      ? text.upload.success
      : editor.uploadNotice === 'too-large'
        ? text.upload.tooLarge
        : editor.uploadNotice === 'read-failed'
          ? text.upload.failed
          : editor.uploadNotice === 'binary'
            ? text.upload.binary
            : playback.statusMessage,
  )
  const uploadNoticeIsError = $derived(editor.uploadNotice !== null && editor.uploadNotice !== 'uploaded')
  const playbackSlider = usePlaybackSlider({
    getTotalDuration: () => playback.totalDuration,
    getTotalElapsed: () => playback.totalElapsed,
    getIsPlaybackEnded: () => playback.isPlaybackEnded,
  })

  // toolbar arrow handler — defined after slider so playbackSlider.max is in scope via getter
  const handlePlaybackArrowKey = handlePlaybackArrowKeyImpl({
    getEditorRef: () => editorRef,
    getDrawerPanelRef: () => drawerPanelRef,
    getPlayback: () => playback,
    getSliderMax: () => playbackSlider.max,
    dialogsOpen,
  })

  // Overflow-menu contents per band, derived from the single-source ladder so
  // band boundaries and menu contents cannot drift apart. Index parallels
  // TOOLBAR_BANDS; the last entry is empty because every action is inline.
  const toolbarMode: ToolbarMode = $derived(editor.currentDocId ? 'doc' : 'fresh')
  const toolbarMenus = $derived(TOOLBAR_BANDS.map(band => menuFor(band.name, toolbarMode)))
  const overlayDrawerOpen = $derived(!isDocked && drawer.drawerOpen)
  const drawerVisible = $derived(isDocked ? dockedDrawerOpen : drawer.drawerOpen)

  function panelActionDisabled(action: PanelAction): boolean {
    return panelActionDisabledImpl(action, {
      isPlaying: playback.isPlaying,
      canPlay: settings.canPlay,
      saveDisabled: editor.saveDisabled,
      currentDocId: editor.currentDocId,
      isDirty: editor.isDirty,
    })
  }

  const warmCache = createWarmCacheController({
    getContent: () => settings.content,
    getDocId: () => editor.currentDocId ?? null,
    warmFromCache: () => playback.warmFromCache(),
  })
  $effect(() => warmCache.handleEffect())

  function toggleDrawer() {
    if (isDocked) {
      dockedDrawerOpen = !dockedDrawerOpen
      if (dockedDrawerOpen) {
        drawer.documentSearch = ''
        void tick().then(() => drawerSearchRef?.focus())
      }
      return
    }
    const opened = drawer.toggleDrawer()
    if (!opened) {
      drawerButtonRef?.focus()
    }
  }

  const handlePanelAction = createPanelActionHandler({
    getPlayback: () => playback,
    getEditor: () => editor,
    getShowMetadata: () => showMetadata,
    setShowMetadata: (v: boolean) => { showMetadata = v },
  })

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
    return (
      settingsOpen ||
      accountOpen ||
      editor.overwriteConfirmOpen ||
      editor.discardDialogOpen ||
      editor.deleteDialogOpen ||
      editor.playbackConfirmOpen
    )
  }

  function selectLanguage(value: UiLocale) {
    settings.setLocale(value)
    playback.onLocaleChanged(value)
  }

  function selectTheme(value: UiTheme) {
    settings.setTheme(value)
  }
  function handleLoginClick() {
    // The active slug is already persisted to localStorage on every
    // navigation, so the login page reads it back directly.
    void goto('/login')
  }

  let sessionToastDismissed = $state(false)
  $effect(() => {
    if (documents.syncError !== 'session_expired') sessionToastDismissed = false
  })
  const showSessionToast = $derived(documents.syncError === 'session_expired' && !sessionToastDismissed)

  let accountOpen = $state(false)
  let accountPending = $state(false)
  let accountError = $state('')

  function handleProfileClick() {
    if (adminPresence.isAdmin) {
      void goto('/admin')
      return
    }
    if (!data?.user) {
      handleLoginClick()
      return
    }
    accountError = ''
    accountOpen = true
  }

  async function handleAccountLogout() {
    if (accountPending) {
      return
    }
    accountPending = true
    accountError = ''
    try {
      await logoutUser()
      accountOpen = false
      // Re-runs the layout load so `data.user` clears and the documents
      // sync toggle stops pushing mutations.
      await invalidateAll()
    } catch (error) {
      accountError = error instanceof Error ? error.message : text.auth.signOut.failed
    } finally {
      accountPending = false
    }
  }
  onMount(() => {
    const disposeSettings = settings.hydrate()
    void adminPresence.refresh()
    documents.hydrate()
    // Restore the document referenced by the URL (deep link / reload); this
    // also settles the history baseline before any user navigation.
    editor.handleHistoryNavigation()
    editor.markBaseline()
    playback.initStatus()
    return () => {
      disposeSettings()
      playback.stopPlayback()
    }
  })

  // Account state arrives via layout data: sync the server copy into the
  // merged listing on sign-in, and stop pushing mutations on sign-out. Runs
  // on mount too, so no separate call above.
  $effect(() => {
    documents.setSyncEnabled(data.user !== null)
  })

  // Browser Back/Forward moves between documents; respect unsaved-changes
  // and playback guards (like toolbar navigation) instead of silently wiping.
  $effect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const onPopState = () => editor.handleHistoryNavigation()
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  })

  function dismissDrawerAndFocusTrigger() {
    drawer.closeDrawer()
    drawerButtonRef?.focus()
  }

  $effect(() => {
    if (!overlayDrawerOpen) {
      return
    }
    function handleEscape(event: KeyboardEvent) {
      if (dialogsOpen()) {
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
      dismissDrawerAndFocusTrigger()
    }
    // Document capture (not window) so the overflow menu's window-level
    // Escape handler can stop propagation before this runs while it is open.
    document.addEventListener('keydown', handleEscape, true)
    return () => document.removeEventListener('keydown', handleEscape, true)
  })

  // When the drawer is an overlay (not docked), a click outside it dismisses
  // it. The docked layout shows the panel permanently, so it stays open.
  // `click` (not pointerdown) so touch scrolls and drag selections that start
  // outside do not close the drawer.
  $effect(() => {
    if (!overlayDrawerOpen) {
      return
    }
    function handleDocumentClick(event: MouseEvent) {
      if (dialogsOpen()) {
        return
      }
      const target = event.target as Node | null
      if (!target) return
      // Svelte-native: use bound refs instead of string-based closest()
      if (headerRef?.contains(target) || drawerPanelRef?.contains(target)) {
        return
      }
      dismissDrawerAndFocusTrigger()
    }
    document.addEventListener('click', handleDocumentClick, true)
    return () => document.removeEventListener('click', handleDocumentClick, true)
  })

  $effect(() => {
    if (!overlayDrawerOpen) {
      return
    }
    const input = drawerSearchRef
    if (!input) {
      return
    }
    void tick().then(() => input.focus())
  })

  useKeyboardShortcuts(() => editor, dialogsOpen)
  useBeforeUnloadGuard(() => editor.isDirty)
</script>

<svelte:head>
  <title>{text.app.appTitle}</title>
</svelte:head>

<svelte:window onkeydown={handlePlaybackArrowKey} />

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

  <header bind:this={headerRef} class="flex shrink-0 items-center justify-between gap-4 border-b border-slate-800 px-3 py-3 sm:px-4">
    <div class="flex items-center gap-2">
      <Button
        bind:buttonEl={drawerButtonRef}
        variant="secondary"
        size="sm"
        ariaLabel={text.documents.label}
        ariaExpanded={drawerVisible}
        tooltip={text.documents.label}
        onClick={toggleDrawer}>
        {#snippet icon()}
          <MenuIcon className="h-4 w-4" />
        {/snippet}
      </Button>
      <h1 class="text-base font-semibold tracking-tight sm:text-lg">{text.app.appShortTitle}</h1>
    </div>
    <div class="flex items-center gap-2">
      <Menu
        items={UI_LANGUAGE_OPTIONS}
        itemKey={option => option.value}
        ariaLabel={text.app.language}
        triggerTooltip={text.app.language}
        align="right"
        autoPlace={true}
        triggerClass="p-1.5 relative before:absolute before:-inset-1.5 before:content-['']"
        phoneSheetTitle={text.app.language}
        closeLabel={text.close}
        itemRole="menuitemradio"
        itemChecked={option => option.value === settings.locale}
        itemClass={(option, state) =>
          `flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm outline-none transition-none ${
            state.disabled
              ? 'cursor-not-allowed text-slate-600'
              : state.active
                ? 'bg-slate-800 text-cyan-200'
                : option.value === settings.locale
                  ? 'text-cyan-200'
                  : 'text-slate-300'
          }`}
        onSelect={index => selectLanguage(UI_LANGUAGE_OPTIONS[index].value)}>
        {#snippet icon()}
          <GlobeIcon className="h-4 w-4" />
        {/snippet}
        {#snippet item(option)}
          <span>{option.label}</span>
        {/snippet}
      </Menu>
      <Menu
        items={themeOptions}
        itemKey={option => option.value}
        ariaLabel={text.theme.label}
        triggerTooltip={text.theme.label}
        align="right"
        autoPlace={true}
        triggerClass="p-1.5 relative before:absolute before:-inset-1.5 before:content-['']"
        phoneSheetTitle={text.theme.label}
        closeLabel={text.close}
        itemRole="menuitemradio"
        itemChecked={option => option.value === settings.theme}
        itemClass={(option, state) =>
          `flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm outline-none transition-none ${
            state.disabled
              ? 'cursor-not-allowed text-slate-600'
              : state.active
                ? 'bg-slate-800 text-cyan-200'
                : option.value === settings.theme
                  ? 'text-cyan-200'
                  : 'text-slate-300'
          }`}
        onSelect={index => selectTheme(themeOptions[index].value)}>
        {#snippet icon()}
          <PaletteIcon className="h-4 w-4" />
        {/snippet}
        {#snippet item(option, _state)}
          {@const OptionIcon = option.icon}
          {#if OptionIcon}
            <OptionIcon className="h-4 w-4 shrink-0" />
          {/if}
          <span>{option.label}</span>
        {/snippet}
      </Menu>
      <Button variant="secondary" size="sm" ariaLabel={text.app.settings} tooltip={text.app.settings} onClick={() => (settingsOpen = true)}>
        {#snippet icon()}
          <SettingsIcon className="h-4 w-4" />
        {/snippet}
      </Button>
      <Button variant="secondary" size="sm" ariaLabel={adminPresence.isAdmin ? text.adminTitle : (data?.user ? data.user.username : text.auth.login)} tooltip={adminPresence.isAdmin ? text.adminTitle : (data?.user ? data.user.username : text.auth.login)} onClick={handleProfileClick}>
        {#snippet icon()}
          <ProfileIcon className="h-4 w-4" />
        {/snippet}
      </Button>
    </div>
  </header>

  <div class="relative flex min-h-0 flex-1 overflow-hidden">
    <DocumentsDrawer
      locale={settings.locale}
      documents={drawer.visibleDocuments}
      bind:search={() => drawer.documentSearch, v => (drawer.documentSearch = v)}
      currentDocId={editor.currentDocId}
      bind:panelRef={drawerPanelRef}
      bind:inputRef={drawerSearchRef}
      isOpen={drawerVisible}
      isDocked={isDocked}
      syncError={documents.syncError}
      onNew={editor.requestNewDocument}
      onOpen={editor.requestOpenDocument}
      onClose={dismissDrawerAndFocusTrigger} />

    <main class="flex min-w-0 flex-1 flex-col gap-2 px-3 py-2 sm:px-4 sm:py-2">
      <div class="flex flex-none min-w-0 items-center">
        <EditableText locale={settings.locale} text={editor.currentDocName} onChange={editor.renameDocument} size="lg" maxWidth={480} />
      </div>
      <section aria-label={text.playback.controls} class="@container flex flex-none flex-wrap items-center gap-1.5">
      <span class={REVEAL_CLASS.play}>
        <Button
          variant="outline"
          accent="cyan"
          size="sm"
          ariaPressed={playback.isPlaying}
          disabled={playback.voiceSwitching || (playback.isPlaying ? false : !settings.canPlay)}
          ariaLabel={playback.isPlaying ? text.stop : text.playback.label}
          onClick={playback.isPlaying ? playback.stopPlayback : playback.startPlayback}>
          {#snippet icon()}
            {#if playback.isPlaying}
              <StopIcon className="h-4 w-4" />
            {:else}
              <SpeakerIcon className="h-4 w-4" />
            {/if}
          {/snippet}
          {playback.isPlaying ? text.stop : text.playback.label}
        </Button>
      </span>

      <span class={REVEAL_CLASS.reset}>
        <Button
          variant="secondary"
          size="sm"
          disabled={editor.currentDocId ? !editor.isDirty : !settings.canPlay}
          ariaLabel={text.documents.reset}
          onClick={editor.resetEditor}>
          {#snippet icon()}
            <RefreshIcon className="h-4 w-4" />
          {/snippet}
          {text.documents.reset}
        </Button>
      </span>

      <span class={REVEAL_CLASS.save}>
        <Button
          variant="secondary"
          size="sm"
          disabled={editor.saveDisabled}
          ariaLabel={text.documents.save}
          onClick={editor.saveDocument}>
          {#snippet icon()}
            <SaveIcon className="h-4 w-4" />
          {/snippet}
          {text.documents.save}
        </Button>
      </span>

      <span class={REVEAL_CLASS.copy}>
        <Button
          variant="secondary"
          size="sm"
          disabled={!settings.canPlay}
          ariaLabel={text.documents.copy}
          onClick={() => void editor.copyEditorContent()}
          icon={copyIcon}>
          {text.documents.copy}
        </Button>
      </span>

      {#if editor.currentDocId}
        <span class={REVEAL_CLASS.delete}>
          <Button
            variant="secondary"
            size="sm"
            ariaLabel={text.documents.delete}
            onClick={() => {
              if (editor.currentDocId) {
                editor.requestDeleteDocument(editor.currentDocId)
              }
            }}>
            {#snippet icon()}
              <DeleteIcon className="h-4 w-4" />
            {/snippet}
            {text.documents.delete}
          </Button>
        </span>
      {/if}

      <span class={toolbarMode === 'doc' ? REVEAL_CLASS.info.doc : REVEAL_CLASS.info.fresh}>
        <Button
          variant="secondary"
          size="sm"
          ariaPressed={showMetadata}
          disabled={!settings.canPlay}
          ariaLabel={text.info.label}
          onClick={() => (showMetadata = !showMetadata)}>
          {#snippet icon()}
            <InfoIcon className="h-4 w-4" />
          {/snippet}
          {text.info.label}
        </Button>
      </span>

      {#if editor.currentDocId}
        <span class={REVEAL_CLASS.clone}>
          <Button
            variant="secondary"
            size="sm"
            ariaLabel={text.documents.clone}
            onClick={editor.requestCloneDocument}>
            {#snippet icon()}
              <DocumentIcon className="h-4 w-4" />
            {/snippet}
            {text.documents.clone}
          </Button>
        </span>
      {/if}

      <span
        role="presentation"
        class={`rounded-md hidden ${toolbarMode === 'doc' ? REVEAL_CLASS.upload.doc : REVEAL_CLASS.upload.fresh} ${uploadDragActive ? 'ring-2 ring-cyan-500' : ''}`}
        ondragover={handleUploadDragOver}
        ondragleave={handleUploadDragLeave}
        ondrop={handleUploadDrop}>
        <Button variant="secondary" size="sm" ariaLabel={text.upload.label} onClick={editor.requestUpload}>
          {#snippet icon()}
            <UploadIcon className="h-4 w-4" />
          {/snippet}
          {text.upload.label}
        </Button>
      </span>

      {#each TOOLBAR_BANDS as band, i}
        {#if band.menuClass && toolbarMenus[i].length > 0}
          <span class={band.menuClass}>
            <PanelMenu
              locale={settings.locale}
              actions={toolbarMenus[i]}
              onSelect={handlePanelAction}
              isDisabled={panelActionDisabled}
              isPlaying={playback.isPlaying}
              labels={{ play: playback.isPlaying ? text.stop : text.playback.label }} />
          </span>
        {/if}
      {/each}
    </section>

      <div class="flex min-h-0 flex-1 flex-col gap-2">
        {#if editor.uploadNotice || playback.synthesizedCount > 0}
          <div class="flex flex-none flex-col gap-3">
            <div class="flex items-center gap-2 text-sm text-slate-400">
              {#if editor.uploadNotice}
                <span aria-live="polite" class={uploadNoticeIsError ? 'text-rose-400' : ''}>
                  {statusMessage}
                </span>
              {/if}
              {#if playback.segments[playback.positionSegmentIndex]}
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <ChipDropdown
                    label={writtenLabel}
                    options={chipLangOptions}
                    activeValue={playback.positionLanguageCode}
                    ariaLabel={text.voices.segmentLanguage}
                    variant="sky"
                    filterable
                    filterPlaceholder={text.languages.search}
                    emptyText={text.languages.noMatching}
                    disabled={playback.isPlaying}
                    onSelect={(v) => void handleLangChipSelectImpl(playback, v)} />
                  {#if playback.positionVoiceName}
                    {#if chipLocaleOptions.length > 1}
                      <ChipDropdown
                        label={playback.positionVoiceLocale}
                        options={chipLocaleOptions}
                        activeValue={playback.positionVoiceLocale}
                        ariaLabel={text.voices.segmentLocale}
                        variant="amber"
                        filterable
                        filterPlaceholder={text.languages.localeSearch}
                        emptyText={text.languages.noMatchingLocales}
                        disabled={playback.isPlaying}
                        onSelect={(v) => void handleLocaleChipSelectImpl(playback, v)} />
                    {/if}
                    {#if chipGenderOptions.length > 1}
                      <ChipDropdown
                        label={playback.positionVoiceGender}
                        options={chipGenderOptions}
                        activeValue={playback.positionVoiceGender}
                        ariaLabel={text.voices.segmentGender}
                        variant="fuchsia"
                        disabled={playback.isPlaying}
                        onSelect={(v) => void handleGenderChipSelectImpl(playback, v)} />
                    {/if}
                    <ChipDropdown
                      label={playback.positionVoiceName}
                      options={chipVoiceOptions}
                      activeValue={activeChipVoiceEdge}
                      ariaLabel={text.voices.model}
                      variant="violet"
                      filterable
                      filterPlaceholder={text.voices.search}
                      emptyText={text.voices.noMatching}
                      disabled={voiceChipOptions.length === 0}
                      onSelect={(v) => void handleVoiceChipSelectImpl(playback, v)} />
                  {/if}
                  <ChipDropdown
                    label={`${playback.playbackSpeed}x`}
                    options={speedChipOptions}
                    activeValue={String(playback.playbackSpeed)}
                    ariaLabel={text.playback.speed}
                    variant="amber"
                    onSelect={(v) => handleSpeedChipSelect(v)} />
                  {#if metadata.totalSentences > 0}
                    <span class="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-200">
                      {`${metadata.positionSentenceIndex + 1}/${metadata.totalSentences}`}
                    </span>
                  {/if}
                </div>
              {/if}
            </div>
            {#if playback.segments[playback.positionSegmentIndex]}
              <PlaybackSlider
                displayValue={playbackSlider.displayValue}
                totalDuration={playback.totalDuration}
                max={playbackSlider.max}
                progress={playbackSlider.progress}
                disabled={playbackSlider.max <= 0}
                seekLabel={text.playback.seek}
                onInput={playbackSlider.handleInput}
                onCommit={(e) => playbackSlider.commit(e, elapsed => playback.seekTo(elapsed))} />
            {/if}
          </div>
        {/if}
        <div class="flex min-h-0 flex-1 gap-2 {showMetadata ? (isDocked ? 'flex-row' : 'flex-col') : 'flex-col'}">
          <div
            class="{showMetadata && metadataExpanded ? 'hidden' : 'flex'} min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 shadow-2xl shadow-slate-950/30">
            <CodeEditor
              bind:this={editorRef}
              bind:content={settings.content}
              onSelectionChange={range => playback.syncSelectionStart(range)}
              editable={!playback.isPlaying}
              selectionEnabled={!playback.isPlaying}
              theme={settings.theme}
              editorAriaLabel={text.editor.label}
              containerClass="min-h-0 flex-1"
              editorClass="h-full" />
          </div>

          {#if showMetadata}
            <MetadataPanel
              metadata={metadata}
              playback={playback}
              text={text}
              isDocked={isDocked}
              expanded={metadataExpanded}
              onToggleExpand={() => {
                metadataExpanded = !metadataExpanded
                if (!metadataExpanded) {
                  void tick().then(() => editorRef?.focus())
                }
              }}
              onCollapse={() => {
                showMetadata = false
                void tick().then(() => editorRef?.focus())
              }}
              onResetCache={synthesisCache.resetCurrentDocument} />
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
        cacheStats={synthesisCache.stats}
        onCancel={() => (settingsOpen = false)}
        onSelectVoice={settings.selectVoice}
        onSelectGroup={settings.selectGroup}
        onSelectSpeed={settings.setSpeed}
        onSelectConcurrent={settings.setSynthesisConcurrency}
        onClearCache={() => void synthesisCache.clearAll()}
        onViewCache={() => void synthesisCache.openDialog()} />
    {:catch}
      <!-- Chunk load failed; drop the dialog instead of leaving an unhandled rejection. -->
      {settingsOpen = false}
    {/await}
  {/if}

  {#if synthesisCache.dialogOpen}
    {#await import('$lib/components/SynthesisCacheDialog.svelte') then { default: SynthesisCacheDialog }}
      <SynthesisCacheDialog
        locale={settings.locale}
        entries={synthesisCache.entries}
        loading={synthesisCache.dialogLoading}
        onCancel={synthesisCache.closeDialog}
        onClearSelected={synthesisCache.clearSelected}
        onClearAll={synthesisCache.clearAll}
        onBeforePlay={() => playback.stopPlayback()} />
    {:catch}
      <!-- Chunk load failed; drop the dialog instead of leaving an unhandled rejection. -->
      {synthesisCache.closeDialog()}
    {/await}
  {/if}

  {#if editor.overwriteConfirmOpen}
    <BaseDialog title={text.dialogs.overwriteTitle} maxWidth="md" closeLabel={text.close} onCancel={editor.cancelOverwrite}>
      <div class="flex flex-col gap-4">
        <p class="text-sm leading-6 text-slate-400">{text.dialogs.overwriteMessage}</p>
        <div class="flex flex-wrap items-center justify-end gap-3">
          <Button variant="primary" accent="rose" onClick={editor.applyOverwrite}>{text.documents.save}</Button>
        </div>
      </div>
    </BaseDialog>
  {/if}

  {#if editor.discardDialogOpen}
    <BaseDialog title={text.dialogs.discardTitle} maxWidth="md" closeLabel={text.close} onCancel={editor.cancelDiscard}>
      <div class="flex flex-col gap-4">
        <p class="text-sm leading-6 text-slate-400">{text.dialogs.discardMessage}</p>
        <div class="flex flex-wrap items-center justify-end gap-3">
          <Button variant="primary" accent="rose" onClick={editor.confirmDiscard}>{text.dialogs.discardConfirm}</Button>
        </div>
      </div>
    </BaseDialog>
  {/if}

  {#if editor.deleteDialogOpen}
    <BaseDialog title={text.dialogs.deleteConfirmTitle} maxWidth="md" closeLabel={text.close} onCancel={editor.cancelDelete}>
      <div class="flex flex-col gap-4">
        <div class="flex min-w-0 flex-col gap-1">
          <p class="truncate text-sm font-medium text-slate-100">{editor.deleteTargetName}</p>
          <p class="text-sm leading-6 text-slate-400">{text.dialogs.deleteConfirmMessage}</p>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-3">
          <Button variant="primary" accent="rose" onClick={editor.confirmDelete}>{text.documents.delete}</Button>
        </div>
      </div>
    </BaseDialog>
  {/if}

  {#if editor.playbackConfirmOpen}
    <BaseDialog title={text.dialogs.stopPlaybackTitle} maxWidth="md" closeLabel={text.close} onCancel={editor.cancelPlayback}>
      <div class="flex flex-col gap-4">
        <p class="text-sm leading-6 text-slate-400">{text.dialogs.stopPlaybackMessage}</p>
        <div class="flex flex-wrap items-center justify-end gap-3">
          <Button variant="primary" accent="rose" onClick={editor.confirmPlayback}>{text.dialogs.stopPlaybackConfirm}</Button>
        </div>
      </div>
    </BaseDialog>
  {/if}

  {#if accountOpen && data?.user}
    <BaseDialog title={text.auth.account} maxWidth="md" closeLabel={text.close} onCancel={() => (accountOpen = false)}>
      <div class="flex flex-col gap-4">
        <p class="truncate text-sm font-medium text-slate-100">{data.user.username}</p>
        {#if accountError}
          <p class="text-sm text-rose-400">{accountError}</p>
        {/if}
        <div class="flex flex-wrap items-center justify-end gap-3">
          <Button variant="primary" accent="rose" pending={accountPending} onClick={() => void handleAccountLogout()}>{text.auth.signOut.label}</Button>
        </div>
      </div>
    </BaseDialog>
  {/if}

  {#if showSessionToast}
    <Toast
      message={text.documents.sessionExpired}
      closeLabel={text.close}
      position="top-center"
      type="warning"
      onClose={() => (sessionToastDismissed = true)} />
  {/if}
</div>
