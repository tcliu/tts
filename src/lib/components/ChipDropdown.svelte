<script lang="ts">
  import { tick } from 'svelte'
  import { clickOutside } from '$lib/actions/click-outside'
  import { positionPanel } from '$lib/position-panel.svelte'
  import ChevronDownIcon from '$lib/icons/ChevronDownIcon.svelte'
  import CheckIcon from '$lib/icons/CheckIcon.svelte'
  import type { DropdownPanelProps } from '$lib/dropdown-chrome'
  import { CHIP_PANEL_BASE, DEFAULT_CHIP_PANEL_CLASS } from '$lib/dropdown-chrome'

  interface Option {
    value: string
    label: string
  }

  interface Props extends DropdownPanelProps {
    label: string
    options: Option[]
    activeValue?: string
    ariaLabel: string
    disabled?: boolean
    variant?: 'sky' | 'violet' | 'amber' | 'fuchsia' | 'emerald'
    buttonClass?: string
    filterable?: boolean
    filterPlaceholder?: string
    emptyText?: string
    onSelect: (value: string) => void
  }

  let {
    label,
    options,
    activeValue = '',
    ariaLabel,
    align = 'left',
    autoPlace = true,
    disabled = false,
    variant = 'violet',
    panelClass = DEFAULT_CHIP_PANEL_CLASS,
    buttonClass,
    filterable = false,
    filterPlaceholder = 'Search…',
    emptyText = 'No results.',
    onSelect,
  }: Props = $props()

  let id = $props.id()
  const panelId = `${id}-panel`

  const VARIANT_ACTIVE: Record<string, string> = {
    sky: 'bg-sky-500/15 text-sky-200',
    violet: 'bg-violet-500/15 text-violet-200',
    amber: 'bg-amber-500/15 text-amber-200',
    fuchsia: 'bg-fuchsia-500/15 text-fuchsia-200',
    emerald: 'bg-emerald-500/15 text-emerald-200',
  }

  const VARIANT_CHIP: Record<string, string> = {
    sky: 'border-sky-500/30 bg-sky-500/10 text-sky-200 hover:border-sky-400 hover:text-sky-100 focus-visible:ring-sky-500',
    violet: 'border-violet-500/30 bg-violet-500/10 text-violet-200 hover:border-violet-400 hover:text-violet-100 focus-visible:ring-violet-500',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-200 hover:border-amber-400 hover:text-amber-100 focus-visible:ring-amber-500',
    fuchsia: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200 hover:border-fuchsia-400 hover:text-fuchsia-100 focus-visible:ring-fuchsia-500',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:border-emerald-400 hover:text-emerald-100 focus-visible:ring-emerald-500',
  }

  const resolvedButtonClass = $derived(
    buttonClass ??
      `inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CHIP[variant] ?? VARIANT_CHIP.violet}`,
  )

  // Filterable layout is a fixed header + scrolling list contract
  // (`shrink-0` search + `flex-1 overflow-y-auto` options). A custom
  // `panelClass` is intentionally ignored here so an ad-hoc
  // `overflow-y-auto`/`p-1` doesn't create a double-scroll container.
  const resolvedPanelClass = $derived(
    filterable ? `${CHIP_PANEL_BASE} overflow-hidden flex flex-col` : panelClass,
  )

  let open = $state(false)
  let containerRef = $state<HTMLDivElement | null>(null)
  let buttonRef = $state<HTMLButtonElement | null>(null)
  let panelRef = $state<HTMLDivElement | null>(null)
  let inputRef = $state<HTMLInputElement | null>(null)
  let filterText = $state('')
  let highlightIndex = $state(0)

  const filteredOptions = $derived.by(() => {
    if (!filterable) return options
    const needle = filterText.trim().toLowerCase()
    if (!needle) return options
    return options.filter(option => option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle))
  })

  let lastFiltered: Option[] | null = null
  $effect(() => {
    if (!open || !filterable) return
    if (lastFiltered !== filteredOptions) {
      lastFiltered = filteredOptions
      const idx = filteredOptions.findIndex((option) => option.value === activeValue)
      highlightIndex = idx >= 0 ? idx : 0
    }
  })

  $effect(() => {
    if (!open && filterable) {
      filterText = ''
    }
  })

  $effect(() => {
    if (open && filterable) {
      void tick().then(() => inputRef?.focus())
    }
  })

  function close() {
    open = false
  }

  function toggle() {
    if (disabled) return
    if (open) close()
    else openPanel()
  }

  function openPanel() {
    if (disabled) return
    // Highlight the active value when opening so keyboard and mouse share the same start.
    const list = filterable ? filteredOptions : options
    const idx = list.findIndex((option) => option.value === activeValue)
    highlightIndex = idx >= 0 ? idx : 0
    if (filterable) filterText = ''
    open = true
  }

  function select(value: string) {
    onSelect(value)
    close()
    buttonRef?.focus()
  }

  function moveHighlight(direction: 'down' | 'up') {
    const list = filteredOptions
    if (list.length === 0) return
    if (!open) {
      openPanel()
      if (direction === 'up') highlightIndex = list.length - 1
      return
    }
    if (direction === 'down') highlightIndex = (highlightIndex + 1) % list.length
    else highlightIndex = (highlightIndex - 1 + list.length) % list.length
  }

  function handleButtonKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveHighlight('down')
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveHighlight('up')
    } else if (event.key === 'Home') {
      if (open && filteredOptions.length > 0) {
        event.preventDefault()
        highlightIndex = 0
      }
    } else if (event.key === 'End') {
      if (open && filteredOptions.length > 0) {
        event.preventDefault()
        highlightIndex = filteredOptions.length - 1
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (!open) {
        event.preventDefault()
        openPanel()
        return
      }
      event.preventDefault()
      const option = filteredOptions[highlightIndex]
      if (option) select(option.value)
    }
  }

  function handleFilterKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveHighlight('down')
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveHighlight('up')
    } else if (event.key === 'Home') {
      event.preventDefault()
      highlightIndex = 0
    } else if (event.key === 'End') {
      event.preventDefault()
      highlightIndex = filteredOptions.length - 1
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const option = filteredOptions[highlightIndex] ?? filteredOptions[0]
      if (option) select(option.value)
    } else if (event.key === 'Tab') {
      // Close on Tab so focus never sits outside an open listbox (APG combobox).
      event.preventDefault()
      close()
      buttonRef?.focus()
    } else if (event.key === 'Escape') {
      if (filterText) {
        event.preventDefault()
        event.stopPropagation()
        filterText = ''
        return
      }
    }
  }

  $effect(() => {
    if (!open) return
    function handleKeydownCapture(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        // If filterable input has text, let its handler clear first
        if (filterable && filterText) return
        event.stopImmediatePropagation()
        event.preventDefault()
        close()
        buttonRef?.focus()
      }
    }
    window.addEventListener('keydown', handleKeydownCapture, true)
    return () => window.removeEventListener('keydown', handleKeydownCapture, true)
  })
