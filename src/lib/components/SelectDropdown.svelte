<script lang="ts">
  import { flushSync, tick } from 'svelte'
  import { createFocusoutClose } from '$lib/actions/use-focusout-close'
  import { useDropdown } from '$lib/actions/use-dropdown.svelte'
  import { useListSelection, revealInScrollport } from '$lib/actions/use-list-selection.svelte'
  import { positionPanel } from '$lib/position-panel.svelte'
  import { TEXT_SIZE, type TextSize } from '$lib/text-size'
  import ChevronDownIcon from '$lib/icons/ChevronDownIcon.svelte'
  import type { DropdownPanelProps } from '$lib/dropdown-chrome'

  interface Option {
    value: string
    label: string
  }

  interface Props extends DropdownPanelProps {
    buttonLabel: string
    options: Option[]
    activeValue?: string
    ariaLabel?: string
    filterable?: boolean
    size?: TextSize
    onSelect: (value: string) => void
    buttonClass?: string
    controlClass?: string
    optionClass?: string
    emptyLabel?: string
  }

  let {
    buttonLabel,
    options,
    activeValue = '',
    ariaLabel,
    align = 'left',
    autoPlace = true,
    filterable = false,
    onSelect,
    size = 'sm',
    buttonClass,
    controlClass,
    optionClass,
    emptyLabel,
    panelClass = 'w-max max-w-xs max-h-[min(50vh,20rem)] overflow-y-auto rounded-lg border border-slate-700 bg-slate-900/95 p-1 shadow-2xl shadow-slate-950/60 backdrop-blur',
  }: Props = $props()

  let id = $props.id()
  const panelId = `${id}-panel`

  const SIZE_CLASS = {
    xs: { pad: 'py-1', minW: 'min-w-16' },
    sm: { pad: 'py-2', minW: 'min-w-16' },
    md: { pad: 'py-2.5', minW: 'min-w-24' },
    lg: { pad: 'py-3', minW: 'min-w-28' },
  } as const

  const resolvedButtonClass = $derived(
    buttonClass ??
      `inline-flex ${SIZE_CLASS[size].minW} cursor-pointer items-center justify-between gap-2 rounded-md border border-slate-700 bg-slate-950 pl-3 pr-2 text-slate-100 outline-none transition motion-reduce:transition-none hover:border-cyan-500 focus-visible:border-cyan-500 ${SIZE_CLASS[size].pad} ${TEXT_SIZE[size]}`,
  )

  const resolvedControlClass = $derived(
    controlClass ??
      `${SIZE_CLASS[size].minW} field-sizing-content cursor-pointer rounded-md border border-slate-700 bg-slate-950 pl-3 pr-7 text-slate-100 outline-none transition motion-reduce:transition-none hover:border-cyan-500 focus-visible:border-cyan-500 ${SIZE_CLASS[size].pad} ${TEXT_SIZE[size]}`,
  )

  // Phone viewports get a 44px minimum row height via pure CSS so in-dialog
  // dropdowns stay thumb-friendly without switching to a bottom sheet,
  // which must never stack inside a dialog.
  // Cutoff mirrors PHONE_SHEET_MAX in dropdown-chrome (single shared value);
  // the literal stays inline so Tailwind can see the class — keep them in sync.
  const optionRowClass = $derived(
    optionClass ??
      `flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-3 text-left outline-none transition motion-reduce:transition-none max-[27.999rem]:min-h-11 ${SIZE_CLASS[size].pad} ${TEXT_SIZE[size]}`,
  )

  const emptyClass = $derived(`px-3 ${SIZE_CLASS[size].pad} ${TEXT_SIZE[size]} text-slate-500`)
  let open = $state(false)
  const selection = useListSelection()
  let containerRef = $state<HTMLDivElement | null>(null)
  let inputRef = $state<HTMLInputElement | null>(null)
  let controlRef = $state<HTMLInputElement | HTMLButtonElement | HTMLDivElement | null>(null)
  let panelRef = $state<HTMLDivElement | null>(null)
  let filterText = $state('')
  let suppressOpenOnFocus = false

  const filteredOptions = $derived.by(() => {
    if (!filterable) {
      return options
    }
    const query = filterText.startsWith(buttonLabel) ? filterText.slice(buttonLabel.length) : filterText
    const needle = query.trim().toLowerCase()
    if (needle === '') {
      return options
    }
    return options.filter(
      option => option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle),
    )
  })

  $effect(() => {
    if (!open) {
      filterText = buttonLabel
    }
  })

  // Reset the highlight to the top of the visible list whenever it changes
  // (filter typing, options prop swap) so the cursor does not stay stranded
  // on a row that has scrolled out of view.
  let lastFilteredOptions: Option[] | null = null
  $effect(() => {
    if (!open) return
    if (lastFilteredOptions !== filteredOptions) {
      lastFilteredOptions = filteredOptions
      selection.reset()
    }
  })

  $effect(() => {
    if (!open) return
    selection.clamp(filteredOptions.length)
  })

  function close() {
    open = false
  }

  // Keep the highlighted option visible while arrowing through a scrollable
  // panel: the option never receives focus (aria-activedescendant pattern),
  // so the browser would otherwise let it drift out of the scrollport.
  function revealActive() {
    revealInScrollport(panelRef?.querySelector<HTMLButtonElement>(`[id="${panelId}-option-${selection.peek()}"]`))
  }

  function toggle() {
    if (open) {
      close()
    } else {
      openPanel()
    }
  }

  function openPanel() {
    lastFilteredOptions = filteredOptions
    // Highlight the committed value on open; hover/arrows move from there.
    selection.syncToActive(filteredOptions, option => option.value === activeValue)
    open = true
    // A long list would otherwise open with the highlighted row scrolled out of
    // sight: the option never receives focus (aria-activedescendant pattern), so
    // nothing else brings it into view, and a native select always shows the
    // selected row. Reveal after the flush, once `positionPanel` has portaled
    // and shown the panel — an effect here runs too early to scroll it.
    void tick().then(() => revealActive())
  }

  function handleControlFocus() {
    if (suppressOpenOnFocus) {
      suppressOpenOnFocus = false
      return
    }
    openPanel()
  }

  function handleControlClick() {
    if (!open) {
      openPanel()
    }
  }

  async function select(value: string) {
    const selectedOption = options.find(option => option.value === value)
    const needsFocusRestore = filterable && inputRef !== null && document.activeElement !== inputRef
    onSelect(value)
    if (filterable && selectedOption) {
      filterText = selectedOption.label
    }
    close()
    if (needsFocusRestore) {
      suppressOpenOnFocus = true
      await tick()
      inputRef?.focus()
    }
  }

  function handleControlKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) {
        flushSync(() => {
          openPanel()
        })
        return
      }
      flushSync(() => {
        selection.move('down', filteredOptions.length)
        revealActive()
      })
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        flushSync(() => {
          openPanel()
          selection.move('last', filteredOptions.length)
        })
        return
      }
      flushSync(() => {
        selection.move('up', filteredOptions.length)
        revealActive()
      })
    } else if (event.key === 'Home' || event.key === 'End') {
      if (open && filteredOptions.length > 0) {
        event.preventDefault()
        flushSync(() => {
          selection.move(event.key === 'Home' ? 'first' : 'last', filteredOptions.length)
          revealActive()
        })
      }
    } else if (event.key === 'Enter') {
      if (!open) {
        if (filterable) {
          event.preventDefault()
        }
        return
      }
      event.preventDefault()
      const option = filteredOptions[selection.index] ?? filteredOptions[0]
      if (option) {
        void select(option.value)
      }
    }
  }
  const handleFocusOut = createFocusoutClose(
    () => open,
    () => ({ container: containerRef, panel: panelRef }),
    () => close(),
  )

  useDropdown(() => ({
    isOpen: () => open,
    container: () => containerRef,
    onOutsideClick: () => close(),
    onEscape: () => {
      if (filterable && filterText && filterText !== buttonLabel) {
        filterText = ''
        return true
      }
      close()
    },
    onScrollClose: () => close(),
    panel: () => panelRef,
  }))
