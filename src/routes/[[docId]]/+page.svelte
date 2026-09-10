<script lang="ts">
  import { onMount, tick } from 'svelte'
  import CodeEditor from '$lib/components/CodeEditor.svelte'
  import Button from '$lib/components/Button.svelte'
  import Buttons from '$lib/components/Buttons.svelte'
  import BaseDialog from '$lib/components/BaseDialog.svelte'
  import UserAuthPanel, { type AuthPanelMode } from '$lib/components/UserAuthPanel.svelte'
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

  import { LOCALES, getI18nContext, type Locale } from '$lib/i18n.svelte'
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
  const i18n = getI18nContext()

  // Late-bound so playback can notify the metadata layer without a circular
  const hooks: { prepareForPlayback: () => void } = { prepareForPlayback: () => {} }
  const playback = usePlayback({
    settings,
    i18n,
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
    i18n,
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

  const themeLabels = $derived<Record<UiTheme, string>>({
    dark: i18n.t('theme.dark'),
    ember: i18n.t('theme.ember'),
    forest: i18n.t('theme.forest'),
    midnight: i18n.t('theme.midnight'),
    nebula: i18n.t('theme.nebula'),
    light: i18n.t('theme.light'),
    mint: i18n.t('theme.mint'),
    sepia: i18n.t('theme.sepia'),
    lavender: i18n.t('theme.lavender'),
    sky: i18n.t('theme.sky'),
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
      ? i18n.t('upload.success')
      : editor.uploadNotice === 'too-large'
        ? i18n.t('upload.tooLarge')
        : editor.uploadNotice === 'read-failed'
          ? i18n.t('upload.failed')
          : editor.uploadNotice === 'binary'
            ? i18n.t('upload.binary')
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
      loginOpen ||
      editor.overwriteConfirmOpen ||
      editor.discardDialogOpen ||
      editor.deleteDialogOpen ||
      editor.playbackConfirmOpen
    )
  }

  function selectLanguage(value: Locale) {
    settings.setLocale(value)
    playback.onLocaleChanged()
  }

  function selectTheme(value: UiTheme) {
    settings.setTheme(value)
  }
  function handleLoginClick() {
    // The dialog owns the foreground (both sit at z-40); drop the toast so
    // it cannot linger above the scrim. The profile button remains as the
    // re-entry point if the dialog is cancelled.
    sessionToastDismissed = true
    loginOpen = true
  }

  function closeLoginDialog() {
    loginOpen = false
    loginMode = 'signin'
  }

  let sessionToastDismissed = $state(false)
  $effect(() => {
    if (documents.syncError !== 'session_expired') sessionToastDismissed = false
  })
  const showSessionToast = $derived(documents.syncError === 'session_expired' && !sessionToastDismissed)

  let loginOpen = $state(false)
  let loginMode = $state<AuthPanelMode>('signin')
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
      accountError = error instanceof Error ? error.message : i18n.t('auth.signOut.failed')
    } finally {
      accountPending = false
    }
  }
  onMount(() => {
    const disposeSettings = settings.hydrate()
    void adminPresence.refresh()
    documents.hydrate()
    // /login redirects here with ?login=1: auto-open the dialog once, then
    // strip the param with replaceState so no navigation is involved.
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('login') !== null) {
      loginOpen = true
      const url = new URL(window.location.href)
      url.searchParams.delete('login')
      window.history.replaceState(window.history.state, '', url.pathname + (url.search ? `?${url.searchParams}` : '') + url.hash)
    }
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
  <title>{i18n.t('app.appTitle')}</title>
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
        ariaLabel={i18n.t('documents.label')}
        ariaExpanded={drawerVisible}
        tooltip={i18n.t('documents.label')}
        onClick={toggleDrawer}>
        {#snippet icon()}
          <MenuIcon className="h-4 w-4" />
        {/snippet}
      </Button>
      <h1 class="text-base font-semibold tracking-tight sm:text-lg">{i18n.t('app.appShortTitle')}</h1>
    </div>
    <div class="flex items-center gap-2">
      <Menu
        items={LOCALES}
        itemKey={option => option.code}
        ariaLabel={i18n.t('app.language')}
        triggerTooltip={i18n.t('app.language')}
        align="right"
        autoPlace={true}
        triggerClass="p-1.5 relative before:absolute before:-inset-1.5 before:content-['']"
        phoneSheetTitle={i18n.t('app.language')}
        closeLabel={i18n.t('close')}
        itemRole="menuitemradio"
        itemChecked={option => option.code === settings.locale}
        itemClass={(option, state) =>
          `flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm outline-none transition-none ${
            state.disabled
              ? 'cursor-not-allowed text-slate-600'
              : state.active
                ? 'bg-slate-800 text-cyan-200'
                : option.code === settings.locale
                  ? 'text-cyan-200'
                  : 'text-slate-300'
          }`}
        onSelect={index => selectLanguage(LOCALES[index].code)}>
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
        ariaLabel={i18n.t('theme.label')}
        triggerTooltip={i18n.t('theme.label')}
        align="right"
        autoPlace={true}
        triggerClass="p-1.5 relative before:absolute before:-inset-1.5 before:content-['']"
        phoneSheetTitle={i18n.t('theme.label')}
        closeLabel={i18n.t('close')}
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
      <Button variant="secondary" size="sm" ariaLabel={i18n.t('app.settings')} tooltip={i18n.t('app.settings')} onClick={() => (settingsOpen = true)}>
        {#snippet icon()}
          <SettingsIcon className="h-4 w-4" />
        {/snippet}
      </Button>
      <Button variant="secondary" size="sm" ariaLabel={adminPresence.isAdmin ? i18n.t('adminTitle') : (data?.user ? data.user.username : i18n.t('auth.login'))} tooltip={adminPresence.isAdmin ? i18n.t('adminTitle') : (data?.user ? data.user.username : i18n.t('auth.login'))} onClick={handleProfileClick}>
        {#snippet icon()}
          <ProfileIcon className="h-4 w-4" />
        {/snippet}
      </Button>
    </div>
  </header>

  <div class="relative flex min-h-0 flex-1 overflow-hidden">
    <DocumentsDrawer
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
        <EditableText text={editor.currentDocName} onChange={editor.renameDocument} size="lg" maxWidth={480} />
      </div>
      <section aria-label={i18n.t('playback.controls')} class="@container flex flex-none flex-wrap items-center gap-1.5">
      <span class={REVEAL_CLASS.play}>
        <Button
          variant="outline"
          accent="cyan"
          size="sm"
          ariaPressed={playback.isPlaying}
          disabled={playback.voiceSwitching || (playback.isPlaying ? false : !settings.canPlay)}
          ariaLabel={playback.isPlaying ? i18n.t('stop') : i18n.t('playback.label')}
          onClick={playback.isPlaying ? playback.stopPlayback : playback.startPlayback}>
          {#snippet icon()}
            {#if playback.isPlaying}
              <StopIcon className="h-4 w-4" />
            {:else}
              <SpeakerIcon className="h-4 w-4" />
            {/if}
          {/snippet}
          {playback.isPlaying ? i18n.t('stop') : i18n.t('playback.label')}
        </Button>
      </span>

      <span class={REVEAL_CLASS.reset}>
        <Button
          variant="secondary"
          size="sm"
          disabled={editor.currentDocId ? !editor.isDirty : !settings.canPlay}
          ariaLabel={i18n.t('documents.reset')}
          onClick={editor.resetEditor}>
          {#snippet icon()}
            <RefreshIcon className="h-4 w-4" />
          {/snippet}
          {i18n.t('documents.reset')}
        </Button>
      </span>

      <span class={REVEAL_CLASS.save}>
        <Button
          variant="secondary"
          size="sm"
          disabled={editor.saveDisabled}
          ariaLabel={i18n.t('documents.save')}
          onClick={editor.saveDocument}>
          {#snippet icon()}
            <SaveIcon className="h-4 w-4" />
          {/snippet}
          {i18n.t('documents.save')}
        </Button>
      </span>

      <span class={REVEAL_CLASS.copy}>
        <Button
          variant="secondary"
          size="sm"
          disabled={!settings.canPlay}
          ariaLabel={i18n.t('documents.copy')}
          onClick={() => void editor.copyEditorContent()}
          icon={copyIcon}>
          {i18n.t('documents.copy')}
        </Button>
      </span>

      {#if editor.currentDocId}
        <span class={REVEAL_CLASS.delete}>
          <Button
            variant="secondary"
            size="sm"
            ariaLabel={i18n.t('documents.delete')}
            onClick={() => {
              if (editor.currentDocId) {
                editor.requestDeleteDocument(editor.currentDocId)
              }
            }}>
            {#snippet icon()}
              <DeleteIcon className="h-4 w-4" />
            {/snippet}
            {i18n.t('documents.delete')}
          </Button>
        </span>
      {/if}

      <span class={toolbarMode === 'doc' ? REVEAL_CLASS.info.doc : REVEAL_CLASS.info.fresh}>
        <Button
          variant="secondary"
          size="sm"
          ariaPressed={showMetadata}
          disabled={!settings.canPlay}
          ariaLabel={i18n.t('info.label')}
          onClick={() => (showMetadata = !showMetadata)}>
          {#snippet icon()}
            <InfoIcon className="h-4 w-4" />
          {/snippet}
          {i18n.t('info.label')}
        </Button>
      </span>

      {#if editor.currentDocId}
        <span class={REVEAL_CLASS.clone}>
          <Button
            variant="secondary"
            size="sm"
            ariaLabel={i18n.t('documents.clone')}
            onClick={editor.requestCloneDocument}>
            {#snippet icon()}
              <DocumentIcon className="h-4 w-4" />
            {/snippet}
            {i18n.t('documents.clone')}
          </Button>
        </span>
      {/if}

      <span
        role="presentation"
        class={`rounded-md hidden ${toolbarMode === 'doc' ? REVEAL_CLASS.upload.doc : REVEAL_CLASS.upload.fresh} ${uploadDragActive ? 'ring-2 ring-cyan-500' : ''}`}
        ondragover={handleUploadDragOver}
        ondragleave={handleUploadDragLeave}
        ondrop={handleUploadDrop}>
        <Button variant="secondary" size="sm" ariaLabel={i18n.t('upload.label')} onClick={editor.requestUpload}>
          {#snippet icon()}
            <UploadIcon className="h-4 w-4" />
          {/snippet}
          {i18n.t('upload.label')}
        </Button>
      </span>

      {#each TOOLBAR_BANDS as band, i}
        {#if band.menuClass && toolbarMenus[i].length > 0}
          <span class={band.menuClass}>
            <PanelMenu
              actions={toolbarMenus[i]}
              onSelect={handlePanelAction}
              isDisabled={panelActionDisabled}
              isPlaying={playback.isPlaying}
              labels={{ play: playback.isPlaying ? i18n.t('stop') : i18n.t('playback.label') }} />
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
                    ariaLabel={i18n.t('voices.segmentLanguage')}
                    variant="sky"
                    filterable
                    filterPlaceholder={i18n.t('languages.search')}
                    emptyText={i18n.t('languages.noMatching')}
                    disabled={playback.isPlaying}
                    onSelect={(v) => void handleLangChipSelectImpl(playback, v)} />
                  {#if playback.positionVoiceName}
                    {#if chipLocaleOptions.length > 1}
                      <ChipDropdown
                        label={playback.positionVoiceLocale}
                        options={chipLocaleOptions}
                        activeValue={playback.positionVoiceLocale}
                        ariaLabel={i18n.t('voices.segmentLocale')}
                        variant="amber"
                        filterable
                        filterPlaceholder={i18n.t('languages.localeSearch')}
                        emptyText={i18n.t('languages.noMatchingLocales')}
                        disabled={playback.isPlaying}
                        onSelect={(v) => void handleLocaleChipSelectImpl(playback, v)} />
                    {/if}
                    {#if chipGenderOptions.length > 1}
                      <ChipDropdown
                        label={playback.positionVoiceGender}
                        options={chipGenderOptions}
                        activeValue={playback.positionVoiceGender}
                        ariaLabel={i18n.t('voices.segmentGender')}
                        variant="fuchsia"
                        disabled={playback.isPlaying}
                        onSelect={(v) => void handleGenderChipSelectImpl(playback, v)} />
                    {/if}
                    <ChipDropdown
                      label={playback.positionVoiceName}
                      options={chipVoiceOptions}
                      activeValue={activeChipVoiceEdge}
                      ariaLabel={i18n.t('voices.model')}
                      variant="violet"
                      filterable
                      filterPlaceholder={i18n.t('voices.search')}
                      emptyText={i18n.t('voices.noMatching')}
                      disabled={voiceChipOptions.length === 0}
                      onSelect={(v) => void handleVoiceChipSelectImpl(playback, v)} />
                  {/if}
                  <ChipDropdown
                    label={`${playback.playbackSpeed}x`}
                    options={speedChipOptions}
                    activeValue={String(playback.playbackSpeed)}
                    ariaLabel={i18n.t('playback.speed')}
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
                seekLabel={i18n.t('playback.seek')}
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
              editorAriaLabel={i18n.t('editor.label')}
              containerClass="min-h-0 flex-1"
              editorClass="h-full" />
          </div>

          {#if showMetadata}
            <MetadataPanel
              metadata={metadata}
              playback={playback}
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
    <BaseDialog title={i18n.t('dialogs.overwriteTitle')} maxWidth="md" closeLabel={i18n.t('close')} onCancel={editor.cancelOverwrite}>
      <div class="flex flex-col gap-4">
        <p class="text-sm leading-6 text-slate-400">{i18n.t('dialogs.overwriteMessage')}</p>
        <Buttons align="right">
          <Button variant="primary" accent="rose" onClick={editor.applyOverwrite}>{i18n.t('documents.save')}</Button>
        </Buttons>
      </div>
    </BaseDialog>
  {/if}

  {#if editor.discardDialogOpen}
    <BaseDialog title={i18n.t('dialogs.discardTitle')} maxWidth="md" closeLabel={i18n.t('close')} onCancel={editor.cancelDiscard}>
      <div class="flex flex-col gap-4">
        <p class="text-sm leading-6 text-slate-400">{i18n.t('dialogs.discardMessage')}</p>
        <Buttons align="right">
          <Button variant="primary" accent="rose" onClick={editor.confirmDiscard}>{i18n.t('dialogs.discardConfirm')}</Button>
        </Buttons>
      </div>
    </BaseDialog>
  {/if}

  {#if editor.deleteDialogOpen}
    <BaseDialog title={i18n.t('dialogs.deleteConfirmTitle')} maxWidth="md" closeLabel={i18n.t('close')} onCancel={editor.cancelDelete}>
      <div class="flex flex-col gap-4">
        <div class="flex min-w-0 flex-col gap-1">
          <p class="truncate text-sm font-medium text-slate-100">{editor.deleteTargetName}</p>
          <p class="text-sm leading-6 text-slate-400">{i18n.t('dialogs.deleteConfirmMessage')}</p>
        </div>
        <Buttons align="right">
          <Button variant="primary" accent="rose" onClick={editor.confirmDelete}>{i18n.t('documents.delete')}</Button>
        </Buttons>
      </div>
    </BaseDialog>
  {/if}

  {#if editor.playbackConfirmOpen}
    <BaseDialog title={i18n.t('dialogs.stopPlaybackTitle')} maxWidth="md" closeLabel={i18n.t('close')} onCancel={editor.cancelPlayback}>
      <div class="flex flex-col gap-4">
        <p class="text-sm leading-6 text-slate-400">{i18n.t('dialogs.stopPlaybackMessage')}</p>
        <Buttons align="right">
          <Button variant="primary" accent="rose" onClick={editor.confirmPlayback}>{i18n.t('dialogs.stopPlaybackConfirm')}</Button>
        </Buttons>
      </div>
    </BaseDialog>
  {/if}

  {#if accountOpen && data?.user}
    <BaseDialog title={i18n.t('auth.account')} maxWidth="md" closeLabel={i18n.t('close')} onCancel={() => (accountOpen = false)}>
      <div class="flex flex-col gap-4">
        <p class="truncate text-sm font-medium text-slate-100">{data.user.username}</p>
        {#if accountError}
          <p class="text-sm text-rose-400">{accountError}</p>
        {/if}
        <Buttons align="right">
          <Button variant="primary" accent="rose" pending={accountPending} onClick={() => void handleAccountLogout()}>{i18n.t('auth.signOut.label')}</Button>
        </Buttons>
      </div>
    </BaseDialog>
  {/if}

  {#if loginOpen}
    <BaseDialog
      title={loginMode === 'signin' ? i18n.t('auth.login') : i18n.t('auth.createAccount.title')}
      maxWidth="md"
      closeLabel={i18n.t('close')}
      onCancel={closeLoginDialog}>
      <UserAuthPanel embedded bind:mode={loginMode} onsuccess={closeLoginDialog} />
    </BaseDialog>
  {/if}

  {#if showSessionToast}
    <Toast
      message={i18n.t('documents.sessionExpired')}
      closeLabel={i18n.t('close')}
      actionLabel={i18n.t('auth.login')}
      onAction={handleLoginClick}
      position="top-center"
      type="warning"
      onClose={() => (sessionToastDismissed = true)} />
  {/if}
</div>
