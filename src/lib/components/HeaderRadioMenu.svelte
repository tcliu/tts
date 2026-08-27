<script lang="ts" generics="T extends string">
  import type { Snippet } from 'svelte'
  import Button from './Button.svelte'
  import { clickOutside } from '$lib/actions/click-outside'
  import { positionPanel } from '$lib/position-panel.svelte'
  import { handleRovingMenuKeydown, wrapIndex } from '$lib/menu-keyboard'

  interface Props {
    /** Accessible name and tooltip for the icon-only trigger. */
    label: string
    /** Accessible name for the radio-item panel. */
    menuLabel: string
    options: { value: T; label: string }[]
    selected: T
    onSelect: (value: T) => void
    /** When true, Escape is left to an open dialog instead of closing. */
    escapeYield?: () => boolean
    icon?: Snippet
  }

  let { label, menuLabel, options, selected, onSelect, escapeYield, icon }: Props = $props()

  let open = $state(false)
  let buttonRef = $state<HTMLButtonElement | null>(null)
  let panelRef = $state<HTMLDivElement | null>(null)
  let containerRef = $state<HTMLDivElement | null>(null)
  let itemRefs = $state<HTMLButtonElement[]>([])
  let index = $state(0)

  function toggle() {
    if (open) {
      open = false
      buttonRef?.focus()
      return
    }
    index = Math.max(0, options.findIndex(option => option.value === selected))
    open = true
  }

  function focusItem(next: number) {
    index = wrapIndex(next, options.length)
    itemRefs[index]?.focus()
  }

  function handleKeydown(event: KeyboardEvent) {
    handleRovingMenuKeydown(event, {
      count: options.length,
      getIndex: () => index,
      moveTo: focusItem,
      close: () => {
        open = false
      },
    })
  }

  function select(value: T) {
    onSelect(value)
    open = false
    buttonRef?.focus()
  }

  $effect(() => {
    if (!open) {
      return
    }
    itemRefs[index]?.focus()
  })

  // The opener owns dismissal: Escape closes and restores the trigger's focus, yielding to dialogs.
  $effect(() => {
    if (!open) {
      return
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || escapeYield?.()) {
        return
      }
      // Match Menu.svelte: preempt lower layers so one Escape closes one menu.
      event.stopImmediatePropagation()
      event.preventDefault()
      open = false
      buttonRef?.focus()
    }
    window.addEventListener('keydown', handleEscape, true)
    return () => {
      window.removeEventListener('keydown', handleEscape, true)
    }
  })
</script>

<div
  bind:this={containerRef}
  class="relative inline-flex"
  use:clickOutside={() => {
    if (open) open = false
  }}>
  <Button bind:buttonEl={buttonRef} variant="secondary" size="sm" ariaLabel={label} ariaExpanded={open} tooltip={label} onClick={toggle} icon={icon} />

  {#if open}
    <div
      bind:this={panelRef}
      role="menu"
      aria-label={menuLabel}
      tabindex="-1"
      onkeydown={handleKeydown}
      use:positionPanel={() => ({ getTrigger: () => buttonRef, getOpen: () => open, align: 'right', autoPlace: true })}
      class="fixed left-0 top-0 z-50 w-52 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/95 p-1 shadow-2xl shadow-slate-950/60 backdrop-blur">
      {#each options as option, i}
        <button
          bind:this={itemRefs[i]}
          type="button"
          role="menuitemradio"
          aria-checked={selected === option.value}
          tabindex={i === index ? 0 : -1}
          onclick={() => select(option.value)}
          class={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm outline-none transition motion-reduce:transition-none ${selected === option.value ? 'bg-cyan-500/15 text-cyan-200' : 'text-slate-300 hover:bg-slate-800 hover:text-cyan-200 focus:bg-slate-800 focus:text-cyan-200'}`}>
          {option.label}
        </button>
      {/each}
    </div>
  {/if}
</div>
