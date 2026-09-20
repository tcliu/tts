<script lang="ts">
  import type { Snippet } from 'svelte'
  import { onMount } from 'svelte'
  import { slide } from 'svelte/transition'
  import { getI18nContext } from '$lib/i18n.svelte'
  import {
    APP_SHELL_DEFAULT_WIDTH,
    APP_SHELL_MAX_WIDTH,
    APP_SHELL_MIN_WIDTH,
    APP_SHELL_RAIL_WIDTH,
    clampPaneWidth,
    collapsesToRail,
    loadPaneSize,
    savePaneSize,
    type AppShellCollapseMode,
  } from '$lib/app-shell'
  import Button from '$lib/components/Button.svelte'
  import Splitter from '$lib/components/Splitter.svelte'
  import MenuIcon from '$lib/icons/MenuIcon.svelte'

  interface Props {
    open?: boolean
    paneSize?: number
    collapseMode?: AppShellCollapseMode
    railWidth?: number
    min?: number
    max?: number
    defaultSize?: number
    storageKey?: string
    showToggle?: boolean
    toggleShowLabel?: string
    toggleHideLabel?: string
    resizeLabel?: string
    headerClassName?: string
    paneClassName?: string
    mainClassName?: string
    splitterClassName?: string
    onOpenChange?: (open: boolean) => void
    onPaneChange?: (size: number) => void
    onDragEnd?: () => void
    headerLeft?: Snippet
    headerRight?: Snippet
    leftPane?: Snippet
    children?: Snippet
  }

  let {
    open = $bindable(true),
    paneSize = $bindable(APP_SHELL_DEFAULT_WIDTH),
    collapseMode = 'hide',
    railWidth = APP_SHELL_RAIL_WIDTH,
    min = APP_SHELL_MIN_WIDTH,
    max = APP_SHELL_MAX_WIDTH,
    defaultSize = APP_SHELL_DEFAULT_WIDTH,
    storageKey = undefined,
    showToggle = true,
    toggleShowLabel = undefined,
    toggleHideLabel = undefined,
    resizeLabel = undefined,
    headerClassName = '',
    paneClassName = '',
    mainClassName = '',
    splitterClassName = '',
    onOpenChange = undefined,
    onPaneChange = undefined,
    onDragEnd = undefined,
    headerLeft = undefined,
    headerRight = undefined,
    leftPane = undefined,
    children = undefined,
  }: Props = $props()

  const i18n = getI18nContext()

  const showLabel = $derived(toggleShowLabel ?? i18n.t('appShell.showPane'))
  const hideLabel = $derived(toggleHideLabel ?? i18n.t('appShell.hidePane'))
  const toggleLabel = $derived(open ? hideLabel : showLabel)
  const resolvedResizeLabel = $derived(resizeLabel ?? i18n.t('appShell.resize'))

  // The slide axis follows the pane direction (side pane on desktop, top pane
  // on mobile) and collapses to an instant show/hide under reduced motion.
  // Layout stays CSS-driven; this only tunes the transition.
  let reduceMotion = $state(false)
  let desktopLayout = $state(true)
  onMount(() => {
    if (storageKey) {
      const loaded = loadPaneSize(storageKey, defaultSize, min, max)
      if (loaded !== paneSize) {
        paneSize = loaded
      }
    }
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const wideQuery = window.matchMedia('(min-width: 48rem)')
    const syncMotion = () => {
      reduceMotion = motionQuery.matches
    }
    const syncLayout = () => {
      desktopLayout = wideQuery.matches
    }
    syncMotion()
    syncLayout()
    motionQuery.addEventListener('change', syncMotion)
    wideQuery.addEventListener('change', syncLayout)
    return () => {
      motionQuery.removeEventListener('change', syncMotion)
      wideQuery.removeEventListener('change', syncLayout)
    }
  })
  const slideParams = $derived({ axis: desktopLayout ? 'x' : 'y', duration: reduceMotion ? 0 : 200 } as const)

  const paneVisible = $derived(open || collapseMode === 'rail')
  const effectiveSize = $derived(open ? paneSize : railWidth)
  const splitterMin = $derived(collapseMode === 'rail' ? railWidth : min)

  function setOpen(next: boolean) {
    open = next
    onOpenChange?.(next)
  }

  function handlePaneChange(next: number) {
    if (collapseMode === 'rail' && collapsesToRail(next, railWidth)) {
      paneSize = defaultSize
      onPaneChange?.(paneSize)
      setOpen(false)
      return
    }
    paneSize = clampPaneWidth(next, min, max, defaultSize)
    onPaneChange?.(paneSize)
  }

  function handleDragEnd() {
    savePaneSize(storageKey, paneSize)
    onDragEnd?.()
  }
</script>

<header
  class={`flex flex-none items-center justify-between gap-4 border-b border-slate-800 px-3 py-3 sm:px-4 ${headerClassName}`}>
  <div class="flex items-center gap-2">
    {#if showToggle}
      <Button
        variant="secondary"
        size="sm"
        className="-ml-1"
        ariaLabel={toggleLabel}
        ariaExpanded={open}
        tooltip={toggleLabel}
        tooltipAlign="left"
        preventFocusSteal
        onClick={() => setOpen(!open)}>
        {#snippet icon()}
          <MenuIcon className="h-4 w-4" />
        {/snippet}
      </Button>
    {/if}
    {@render headerLeft?.()}
  </div>
  <div class="flex items-center gap-2">
    {@render headerRight?.()}
  </div>
</header>
<div class="flex min-h-0 flex-1 flex-col md:flex-row">
  {#if paneVisible}
    <div in:slide={slideParams} out:slide={slideParams} class="flex min-h-0 flex-col md:flex-row">
      <aside
        class={`flex min-h-0 flex-col gap-2 border-b border-slate-800 md:shrink-0 md:border-b-0 md:border-r ${paneClassName}`}
        style={`flex-basis: ${effectiveSize}px`}
        tabindex="-1">
        {@render leftPane?.()}
      </aside>

      <Splitter
        orientation="vertical"
        className={`hidden md:block ${splitterClassName}`}
        value={effectiveSize}
        min={splitterMin}
        max={max}
        ariaLabel={resolvedResizeLabel}
        onChange={handlePaneChange}
        onDragEnd={handleDragEnd} />
      <Splitter
        orientation="horizontal"
        className={`md:hidden ${splitterClassName}`}
        value={effectiveSize}
        min={splitterMin}
        max={max}
        ariaLabel={resolvedResizeLabel}
        onChange={handlePaneChange}
        onDragEnd={handleDragEnd} />
    </div>
  {/if}

  <main tabindex="-1" class={`min-h-0 min-w-0 flex-1 overflow-y-auto outline-none ${mainClassName}`}>
    {@render children?.()}
  </main>
</div>
