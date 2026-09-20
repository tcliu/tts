<script lang="ts">
  import { tick } from 'svelte'
  import Chip from '$lib/components/Chip.svelte'
  import { positionPanel } from '$lib/position-panel.svelte'
  import { getI18nContext } from '$lib/i18n.svelte'
  const i18n = getI18nContext()

  export interface ComboboxOption {
    value: string
    label: string
    detail?: string
  }

  interface Props {
    selected: ComboboxOption[]
    suggestions: ComboboxOption[]
    onQueryChange?: (query: string) => void
    onAdd?: (item: ComboboxOption) => void
    onRemove?: (value: string) => void
    placeholder?: string
    id?: string
    chip?: import('svelte').Snippet<[ComboboxOption, (value: string) => void]>
    option?: import('svelte').Snippet<[ComboboxOption]>
  }

  let {
    selected,
    suggestions,
    onQueryChange,
    onAdd,
    onRemove,
    placeholder,
    id,
    chip,
    option,
  }: Props = $props()

  let inputValue = $state('')
  let activeIndex = $state(0)
  let dropdownOpen = $state(false)
  let navigated = $state(false)
  let closeTimer: ReturnType<typeof setTimeout> | null = null
  let containerRef = $state<HTMLDivElement | null>(null)
  let inputRef = $state<HTMLInputElement | null>(null)
  let internalUpdate = false

  const listboxId = $derived(`${id ? `${id}-` : 'combobox-'}listbox`)
  const optionId = (index: number) => `${listboxId}-option-${index}`
  const activeOptionId = $derived(
    dropdownOpen && suggestions.length > 0 ? optionId(activeIndex) : undefined,
  )

  $effect(() => {
    if (!dropdownOpen) return
    const el = activeOptionId ? document.getElementById(activeOptionId) : null
    el?.scrollIntoView({ block: 'nearest' })
  })

  export function focus() {
    inputRef?.focus()
  }

  $effect(() => {
    void selected
    if (internalUpdate) {
      internalUpdate = false
      return
    }
    inputValue = ''
    activeIndex = 0
    dropdownOpen = false
    navigated = false
  })

  async function remove(value: string) {
    internalUpdate = true
    onRemove?.(value)
    inputRef?.focus()
    onQueryChange?.(inputValue)
    await tick()
    internalUpdate = false
  }

  async function add(item: ComboboxOption) {
    internalUpdate = true
    onAdd?.(item)
    inputValue = ''
    activeIndex = 0
    navigated = false
    onQueryChange?.('')
    await tick()
    internalUpdate = false
  }

  function handleInputFocus() {
    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
    dropdownOpen = true
  }

  function handleInputBlur() {
    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
    closeTimer = setTimeout(() => {
      dropdownOpen = false
      closeTimer = null
    }, 120)
  }

  function handleInput() {
    navigated = false
    activeIndex = 0
    onQueryChange?.(inputValue)
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Backspace' && !inputValue && selected.length > 0) {
      void remove(selected[selected.length - 1].value)
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      navigated = true
      if (suggestions.length > 0) {
        activeIndex = (activeIndex + 1) % suggestions.length
      }
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      navigated = true
      if (suggestions.length > 0) {
        activeIndex = (activeIndex - 1 + suggestions.length) % suggestions.length
      }
      return
    }

    if (event.key === 'Enter') {
      if (!inputValue.trim()) {
        return
      }
      event.preventDefault()
      if (navigated && suggestions[activeIndex]) {
        void add(suggestions[activeIndex])
        return
      }
      const query = inputValue.trim()
      void add({ value: query, label: query })
      return
    }

    if (event.key === 'Escape') {
      event.stopPropagation()
      inputValue = ''
      activeIndex = 0
      dropdownOpen = false
    }
  }
</script>

<div class="flex flex-col gap-1.5">
  <div
    bind:this={containerRef}
    class="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 transition focus-within:border-cyan-500">
    <div class="flex flex-wrap items-center gap-2">
      {#each selected as item (item.value)}
        {#if chip}
          {@render chip(item, remove)}
        {:else}
          <Chip
            label={item.label}
            chipClass="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200"
            ariaLabel={i18n.t('combobox.remove', { name: item.label })}
            onRemove={() => void remove(item.value)} />
        {/if}
      {/each}
      <input
        bind:this={inputRef}
        {id}
        bind:value={inputValue}
        type="text"
        role="combobox"
        aria-expanded={dropdownOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        class="min-w-0 flex-1 bg-transparent py-1 text-sm text-slate-100 outline-none placeholder:text-slate-500"
        placeholder={selected.length === 0 ? (placeholder ?? i18n.t('combobox.placeholder')) : ''}
        autocomplete="off"
        data-escape-capture={(dropdownOpen || inputValue.trim()) ? true : undefined}
        onfocus={handleInputFocus}
        onblur={handleInputBlur}
        oninput={handleInput}
        onkeydown={handleKeydown} />
    </div>
  </div>
  {#if dropdownOpen && suggestions.length > 0}
    <div
      id={listboxId}
      role="listbox"
      aria-label={placeholder}
      use:positionPanel={() => ({ getTrigger: () => containerRef, getOpen: () => dropdownOpen })}
      data-escape-capture
      class="fixed left-0 top-0 z-40 w-64 will-change-transform max-h-52 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900/95 p-1 shadow-2xl shadow-slate-950/60 backdrop-blur">
      {#each suggestions as suggestion, index}
        <button
          type="button"
          id={optionId(index)}
          role="option"
          tabindex="-1"
          aria-selected="false"
          class={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm outline-none transition ${index === activeIndex ? 'bg-slate-800 text-cyan-200' : 'text-slate-300 hover:bg-slate-800 hover:text-cyan-200 focus:bg-slate-800 focus:text-cyan-200'}`}
          onpointerdown={e => e.preventDefault()}
          onmouseenter={() => {
            activeIndex = index
            navigated = true
          }}
          onclick={() => void add(suggestion)}>
          {#if option}
            {@render option(suggestion)}
          {:else}
            <span class="flex w-full items-center justify-between gap-2">
              <span>{suggestion.label}</span>
              {#if suggestion.detail}
                <span class="text-xs text-slate-400">{suggestion.detail}</span>
              {/if}
            </span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
