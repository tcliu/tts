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
  import { clickOutside } from '$lib/actions/click-outside'
  import { tick } from 'svelte'
  import type { DropdownPanelProps } from '$lib/dropdown-chrome'

  interface Props extends DropdownPanelProps {
    items: T[]
    itemKey: (item: T) => string
    onSelect: (index: number) => void
    icon: Snippet
    item: Snippet<[T, MenuItemState]>
    ariaLabel: string
    triggerClass?: string
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
    panelClass = '',
    itemClass,
    itemRole = 'menuitem',
    itemChecked,
    itemDisabled = () => false,
  }: Props = $props()

  let uid = $props.id()
  const menuId = $derived(`menu-${uid}`)

  let open = $state(false)
  let activeIndex = $state(0)
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

  function toggle() {
    open = !open
  }

  function openFromTrigger() {
    if (!open) open = true
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

  function moveFocus(delta: number) {
    const count = items.length
    if (count === 0) return
    let index = activeIndex
    for (let step = 0; step < count; step++) {
      index = (index + delta + count) % count
      if (!isDisabled(items[index])) {
        activeIndex = index
        itemRefs[index]?.focus()
        return
      }
    }
  }

  function setActive(index: number) {
    activeIndex = index
    itemRefs[index]?.focus()
  }

  function handleTriggerKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openFromTrigger()
    }
  }

  function handlePanelKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveFocus(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(-1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      const index = firstEnabledIndex()
      if (index !== -1) {
        activeIndex = index
        itemRefs[index]?.focus()
      }
    } else if (event.key === 'End') {
      event.preventDefault()
      const index = lastEnabledIndex()
      if (index !== -1) {
        activeIndex = index
        itemRefs[index]?.focus()
      }
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
        const index = firstEnabledIndex()
        activeIndex = index === -1 ? 0 : index
        itemRefs[activeIndex]?.focus()
      })
    }
  })

  $effect(() => {
    if (!open) return
    function handleKeydownCapture(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation()
        event.preventDefault()
        close()
      }
    }
    const handleScroll = () => close(false)
    window.addEventListener('keydown', handleKeydownCapture, true)
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true })
    return () => {
      window.removeEventListener('keydown', handleKeydownCapture, true)
      window.removeEventListener('scroll', handleScroll, { capture: true })
    }
  })
</script>

<div
  class="relative inline-flex"
  bind:this={containerRef}
  data-escape-capture={open ? '' : null}
  use:clickOutside={{ enabled: open, handler: () => close(false), include: [panelRef] }}>
  <button
    type="button"
    bind:this={triggerRef}
    aria-label={ariaLabel}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls={open ? menuId : undefined}
    onclick={toggle}
    onkeydown={handleTriggerKeydown}
    class={`inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-950 text-slate-200 outline-none transition motion-reduce:transition-none hover:border-cyan-500 hover:text-cyan-300 focus:border-cyan-500 focus:text-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${triggerClass}`}>
    {@render icon()}
  </button>
  {#if open}
    <div
      bind:this={panelRef}
      id={menuId}
      role="menu"
      tabindex="-1"
      aria-label={ariaLabel}
      onkeydown={handlePanelKeydown}
      use:positionPanel={() => ({ getTrigger: () => containerRef, getOpen: () => open, align, autoPlace })}
      class={`fixed left-0 top-0 z-40 will-change-transform overflow-hidden rounded-lg border border-slate-700 bg-slate-900/95 p-1 shadow-2xl shadow-slate-950/60 backdrop-blur ${panelClass}`}>
      {#each items as itemValue, index (itemKey(itemValue))}
        {@const state = { index, active: index === activeIndex, disabled: isDisabled(itemValue) }}
        <button
          type="button"
          role={itemRole}
          aria-checked={itemRole === 'menuitemradio' && itemChecked ? itemChecked(itemValue) : undefined}
          bind:this={itemRefs[index]}
          tabindex={index === activeIndex ? 0 : -1}
          onclick={() => handleItemClick(index)}
          onmouseenter={() => setActive(index)}
          disabled={state.disabled}
          class={itemClass ? itemClass(itemValue, state) : undefined}>
          {@render item(itemValue, state)}
        </button>
      {/each}
    </div>
  {/if}
</div>