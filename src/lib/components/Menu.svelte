<script module lang="ts">
  import type { Snippet } from 'svelte'

  export interface MenuItemState {
    index: number
    active: boolean
    disabled: boolean
  }
</script>

<script lang="ts" generics="T">
  // Menu owns the icon-trigger dropdown (desktop popover, phone bottom sheet).
  // Phase 2: cut SelectOverlay over to Menu + positionPanel so all dropdown
  // chrome converges here instead of a parallel overlay.
  import { onMount, flushSync, tick } from 'svelte'
  import { positionPanel } from '$lib/position-panel.svelte'
  import { createFocusoutClose } from '$lib/actions/use-focusout-close'
  import { useDropdown } from '$lib/actions/use-dropdown.svelte'
  import { useListSelection } from '$lib/actions/use-list-selection.svelte'
  import { dragCloseDown } from '$lib/actions/drag-close-down'
  import { PHONE_SHEET_QUERY, type DropdownPanelProps } from '$lib/dropdown-chrome'
  import CloseIcon from '$lib/icons/CloseIcon.svelte'
  import Tooltip from './Tooltip.svelte'

  interface MenuBaseProps extends DropdownPanelProps {
    items: T[]
    itemKey: (item: T) => string
    onSelect: (index: number) => void
    icon: Snippet
    item: Snippet<[T, MenuItemState]>
    ariaLabel: string
    triggerClass?: string
    triggerTooltip?: string
    triggerTooltipAlign?: 'center' | 'left' | 'right'
    itemClass?: (item: T, state: MenuItemState) => string
    itemRole?: 'menuitem' | 'menuitemradio'
    itemChecked?: (item: T) => boolean
    itemDisabled?: (item: T) => boolean
  }

  // A sheet title opts into the phone bottom-sheet presentation and must
  // carry its own close label so the dismiss button is never announced with
  // the menu's name by accident.
  type Props = MenuBaseProps & ({ phoneSheetTitle?: undefined; closeLabel?: string } | { phoneSheetTitle: string; closeLabel: string })

  let {
    items,
    itemKey,
    onSelect,
    icon,
    item,
    ariaLabel,
    align = 'right',
    autoPlace = true,
    triggerClass = '',
    triggerTooltip,
    triggerTooltipAlign = 'center',
    panelClass = '',
    itemClass,
    itemRole = 'menuitem',
    itemChecked,
    itemDisabled = () => false,
    phoneSheetTitle,
    closeLabel,
  }: Props = $props()

  let uid = $props.id()
  const menuId = $derived(`menu-${uid}`)
  const sheetTitleId = $derived(`${menuId}-title`)
  // closeLabel is required alongside phoneSheetTitle (see Props); the
  // fallback only serves plain menus, which never render the sheet branch.
  // Derived (not a plain const) so locale switches re-resolve the label.
  const sheetCloseLabel = $derived(closeLabel ?? ariaLabel)

  let open = $state(false)
  const selection = useListSelection()
  let containerRef = $state<HTMLDivElement | null>(null)
  let triggerRef = $state<HTMLButtonElement | null>(null)
  let tooltipTriggerEl = $state<HTMLElement | null>(null)
  let overlayRef = $state<HTMLDivElement | null>(null)
  let panelRef = $state<HTMLDivElement | null>(null)
  let dialogRef = $state<HTMLDivElement | null>(null)
  let itemRefs = $state<HTMLButtonElement[]>([])
  let isPhoneViewport = $state(false)
  let sheetDragOffset = $state(0)
  let sheetDragging = $state(false)
  let reduceMotion = $state(false)

  // isPhoneViewport only resolves via matchMedia after mount, so phones first
  // paint the popover branch before swapping to the sheet — accepted flash,
  // the cheapest stable option (no SSR viewport guess, no forced sheet).
  const usePhoneSheet = $derived(phoneSheetTitle !== undefined && isPhoneViewport)

  onMount(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const viewportQuery = window.matchMedia(PHONE_SHEET_QUERY)
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncViewport = () => {
      isPhoneViewport = viewportQuery.matches
    }
    const syncMotion = () => {
      reduceMotion = motionQuery.matches
    }
    syncViewport()
    syncMotion()
    viewportQuery.addEventListener('change', syncViewport)
    motionQuery.addEventListener('change', syncMotion)
    return () => {
      viewportQuery.removeEventListener('change', syncViewport)
      motionQuery.removeEventListener('change', syncMotion)
    }
  })

  function isDisabled(item: T): boolean {
    return itemDisabled(item)
  }

  function close(returnFocus = true) {
    open = false
    sheetDragOffset = 0
    sheetDragging = false
    if (returnFocus) {
      triggerRef?.focus()
    }
  }

  function openWithSelection(index: number) {
    selection.set(index >= 0 ? index : 0)
    open = true
  }

  function toggle() {
    if (open) {
      close(false)
      return
    }
    openWithSelection(initialActiveIndex())
  }

  function openFromTrigger(direction: 'down' | 'up') {
    if (open) {
      moveFocus(direction)
      return
    }
    flushSync(() => {
      openWithSelection(direction === 'up' ? lastEnabledIndex() : initialActiveIndex())
    })
  }

  function firstEnabledIndex(): number {
    return items.findIndex(item => !isDisabled(item))
  }

  function lastEnabledIndex(): number {
    for (let i = items.length - 1; i >= 0; i--) {
      if (!isDisabled(items[i])) return i
    }
    return -1
  }

  function initialActiveIndex(): number {
    if (itemRole === 'menuitemradio' && itemChecked) {
      const checkedIndex = items.findIndex(item => itemChecked(item) && !isDisabled(item))
      if (checkedIndex >= 0) return checkedIndex
    }
    const fallback = firstEnabledIndex()
    return fallback >= 0 ? fallback : 0
  }

  function moveFocus(direction: 'down' | 'up' | 'first' | 'last') {
    const count = items.length
    if (count === 0) return
    if (direction === 'first') {
      const index = firstEnabledIndex()
      if (index === -1) return
      flushSync(() => {
        selection.set(index)
        itemRefs[index]?.focus()
      })
      return
    }
    if (direction === 'last') {
      const index = lastEnabledIndex()
      if (index === -1) return
      flushSync(() => {
        selection.set(index)
        itemRefs[index]?.focus()
      })
      return
    }
    const delta = direction === 'down' ? 1 : -1
    let idx = selection.peek()
    for (let step = 0; step < count; step++) {
      idx = (idx + delta + count) % count
      if (!isDisabled(items[idx])) {
        // OS key auto-repeat fires back-to-back keydowns; Svelte batches
        // $state until the next microtask, so the active highlight would
        // only appear on keyup. Flush synchronously so each repeat paints
        // the newly active item immediately.
        flushSync(() => {
          selection.set(idx)
          itemRefs[idx]?.focus()
        })
        return
      }
    }
  }

  function setActive(index: number) {
    selection.set(index)
    itemRefs[index]?.focus()
  }

  function itemButtonClass(itemValue: T, state: MenuItemState): string | undefined {
    const classes = itemClass ? itemClass(itemValue, state) : ''
    return usePhoneSheet ? `${classes} min-h-11`.trim() : classes || undefined
  }

  function handleTriggerKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openFromTrigger(event.key === 'ArrowDown' ? 'down' : 'up')
    }
  }

  function handlePanelKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveFocus('down')
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus('up')
    } else if (event.key === 'Home') {
      event.preventDefault()
      moveFocus('first')
    } else if (event.key === 'End') {
      event.preventDefault()
      moveFocus('last')
    }
  }

  function handleItemClick(index: number) {
    if (isDisabled(items[index])) return
    close()
    onSelect(index)
  }

  const sheetTransition = $derived(sheetDragging || reduceMotion ? 'none' : undefined)

  $effect(() => {
    if (!open) return
    // Track the presentation so a viewport switch while open remounts the
    // branch and moves focus onto the new branch's active item.
    const sheet = usePhoneSheet
    void sheet
    tick().then(() => {
      itemRefs[selection.index]?.focus()
    })
  })

  $effect(() => {
    // bind:this grows itemRefs but never shrinks it; drop stale tail refs
    // so a shrinking item list can't focus a detached button.
    if (itemRefs.length > items.length) itemRefs = itemRefs.slice(0, items.length)
    if (!open) return
    selection.clamp(items.length)
  })

  const handleFocusOut = createFocusoutClose(
    () => open,
    // Intentionally the dialog panel, not the overlay: keyboard focus never
    // lands on the tabindex=-1 backdrop, while outside-click must include
    // the whole overlay so backdrop taps use the explicit close-with-return.
    () => ({ container: containerRef, panel: usePhoneSheet ? dialogRef : panelRef }),
    () => close(false),
  )

  useDropdown(() => ({
    isOpen: () => open,
    container: () => containerRef,
    onOutsideClick: () => close(false),
    onEscape: () => {
      close()
    },
    onScrollClose: usePhoneSheet ? undefined : () => close(false),
    panel: () => (usePhoneSheet ? overlayRef : panelRef),
  }))
