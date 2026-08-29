<script lang="ts">
  import { tick } from 'svelte'
  import { clickOutside } from '$lib/actions/click-outside'
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
    panelClass = 'w-max max-w-xs overflow-hidden rounded-lg border border-slate-700 bg-slate-900/95 p-1 shadow-2xl shadow-slate-950/60 backdrop-blur',
  }: Props = $props()

  let id = $props.id()
  const panelId = `${id}-panel`

  const SIZE_CLASS = {
    xs: { pad: 'py-1', minW: 'min-w-16' },
    sm: { pad: 'py-2', minW: 'min-w-24' },
    md: { pad: 'py-2.5', minW: 'min-w-24' },
    lg: { pad: 'py-3', minW: 'min-w-28' },
  } as const

  const resolvedButtonClass = $derived(
    buttonClass ??
      `inline-flex ${SIZE_CLASS[size].minW} cursor-pointer items-center justify-between gap-2 rounded-md border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none transition motion-reduce:transition-none hover:border-cyan-500 focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${SIZE_CLASS[size].pad} ${TEXT_SIZE[size]}`,
  )

  const resolvedControlClass = $derived(
    controlClass ??
      `${SIZE_CLASS[size].minW} field-sizing-content cursor-pointer rounded-md border border-slate-700 bg-slate-950 pl-3 pr-8 text-slate-100 outline-none transition motion-reduce:transition-none hover:border-cyan-500 focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${SIZE_CLASS[size].pad} ${TEXT_SIZE[size]}`,
  )

  const optionRowClass = $derived(
    optionClass ??
      `flex w-full cursor-pointer items-center justify-between rounded-md px-3 text-left outline-none transition motion-reduce:transition-none ${SIZE_CLASS[size].pad} ${TEXT_SIZE[size]}`,
  )

  let open = $state(false)
  let containerRef = $state<HTMLDivElement | null>(null)
  let inputRef = $state<HTMLInputElement | null>(null)
  let controlRef = $state<HTMLInputElement | HTMLButtonElement | HTMLDivElement | null>(null)
  let panelRef = $state<HTMLDivElement | null>(null)
  let filterText = $state('')
  let highlightIndex = $state(0)
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

  let lastFilteredOptions: Option[] | null = null
  $effect(() => {
    if (!open) return
    if (lastFilteredOptions !== filteredOptions) {
      lastFilteredOptions = filteredOptions
      highlightIndex = 0
    }
  })

  function close() {
    open = false
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
    open = true
    highlightIndex = 0
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

  function moveHighlight(direction: 'down' | 'up') {
    if (filteredOptions.length === 0) return
    if (!open) {
      openPanel()
      if (direction === 'up') {
        highlightIndex = filteredOptions.length - 1
      }
      return
    }
    if (direction === 'down') {
      highlightIndex = (highlightIndex + 1) % filteredOptions.length
    } else {
      highlightIndex = (highlightIndex - 1 + filteredOptions.length) % filteredOptions.length
    }
  }

  function handleControlKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveHighlight('down')
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveHighlight('up')
    } else if (event.key === 'Enter') {
      if (!open) {
        if (filterable) {
          event.preventDefault()
        }
        return
      }
      event.preventDefault()
      const option = filteredOptions[highlightIndex] ?? filteredOptions[0]
      if (option) {
        void select(option.value)
      }
    }
  }

  $effect(() => {
    if (!open) {
      return
    }
    function handleKeydownCapture(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation()
        event.preventDefault()
        if (filterable && filterText && filterText !== buttonLabel) {
          filterText = ''
          return
        }
        close()
      }
    }
    window.addEventListener('keydown', handleKeydownCapture, true)
    return () => {
      window.removeEventListener('keydown', handleKeydownCapture, true)
    }
  })
</script>

<div
  class="relative"
  bind:this={containerRef}
  data-escape-capture={open ? '' : null}
  use:clickOutside={{ enabled: open, handler: () => close(), include: [panelRef] }}>
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
        aria-activedescendant={open && filteredOptions[highlightIndex]
          ? `${panelId}-option-${highlightIndex}`
          : undefined}
        onfocus={handleControlFocus}
        onclick={handleControlClick}
        onkeydown={handleControlKeydown}
        class={resolvedControlClass} />
      <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
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
      aria-activedescendant={open && filteredOptions[highlightIndex]
        ? `${panelId}-option-${highlightIndex}`
        : undefined}
      onclick={toggle}
      onkeydown={handleControlKeydown}
      class={resolvedButtonClass}>
      <span>{buttonLabel}</span>
      <ChevronDownIcon className="h-4 w-4 text-slate-500" />
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
      {#each filteredOptions as option, index}
        <button
          type="button"
          id={`${panelId}-option-${index}`}
          role="option"
          tabindex="-1"
          aria-selected={option.value === activeValue}
          onpointerdown={event => event.preventDefault()}
          onclick={() => void select(option.value)}
          onmouseenter={() => (highlightIndex = index)}
          class={`${optionRowClass} ${
            index === highlightIndex
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
