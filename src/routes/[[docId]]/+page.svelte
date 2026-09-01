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
  import Menu from '$lib/components/Menu.svelte'
  import GlobeIcon from '$lib/icons/GlobeIcon.svelte'
  import SunIcon from '$lib/icons/SunIcon.svelte'
  import MoonIcon from '$lib/icons/MoonIcon.svelte'
  import FireIcon from '$lib/icons/FireIcon.svelte'
  import LightBulbIcon from '$lib/icons/LightBulbIcon.svelte'
  import SparklesIcon from '$lib/icons/SparklesIcon.svelte'
  import CloudIcon from '$lib/icons/CloudIcon.svelte'
  import ForestIcon from '$lib/icons/ForestIcon.svelte'
  import MidnightIcon from '$lib/icons/MidnightIcon.svelte'
  import MintIcon from '$lib/icons/MintIcon.svelte'
  import LavenderIcon from '$lib/icons/LavenderIcon.svelte'
  import PaletteIcon from '$lib/icons/PaletteIcon.svelte'
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
  import { REFERENCE_LANGUAGES, SPEED_OPTIONS, splitTtsSegments } from '$lib/tts-reference'
  import { synthesisCacheKey } from '$lib/tts-cache-key'
  import { isScopeInvalidatedByClearedKeys } from '$lib/tts-cache-clear'
  import ChipDropdown from '$lib/components/ChipDropdown.svelte'
  import {
    clearSynthesisCache,
    clearSynthesisCacheEntries,
    clearDocumentSynthesisCache,
    getSynthesisCacheEntries,
    getSynthesisCacheStats,
    peekCachedSynthesis,
    type SynthesisCacheEntry,
    type SynthesisCacheStats,
  } from '$lib/tts-client'
  import { usePlayback, type CodeEditorHandle } from '$lib/use-playback.svelte'
  import { useMetadata, RESYNC_DEBOUNCE_MS } from '$lib/use-metadata.svelte'
  import PlaybackSlider from '$lib/components/PlaybackSlider.svelte'
  import MetadataPanel from '$lib/components/MetadataPanel.svelte'
  import { useSettings, type UiTheme } from '$lib/use-settings.svelte'
  import { useDocuments } from '$lib/use-documents.svelte'
  import { useDocumentEditor } from '$lib/use-document-editor.svelte'
  import { useDocumentsDrawer } from '$lib/use-documents-drawer.svelte'

  const settings = useSettings()
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

  // Client-side synthesis cache facts for the Settings dialog; null until the
  // first IndexedDB scan for the currently open dialog lands.
  let cacheStats = $state<SynthesisCacheStats | null>(null)
  let cacheDialogOpen = $state(false)
  let cacheDialogLoading = $state(false)
  let cacheEntries = $state<SynthesisCacheEntry[]>([])

  $effect(() => {
    if (!settingsOpen) return
    let current = true
    void getSynthesisCacheStats().then(stats => {
      if (current) cacheStats = stats
    })
    return () => {
      current = false
    }
  })

  function currentScopeSegment(segments?: ReturnType<typeof splitTtsSegments>) {
    const content = settings.content
    if (!content.trim()) return null
    const playbackSegment = playback.currentSessionSegment
    if (playbackSegment) {
      return playbackSegment
    }
    const resolvedSegments = segments ?? splitTtsSegments(content)
    const caret =
      editorRef?.getCaretPosition?.() ?? editorRef?.getSelectionRange?.()?.from ?? null
    if (caret == null) return null
    return resolvedSegments.find(seg => caret >= seg.indexStart && caret <= seg.indexEnd) ?? null
  }

  function currentScopeInvalidatedByClearedKeys(
    clearedKeys: string[],
    entries = cacheEntries,
    segments?: ReturnType<typeof splitTtsSegments>,
  ): boolean {
    const scope = currentScopeSegment(segments)
    return isScopeInvalidatedByClearedKeys(scope, clearedKeys, entries, {
      resolveVoiceEdge: lang => playback.effectiveVoiceEdge(lang),
    })
  }

  async function clearClientSynthesisCache() {
    const content = settings.content
    let shouldReset = false
    if (content.trim()) {
      if (playback.hasSession || playback.synthesizedCount > 0) {
        shouldReset = true
      } else {
        const segments = splitTtsSegments(content)
        shouldReset = segments.some(seg => {
          const voiceEdge = settings.resolveVoiceForSegment(seg.lang)?.edge
          if (!voiceEdge) return false
          return !!peekCachedSynthesis(seg.text, voiceEdge)
        })
        if (!shouldReset) {
          const snapshot = cacheEntries.length ? cacheEntries : await getSynthesisCacheEntries()
          if (snapshot.length > 0) {
            const allKeys = snapshot.map(entry => entry.key)
            shouldReset = currentScopeInvalidatedByClearedKeys(allKeys, snapshot, segments)
          }
        }
      }
    }
    await clearSynthesisCache()
    cacheStats = { segments: 0, bytes: 0 }
    cacheEntries = []
    if (shouldReset) playback.resetSession()
  }

  async function loadCacheEntries() {
    cacheDialogLoading = true
    try {
      cacheEntries = await getSynthesisCacheEntries()
    } finally {
      cacheDialogLoading = false
    }
  }

  async function openCacheDialog() {
    cacheDialogOpen = true
    await loadCacheEntries()
  }

  async function clearSelectedCacheEntries(keys: string[]) {
    const shouldReset = keys.length > 0 && currentScopeInvalidatedByClearedKeys(keys)
    await clearSynthesisCacheEntries(keys)
    const nextEntries = cacheEntries.filter(entry => !keys.includes(entry.key))
    cacheEntries = nextEntries
    cacheStats = {
      segments: nextEntries.length,
      bytes: nextEntries.reduce((total, entry) => total + entry.bytes, 0),
    }
    if (shouldReset) playback.resetSession()
  }

  // Cache keys for every segment of the current document that has a voice.
  // Synthesis is cached at the canonical 1x rate and reused across playback
  // speeds, so document eviction only needs one key per text+voice pair.
  function documentSynthesisCacheKeys(): string[] {
    const content = settings.content
    if (!content.trim()) return []
    return splitTtsSegments(content).flatMap(segment => {
      const voice = settings.resolveVoiceForSegment(segment.lang)
      return voice?.edge ? [synthesisCacheKey(segment.text, voice.edge)] : []
    })
  }

  function resetPlaybackAndCache() {
    const keys = documentSynthesisCacheKeys()
    playback.resetSession()
    void clearDocumentSynthesisCache(editor.cacheScopeId, keys)
  }

  const THEME_MENU_OPTIONS: { value: UiTheme }[] = [
    { value: 'dark' },
    { value: 'ember' },
    { value: 'forest' },
    { value: 'midnight' },
    { value: 'nebula' },
    { value: 'light' },
    { value: 'mint' },
    { value: 'sepia' },
    { value: 'lavender' },
    { value: 'sky' },
  ]

  const THEME_ICONS: Record<UiTheme, typeof MoonIcon> = {
    dark: MoonIcon,
    ember: FireIcon,
    forest: ForestIcon,
    midnight: MidnightIcon,
    nebula: SparklesIcon,
    light: SunIcon,
    mint: MintIcon,
    sepia: LightBulbIcon,
    lavender: LavenderIcon,
    sky: CloudIcon,
  }

  let fileInputRef = $state<HTMLInputElement | null>(null)

  let uploadDragActive = $state(false)

  let headerRef = $state<HTMLElement | null>(null)
  let drawerButtonRef = $state<HTMLButtonElement | null>(null)
  let drawerPanelRef = $state<HTMLElement | null>(null)
  let drawerSearchRef = $state<HTMLInputElement | null>(null)

  let editorRef = $state<CodeEditorHandle | null>(null)

  const text = $derived(UI_TEXT[settings.locale])

  const themeLabels = $derived<Record<UiTheme, string>>({
    dark: text.themeDark,
    ember: text.themeEmber,
    forest: text.themeForest,
    midnight: text.themeMidnight,
    nebula: text.themeNebula,
    light: text.themeLight,
    mint: text.themeMint,
    sepia: text.themeSepia,
    lavender: text.themeLavender,
    sky: text.themeSky,
  })

  const themeOptions = $derived(
    THEME_MENU_OPTIONS.map(option => ({ value: option.value, label: themeLabels[option.value], icon: THEME_ICONS[option.value] })),
  )

  // Written-only: spoken variants collapse (yue/Cantonese -> zh/Chinese,
  // en-GB/en-US -> en/English). Voice models for each spoken variant stay
  // as groups under the written language (e.g. zh groups Mandarin/Cantonese/Taiwanese).
  const chipLangOptions = $derived(
    REFERENCE_LANGUAGES.map(lang => ({
      value: lang.code,
      label: `${segmentLanguageName(settings.locale, lang.code)} · ${lang.code}`,
    })),
  )

  const writtenLabel = $derived.by(() => {
    const code = playback.positionLanguageCode
    return code ? segmentLanguageName(settings.locale, code) : ''
  })

  const voiceChipOptions = $derived.by(() => {
    const code = playback.positionLanguageCode
    if (!code) return []
    const lang = REFERENCE_LANGUAGES.find(item => item.code === code)
    if (!lang) return []
    return lang.voices
  })

  const chipVoiceOptions = $derived(
    voiceChipOptions.map(voice => ({ value: voice.edge, label: chipVoiceLabel(voice) })),
  )

  const activeChipVoiceEdge = $derived(playback.positionVoiceEdge)

  function chipVoiceLabel(voice: { name: string; gender: string; edge: string; group?: string }): string {
    const locale = voice.edge.split('-').slice(0, 2).join('-')
    const base = `${voice.name} · ${voice.gender} · ${locale}`
    return voice.group ? `${base} · ${voice.group}` : base
  }

  async function handleLangChipSelect(code: string) {
    const idx = playback.positionSegmentIndex
    if (idx < 0) return
    try {
      await playback.overrideSegmentLanguage(idx, code)
    } catch (error) {
      console.error(error)
    }
  }

  async function handleVoiceChipSelect(edge: string) {
    const idx = playback.positionSegmentIndex
    if (idx < 0) return
    // Switching the voice model during playback only overrides the active
    // session; the persisted default voice setting is left untouched.
    try {
      await playback.overrideSegmentVoice(idx, edge)
    } catch (error) {
      console.error(error)
    }
  }

  const speedChipOptions = $derived(SPEED_OPTIONS)

  function handleSpeedChipSelect(value: string) {
    const next = Number(value)
    if (!Number.isFinite(next)) return
    playback.setPlaybackSpeed(next)
  }

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
  const playbackSliderMax = $derived(Math.max(playback.totalDuration, playback.totalElapsed, 0))
  const playbackSliderValue = $derived(
    playback.isPlaybackEnded ? playback.totalDuration : Math.min(playback.totalElapsed, playbackSliderMax),
  )
  let playbackSliderDraft = $state<string | null>(null)
  const playbackSliderDisplayValue = $derived(
    playbackSliderDraft === null ? playbackSliderValue : Number(playbackSliderDraft),
  )
  const playbackSliderProgress = $derived(
    playbackSliderMax > 0
      ? Math.min(100, Math.max(0, (playbackSliderDisplayValue / playbackSliderMax) * 100))
      : 0,
  )

  function handlePlaybackSliderInput(event: Event) {
    const target = event.currentTarget
    if (!(target instanceof HTMLInputElement)) {
      return
    }
    playbackSliderDraft = target.value
  }

  async function commitPlaybackSlider(event: Event) {
    const target = event.currentTarget
    if (!(target instanceof HTMLInputElement)) {
      playbackSliderDraft = null
      return
    }
    playbackSliderDraft = null
    await playback.seekTo(Number(target.value))
  }

  function isEditableActiveElement(el: Element | null): boolean {
    if (!el) return false
    if (el.tagName === 'TEXTAREA') return true
    if (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range') return true
    if ((el as HTMLElement).isContentEditable) return true
    return false
  }

  function handlePlaybackArrowKey(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    if (editorRef?.hasFocus?.()) return
    if (isEditableActiveElement(document.activeElement)) return
    if (dialogsOpen()) return
    if (drawerPanelRef?.contains(document.activeElement)) return
    if (playback.synthesizedCount === 0 || playbackSliderMax <= 0) return
    event.preventDefault()
    const step = playbackSliderMax * 0.05
    const delta = event.key === 'ArrowRight' ? step : -step
    const next = Math.min(playbackSliderMax, Math.max(0, playback.totalElapsed + delta))
    void playback.seekTo(next)
  }

  // Overflow-menu contents per band, derived from the single-source ladder so
  // band boundaries and menu contents cannot drift apart. Index parallels
  // TOOLBAR_BANDS; the last entry is empty because every action is inline.
  const toolbarMode: ToolbarMode = $derived(editor.currentDocId ? 'doc' : 'fresh')
  const toolbarMenus = $derived(TOOLBAR_BANDS.map(band => menuFor(band.name, toolbarMode)))
  const overlayDrawerOpen = $derived(!isDocked && drawer.drawerOpen)
  const drawerVisible = $derived(isDocked ? dockedDrawerOpen : drawer.drawerOpen)
  // Plain locals, not $state: writing them from inside the effect must not
  // re-trigger the effect (a $state write here would rerun the effect, whose
  // cleanup would cancel the pending debounced warm-up below).
  let lastPlaybackContent: string | null = null
  let lastWarmedDocId: string | null | undefined = undefined

  function panelActionDisabled(action: PanelAction): boolean {
    if (action === 'play') {
      return playback.isPlaying ? false : !settings.canPlay
    }
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

  let warmTimer: ReturnType<typeof setTimeout> | null = null
  $effect(() => {
    const content = settings.content
    const docId = editor.currentDocId ?? null
    if (content === lastPlaybackContent && docId === lastWarmedDocId) {
      return
    }
    const isOpening = docId !== lastWarmedDocId || lastPlaybackContent === null
    lastPlaybackContent = content
    lastWarmedDocId = docId
    if (isOpening) {
      // Doc open or switch: surface cached synthesis in the same flush so the
      // status strip shows instantly. Uncached synthesis stays deferred to Play.
      if (warmTimer) clearTimeout(warmTimer)
      playback.warmFromCache()
      return
    }
    // Same-document edit: debounce the warm-up so a full-document re-segment
    // plus per-segment cache scan does not run on every keystroke; shares the
    // metadata module's RESYNC_DEBOUNCE_MS cadence.
    if (warmTimer) clearTimeout(warmTimer)
    warmTimer = setTimeout(() => playback.warmFromCache(), RESYNC_DEBOUNCE_MS)
    return () => {
      if (warmTimer) clearTimeout(warmTimer)
    }
  })

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

  function handlePanelAction(action: PanelAction) {
    if (action === 'play') {
      if (playback.isPlaying) {
        playback.stopPlayback()
      } else {
        playback.startPlayback()
      }
    } else if (action === 'reset') {
      editor.resetEditor()
    } else if (action === 'save') {
      editor.saveDocument()
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
    return settingsOpen || editor.overwriteConfirmOpen || editor.discardDialogOpen || editor.deleteDialogOpen || editor.playbackConfirmOpen
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

  $effect(() => {
    function handleGlobalKeydown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
        return
      }
      if (event.key.toLowerCase() !== 's') {
        return
      }
      event.preventDefault()
      if (dialogsOpen()) {
        return
      }
      editor.saveDocument()
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
  <title>{text.appTitle}</title>
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
        ariaLabel={text.documents}
        ariaExpanded={drawerVisible}
        tooltip={text.documents}
        onClick={toggleDrawer}>
        {#snippet icon()}
          <MenuIcon className="h-4 w-4" />
        {/snippet}
      </Button>
      <h1 class="text-base font-semibold tracking-tight sm:text-lg">{text.appShortTitle}</h1>
    </div>
    <div class="flex items-center gap-2">
      <Menu
        items={UI_LANGUAGE_OPTIONS}
        itemKey={option => option.value}
        ariaLabel={text.language}
        triggerTooltip={text.language}
        align="right"
        autoPlace={true}
        triggerClass="p-1.5 relative before:absolute before:-inset-1.5 before:content-['']"
        itemRole="menuitemradio"
        itemChecked={option => option.value === settings.locale}
        itemClass={(option, state) =>
          `flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm outline-none transition motion-reduce:transition-none ${
            state.disabled
              ? 'cursor-not-allowed text-slate-600'
              : state.active
                ? 'bg-slate-800 text-cyan-200'
                : option.value === settings.locale
                  ? 'bg-cyan-500/15 text-cyan-200'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-cyan-200 focus:bg-slate-800 focus:text-cyan-200'
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
        ariaLabel={text.theme}
        triggerTooltip={text.theme}
        align="right"
        autoPlace={true}
        triggerClass="p-1.5 relative before:absolute before:-inset-1.5 before:content-['']"
        itemRole="menuitemradio"
        itemChecked={option => option.value === settings.theme}
        itemClass={(option, state) =>
          `flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm outline-none transition motion-reduce:transition-none ${
            state.disabled
              ? 'cursor-not-allowed text-slate-600'
              : state.active
                ? 'bg-slate-800 text-cyan-200'
                : option.value === settings.theme
                  ? 'bg-cyan-500/15 text-cyan-200'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-cyan-200 focus:bg-slate-800 focus:text-cyan-200'
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
      <Button variant="secondary" size="sm" ariaLabel={text.settings} tooltip={text.settings} onClick={() => (settingsOpen = true)}>
        {#snippet icon()}
          <SettingsIcon className="h-4 w-4" />
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
      onNew={editor.requestNewDocument}
      onOpen={editor.requestOpenDocument}
      onClose={dismissDrawerAndFocusTrigger} />

    <main class="flex min-w-0 flex-1 flex-col gap-2 px-3 py-2 sm:px-4 sm:py-2">
      <div class="flex flex-none min-w-0 items-center">
        <EditableText locale={settings.locale} text={editor.currentDocName} onChange={editor.renameDocument} size="lg" maxWidth={480} />
      </div>
      <section aria-label={text.playbackControls} class="@container flex flex-none flex-wrap items-center gap-1.5">
      <span class={REVEAL_CLASS.play}>
        <Button
          variant="outline"
          accent="cyan"
          size="sm"
          ariaPressed={playback.isPlaying}
          disabled={playback.voiceSwitching || (playback.isPlaying ? false : !settings.canPlay)}
          ariaLabel={playback.isPlaying ? text.stop : text.playback}
          onClick={playback.isPlaying ? playback.stopPlayback : playback.startPlayback}>
          {#snippet icon()}
            {#if playback.isPlaying}
              <StopIcon className="h-4 w-4" />
            {:else}
              <SpeakerIcon className="h-4 w-4" />
            {/if}
          {/snippet}
          {playback.isPlaying ? text.stop : text.playback}
        </Button>
      </span>

      <span class={REVEAL_CLASS.reset}>
        <Button
          variant="secondary"
          size="sm"
          disabled={editor.currentDocId ? !editor.isDirty : !settings.canPlay}
          ariaLabel={text.reset}
          onClick={editor.resetEditor}>
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
          onClick={editor.saveDocument}>
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
          onClick={() => void editor.copyEditorContent()}
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
            onClick={() => {
              if (editor.currentDocId) {
                editor.requestDeleteDocument(editor.currentDocId)
              }
            }}>
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
          onClick={() => (showMetadata = !showMetadata)}>
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
            onClick={editor.requestCloneDocument}>
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
        <Button variant="secondary" size="sm" ariaLabel={text.upload} onClick={editor.requestUpload}>
          {#snippet icon()}
            <UploadIcon className="h-4 w-4" />
          {/snippet}
          {text.upload}
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
              labels={{ play: playback.isPlaying ? text.stop : text.playback }} />
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
                    ariaLabel={text.segmentLanguage}
                    variant="sky"
                    filterable
                    filterPlaceholder={text.languageSearch}
                    emptyText={text.noMatchingLanguages}
                    disabled={playback.isPlaying}
                    onSelect={(v) => void handleLangChipSelect(v)} />
                  {#if playback.positionVoiceName}
                    <span class="inline-flex max-w-full items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-200">
                      <span class="truncate">{playback.positionVoiceLocale}</span>
                    </span>
                    <span class="inline-flex max-w-full items-center rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-0.5 text-xs font-medium text-fuchsia-200">
                      <span class="truncate">{playback.positionVoiceGender}</span>
                    </span>
                    <ChipDropdown
                      label={playback.positionVoiceName}
                      options={chipVoiceOptions}
                      activeValue={activeChipVoiceEdge}
                      ariaLabel={text.voiceModel}
                      variant="violet"
                      filterable
                      filterPlaceholder={text.voiceSearch}
                      emptyText={text.noMatchingVoices}
                      disabled={voiceChipOptions.length === 0}
                      onSelect={(v) => void handleVoiceChipSelect(v)} />
                  {/if}
                  <ChipDropdown
                    label={`${playback.playbackSpeed}x`}
                    options={speedChipOptions}
                    activeValue={String(playback.playbackSpeed)}
                    ariaLabel={text.playbackSpeed}
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
                displayValue={playbackSliderDisplayValue}
                totalDuration={playback.totalDuration}
                max={playbackSliderMax}
                progress={playbackSliderProgress}
                disabled={playbackSliderMax <= 0}
                seekLabel={text.seek}
                onInput={handlePlaybackSliderInput}
                onCommit={commitPlaybackSlider} />
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
              autoFocus={true}
              editorAriaLabel={text.editorLabel}
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
              onResetCache={resetPlaybackAndCache} />
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
        cacheStats={cacheStats}
        onCancel={() => (settingsOpen = false)}
        onSelectVoice={settings.selectVoice}
        onSelectGroup={settings.selectGroup}
        onSelectSpeed={settings.setSpeed}
        onSelectConcurrent={settings.setSynthesisConcurrency}
        onClearCache={() => void clearClientSynthesisCache()}
        onViewCache={() => void openCacheDialog()} />
    {:catch}
      <!-- Chunk load failed; drop the dialog instead of leaving an unhandled rejection. -->
      {settingsOpen = false}
    {/await}
  {/if}

  {#if cacheDialogOpen}
    {#await import('$lib/components/SynthesisCacheDialog.svelte') then { default: SynthesisCacheDialog }}
      <SynthesisCacheDialog
        locale={settings.locale}
        entries={cacheEntries}
        loading={cacheDialogLoading}
        onCancel={() => (cacheDialogOpen = false)}
        onClearSelected={clearSelectedCacheEntries}
        onBeforePlay={() => playback.stopPlayback()} />
    {:catch}
      <!-- Chunk load failed; drop the dialog instead of leaving an unhandled rejection. -->
      {cacheDialogOpen = false}
    {/await}
  {/if}

  {#if editor.overwriteConfirmOpen}
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

  {#if editor.playbackConfirmOpen}
    <BaseDialog title={text.stopPlaybackTitle} maxWidth="md" closeLabel={text.close} onCancel={editor.cancelPlayback}>
      <div class="flex flex-col gap-4">
        <p class="text-sm leading-6 text-slate-400">{text.stopPlaybackMessage}</p>
        <div class="flex flex-wrap items-center justify-end gap-3">
          <Button variant="primary" accent="rose" onClick={editor.confirmPlayback}>{text.stopPlaybackConfirm}</Button>
        </div>
      </div>
    </BaseDialog>
  {/if}
</div>