</script>

{#snippet triggerButton()}
  <button
    type="button"
    bind:this={triggerRef}
    aria-label={ariaLabel}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls={open ? menuId : undefined}
    onclick={toggle}
    onkeydown={handleTriggerKeydown}
    class={`inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-950 text-slate-200 outline-none transition motion-reduce:transition-none hover:border-cyan-500 hover:text-cyan-300 focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-cyan-500 ${triggerClass}`}>
    {@render icon()}
  </button>
{/snippet}

{#snippet menuOptions()}
  {#each items as itemValue, index (itemKey(itemValue))}
    {@const state = { index, active: index === selection.index, disabled: isDisabled(itemValue) }}
    <button
      type="button"
      role={itemRole}
      aria-checked={itemRole === 'menuitemradio' && itemChecked ? itemChecked(itemValue) : undefined}
      bind:this={itemRefs[index]}
      tabindex={index === selection.index ? 0 : -1}
      onclick={() => handleItemClick(index)}
      onfocus={() => selection.set(index)}
      onmouseenter={() => setActive(index)}
      disabled={state.disabled}
      class={itemButtonClass(itemValue, state)}>
      {@render item(itemValue, state)}
    </button>
  {/each}
{/snippet}

<div
  class="relative inline-flex"
  bind:this={containerRef}
  data-escape-capture={open ? '' : null}
  onfocusout={handleFocusOut}>
  {#if triggerTooltip}
    <span bind:this={tooltipTriggerEl} class="group relative inline-flex">
      {@render triggerButton()}
      <Tooltip align={triggerTooltipAlign} trigger={tooltipTriggerEl}>{triggerTooltip}</Tooltip>
    </span>
  {:else}
    {@render triggerButton()}
  {/if}
  {#if open}
    {#if usePhoneSheet}
      <div
        bind:this={overlayRef}
        use:positionPanel={() => ({ getTrigger: () => containerRef, getOpen: () => open, presentation: 'sheet' })}
        class="fixed inset-0 z-40 flex items-end justify-center">
        <button
          type="button"
          aria-label={sheetCloseLabel}
          tabindex="-1"
          class="absolute inset-0 bg-slate-950/80 outline-none"
          onclick={() => close()}></button>
        <div
          bind:this={dialogRef}
          role="dialog"
          aria-labelledby={sheetTitleId}
          onfocusout={handleFocusOut}
          style:transform={sheetDragging || sheetDragOffset !== 0 ? `translateY(${sheetDragOffset}px)` : undefined}
          style:transition={sheetTransition}
          style:animation={sheetDragging ? 'none' : undefined}
          style:will-change={sheetDragging ? 'transform' : undefined}
          class="menu-sheet-enter relative flex w-full max-h-[min(75dvh,32rem)] flex-col overflow-hidden rounded-t-2xl border border-slate-800 border-b-0 border-x-0 bg-slate-900/95 shadow-2xl shadow-slate-950/60 backdrop-blur transition-transform duration-200 ease-out motion-reduce:transition-none">
          <div
            class="relative flex flex-none cursor-grab touch-pan-x items-start justify-between gap-3 border-b border-slate-800 px-4 pb-3 pt-4 active:cursor-grabbing"
            use:dragCloseDown={{
              isEnabled: () => usePhoneSheet && open,
              onDragUpdate: (offset, active) => {
                sheetDragOffset = offset
                sheetDragging = active
              },
              onClose: () => close(),
            }}>
            <div aria-hidden="true" class="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-slate-700"></div>
            <h2 id={sheetTitleId} class="pt-3 text-base font-semibold tracking-tight text-slate-100">{phoneSheetTitle}</h2>
            <button
              type="button"
              aria-label={sheetCloseLabel}
              onclick={() => close()}
              class="relative shrink-0 rounded-md p-2.5 text-slate-500 outline-none transition hover:text-slate-100 focus-visible:text-slate-100 motion-reduce:transition-none before:absolute before:-inset-1.5 before:content-['']">
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
          <div
            id={menuId}
            role="menu"
            tabindex="-1"
            aria-label={ariaLabel}
            onkeydown={handlePanelKeydown}
            class="min-h-0 overflow-y-auto px-2 py-2 outline-none pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
            {@render menuOptions()}
          </div>
        </div>
      </div>
    {:else}
      <div
        bind:this={panelRef}
        id={menuId}
        role="menu"
        tabindex="-1"
        aria-label={ariaLabel}
        onfocusout={handleFocusOut}
        onkeydown={handlePanelKeydown}
        use:positionPanel={() => ({ getTrigger: () => containerRef, getOpen: () => open, align, autoPlace })}
        class={`fixed left-0 top-0 z-40 will-change-transform overflow-hidden rounded-lg border border-slate-700 bg-slate-900/95 p-1 shadow-2xl shadow-slate-950/60 backdrop-blur ${panelClass}`}>
        {@render menuOptions()}
      </div>
    {/if}
  {/if}
</div>

<style>
  @keyframes menu-sheet-up {
    from {
      transform: translateY(1.5rem);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
  .menu-sheet-enter {
    animation: menu-sheet-up 180ms ease-out;
  }
  @media (prefers-reduced-motion: reduce) {
    .menu-sheet-enter {
      animation: none;
    }
  }
</style>