</script>

{#snippet optionList()}
  {#each filteredOptions as option, index}
    <button
      type="button"
      id={`${panelId}-option-${index}`}
      role="option"
      tabindex="-1"
      aria-selected={option.value === activeValue}
      onpointerdown={(event) => event.preventDefault()}
      onclick={() => select(option.value)}
      onmouseenter={() => (highlightIndex = index)}
      class={`flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-left text-xs outline-none transition ${index === highlightIndex ? 'bg-slate-800 text-slate-100' : option.value === activeValue ? VARIANT_ACTIVE[variant] : 'text-slate-300'}`}>
      <span class="min-w-0 truncate">{option.label}</span>
      {#if option.value === activeValue}
        <CheckIcon className="h-3 w-3 shrink-0 opacity-70" />
      {/if}
    </button>
  {:else}
    <div role="presentation" class="px-3 py-6 text-center text-xs text-slate-500">{emptyText}</div>
  {/each}
{/snippet}

<div
  class="relative inline-flex"
  bind:this={containerRef}
  data-escape-capture={open ? '' : null}
  use:clickOutside={{ enabled: open, handler: () => close(), include: [panelRef] }}>
  <button
    type="button"
    bind:this={buttonRef}
    role={filterable ? undefined : 'combobox'}
    aria-label={ariaLabel}
    aria-haspopup={filterable ? undefined : 'listbox'}
    aria-expanded={filterable ? undefined : open}
    aria-controls={!filterable && open ? panelId : undefined}
    aria-activedescendant={!filterable && open && filteredOptions[highlightIndex] ? `${panelId}-option-${highlightIndex}` : undefined}
    disabled={disabled}
    onclick={toggle}
    onkeydown={handleButtonKeydown}
    class={resolvedButtonClass}>
    <span class="truncate">{label}</span>
    <ChevronDownIcon className="h-3 w-3 shrink-0 opacity-70" />
  </button>

  {#if open}
    {#if filterable}
      <div
        bind:this={panelRef}
        use:positionPanel={() => ({ getTrigger: () => containerRef, getOpen: () => open, align, autoPlace })}
        class={resolvedPanelClass}>
        <div class="shrink-0 border-b border-slate-800 bg-slate-900/95 p-1">
          <input
            bind:this={inputRef}
            type="text"
            bind:value={filterText}
            placeholder={filterPlaceholder}
            aria-label={filterPlaceholder || ariaLabel}
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            aria-activedescendant={open && filteredOptions[highlightIndex] ? `${panelId}-option-${highlightIndex}` : undefined}
            onkeydown={handleFilterKeydown}
            class="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/50" />
        </div>
        <div id={panelId} role="listbox" aria-label={ariaLabel} class="min-h-0 flex-1 overflow-y-auto p-1">
          {@render optionList()}
        </div>
      </div>
    {:else}
      <div
        bind:this={panelRef}
        id={panelId}
        role="listbox"
        aria-label={ariaLabel}
        use:positionPanel={() => ({ getTrigger: () => containerRef, getOpen: () => open, align, autoPlace })}
        class={resolvedPanelClass}>
        {@render optionList()}
      </div>
    {/if}
  {/if}
</div>