</script>

<div
  class="relative"
  bind:this={containerRef}
  data-escape-capture={open ? '' : null}
  onfocusout={handleFocusOut}
>
  {#if filterable}
    <div class="relative w-fit" bind:this={controlRef}>
      <input
        bind:this={inputRef}
        type="text"
        bind:value={filterText}
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-activedescendant={open && filteredOptions[selection.index]
          ? `${panelId}-option-${selection.index}`
          : undefined}
        onfocus={handleControlFocus}
        onclick={handleControlClick}
        onkeydown={handleControlKeydown}
        class={resolvedControlClass} />
      <ChevronDownIcon className="pointer-events-none absolute right-1.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  {:else}
    <button
      type="button"
      bind:this={controlRef}
      role="combobox"
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      aria-activedescendant={open && filteredOptions[selection.index]
        ? `${panelId}-option-${selection.index}`
        : undefined}
      onclick={toggle}
      onkeydown={handleControlKeydown}
      class={resolvedButtonClass}>
      <span class="min-w-0 flex-1 truncate">{buttonLabel}</span>
      <ChevronDownIcon className="ml-auto h-4 w-4 shrink-0 text-slate-500" />
    </button>
  {/if}
  {#if open}
    <div
      bind:this={panelRef}
      id={panelId}
      role="listbox"
      aria-label={ariaLabel}
      use:positionPanel={() => ({ getTrigger: () => containerRef, getOpen: () => open, align, autoPlace })}
      class={`fixed left-0 top-0 z-40 will-change-transform ${panelClass}`}>
      {#if emptyLabel && filteredOptions.length === 0}
        <div role="presentation" class={emptyClass}>{emptyLabel}</div>
      {/if}
      {#each filteredOptions as option, index}
        <button
          type="button"
          id={`${panelId}-option-${index}`}
          role="option"
          tabindex="-1"
          aria-selected={option.value === activeValue}
          onpointerdown={event => event.preventDefault()}
          onclick={() => void select(option.value)}
          onfocus={() => selection.set(index)}
          onmouseenter={() => selection.set(index)}
          class={`${optionRowClass} ${
            index === selection.index
              ? 'bg-slate-800 text-cyan-200'
              : option.value === activeValue
                ? 'bg-cyan-500/15 text-cyan-200'
                : 'text-slate-300 hover:bg-slate-800 hover:text-cyan-200'
          }`}>
          <span class="min-w-0 truncate">{option.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
