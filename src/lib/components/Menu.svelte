<script module lang="ts">
  import type { Snippet } from 'svelte'

  export interface MenuItemState {
    index: number
    active: boolean
    disabled: boolean
  }
</script>

<script lang="ts" generics="T">
  import { positionPanel } from '$lib/position-panel.svelte'
  import { createFocusoutClose } from '$lib/actions/use-focusout-close'
  import { useDropdown } from '$lib/actions/use-dropdown.svelte'
  import { useListSelection } from '$lib/actions/use-list-selection.svelte'
  import { flushSync, tick } from 'svelte'
  import type { DropdownPanelProps } from '$lib/dropdown-chrome'
  import Tooltip from './Tooltip.svelte'

  interface Props extends DropdownPanelProps {
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
  }: Props = $props()

  let uid = $props.id()
  const menuId = $derived(`menu-${uid}`)

  let open = $state(false)
  const selection = useListSelection()
  let containerRef = $state<HTMLDivElement | null>(null)
  let triggerRef = $state<HTMLButtonElement | null>(null)
  let panelRef = $state<HTMLDivElement | null>(null)
  let itemRefs = $state<HTMLButtonElement[]>([])

  function isDisabled(item: T): boolean {
    return itemDisabled(item)
  }

  function close(returnFocus = true) {
    open = false
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
      open = false
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

  $effect(() => {
    if (open) {
      tick().then(() => {
        itemRefs[selection.index]?.focus()
      })
    }
  })

  $effect(() => {
    if (!open) return
    selection.clamp(items.length)
  })

  const handleFocusOut = createFocusoutClose(
    () => open,
    () => ({ container: containerRef, panel: panelRef }),
    () => close(false),
  )

  useDropdown(() => ({
    isOpen: () => open,
    container: () => containerRef,
    onOutsideClick: () => close(false),
    onEscape: () => {
      close()
    },
    onScrollClose: () => close(false),
    panel: () => panelRef,
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

<div
  class="relative inline-flex"
  bind:this={containerRef}
  data-escape-capture={open ? '' : null}
  onfocusout={handleFocusOut}>
  {#if triggerTooltip}
    <span class="group relative inline-flex">
      {@render triggerButton()}
      <Tooltip align={triggerTooltipAlign}>{triggerTooltip}</Tooltip>
    </span>
  {:else}
    {@render triggerButton()}
  {/if}
  {#if open}
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
          class={itemClass ? itemClass(itemValue, state) : undefined}>
          {@render item(itemValue, state)}
        </button>
      {/each}
    </div>
  {/if}
</div>
