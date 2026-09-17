<script lang="ts">
  import { flushSync, tick, type Snippet } from 'svelte'
  import CloseIcon from '$lib/icons/CloseIcon.svelte'
  import { DEFAULT_CHIP_PANEL_CLASS } from '$lib/dropdown-chrome'
  import { positionPanel } from '$lib/position-panel.svelte'
  import { createFocusoutClose } from '$lib/actions/use-focusout-close'
  import { useDropdown } from '$lib/actions/use-dropdown.svelte'
  import { useListSelection, revealInScrollport } from '$lib/actions/use-list-selection.svelte'
  import { getI18nContext } from '$lib/i18n.svelte'

  interface Props {
    value?: string[]
    availableTags?: string[]
    onChange?: (next: string[]) => void
    placeholder?: string
    disabled?: boolean
    inputId?: string
    chipClass?: string
    chipClassFor?: (tag: string) => string
    chip?: Snippet<[tag: string, remove: () => void]>
    option?: Snippet<[tag: string]>
  }

  let { value = [], availableTags = [], onChange, placeholder = '', disabled = false, inputId, chipClass = 'border-slate-600 bg-slate-800 text-slate-200', chipClassFor, chip, option }: Props = $props()
  const i18n = getI18nContext()

  let id = $props.id()
  const listboxId = `${id}-tag-suggestions`

  let draft = $state('')
  let open = $state(false)
  let navigated = false
  let inputRef = $state<HTMLInputElement | null>(null)
  let containerRef = $state<HTMLDivElement | null>(null)
  let panelRef = $state<HTMLDivElement | null>(null)
  const selection = useListSelection(0)

  const query = $derived(draft.trim().toLowerCase())
  const suggestions = $derived.by(() => {
    const selected = new Set(value.map((tag) => tag.toLowerCase()))
    return availableTags.filter(
      (tag) => !selected.has(tag.toLowerCase()) && (!query || tag.toLowerCase().includes(query)),
    )
  })

  // Reset the highlight whenever the visible suggestion list changes
  // (filter typing, add/remove) so arrows never start from a stale row.
  let lastSuggestions: string[] | null = null
  $effect(() => {
    if (!open) return
    if (lastSuggestions !== suggestions) {
      lastSuggestions = suggestions
      selection.reset()
    }
  })

  $effect(() => {
    if (!open) return
    selection.clamp(suggestions.length)
  })

  export function focus(): void {
    inputRef?.focus()
  }

  function emit(): void {
    onChange?.([...value])
  }

  function addName(name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    if (value.some((tag) => tag.toLowerCase() === trimmed.toLowerCase())) return
    value = [...value, trimmed]
    emit()
  }

  function commitDraft(): void {
    const names = draft
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    draft = ''
    navigated = false
    if (!names.length) return
    const seen = new Set(value.map((tag) => tag.toLowerCase()))
    const next = [...value]
    for (const name of names) {
      if (seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())
      next.push(name)
    }
    value = next
    emit()
  }

  function addSuggestion(tag: string): void {
    draft = ''
    navigated = false
    addName(tag)
    tick().then(() => inputRef?.focus())
  }

  function removeAt(index: number): void {
    value = value.filter((_, i) => i !== index)
    emit()
    tick().then(() => inputRef?.focus())
  }

  function openPanel(): void {
    if (disabled) return
    lastSuggestions = suggestions
    selection.reset()
    open = true
  }

  // Keep the highlighted option visible while arrowing through the panel:
  // the option never receives focus (aria-activedescendant pattern), so the
  // browser would otherwise let it drift out of the scrollport.
  function revealActive(): void {
    revealInScrollport(panelRef?.querySelector<HTMLButtonElement>(`[id="${listboxId}-option-${selection.peek()}"]`))
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      if (event.key === 'Enter' && open && navigated && suggestions.length > 0) {
        addSuggestion(suggestions[selection.index] ?? suggestions[0])
        return
      }
      commitDraft()
    } else if (event.key === 'Backspace' && !draft && value.length > 0) {
      removeAt(value.length - 1)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) {
        flushSync(() => {
          openPanel()
        })
        return
      }
      navigated = true
      flushSync(() => {
        selection.move('down', suggestions.length)
        revealActive()
      })
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        flushSync(() => {
          openPanel()
          selection.move('last', suggestions.length)
        })
        return
      }
      navigated = true
      flushSync(() => {
        selection.move('up', suggestions.length)
        revealActive()
      })
    } else if (event.key === 'Home' || event.key === 'End') {
      if (open && suggestions.length > 0) {
        event.preventDefault()
        navigated = true
        flushSync(() => {
          selection.move(event.key === 'Home' ? 'first' : 'last', suggestions.length)
          revealActive()
        })
      }
    }
  }

  const handleFocusOut = createFocusoutClose(
    () => open,
    () => ({ container: containerRef, panel: panelRef }),
    () => {
      commitDraft()
      open = false
    },
  )

  useDropdown(() => ({
    isOpen: () => open,
    container: () => containerRef,
    onOutsideClick: () => {
      commitDraft()
      open = false
    },
    onEscape: () => {
      if (draft) {
        draft = ''
        navigated = false
        return
      }
      open = false
    },
    onScrollClose: () => {
      open = false
    },
    panel: () => panelRef,
  }))
</script>

<div
  bind:this={containerRef}
  data-escape-capture={open ? '' : null}
  onfocusout={handleFocusOut}
  class="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 transition focus-within:border-cyan-500">
  <div class="flex flex-wrap items-center gap-1.5">
    {#each value as tag, index (tag.toLowerCase())}
      {#if chip}
        {@render chip(tag, () => removeAt(index))}
      {:else}
        <span class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs {chipClassFor?.(tag) ?? chipClass}">
          {tag}
          <button
            type="button"
            aria-label={i18n.t('tagInput.remove', { name: tag })}
            disabled={disabled}
            onclick={() => removeAt(index)}
            class="rounded-full p-0.5 opacity-60 outline-none transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-40">
            <CloseIcon className="h-3 w-3" />
          </button>
        </span>
      {/if}
    {/each}
    <input
      bind:this={inputRef}
      id={inputId}
      class="min-w-24 flex-1 bg-transparent py-0.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"
      bind:value={draft}
      {placeholder}
      {disabled}
      type="text"
      role="combobox"
      aria-label={placeholder}
      aria-expanded={open}
      aria-controls={listboxId}
      aria-autocomplete="list"
      aria-activedescendant={open && suggestions.length > 0 ? `${listboxId}-option-${selection.index}` : undefined}
      autocomplete="off"
      onfocus={() => { if (!open) openPanel() }}
      oninput={() => { navigated = false }}
      onkeydown={handleKeydown} />
  </div>
</div>
{#if open && suggestions.length > 0}
  <div
    bind:this={panelRef}
    id={listboxId}
    role="listbox"
    aria-label={i18n.t('tagInput.suggestions')}
    use:positionPanel={() => ({ getTrigger: () => containerRef, getOpen: () => open })}
    class={DEFAULT_CHIP_PANEL_CLASS}>
    {#each suggestions as suggestion, index (suggestion.toLowerCase())}
      <button
        type="button"
        id={`${listboxId}-option-${index}`}
        role="option"
        tabindex="-1"
        aria-selected={index === selection.index}
        class="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-sm outline-none transition max-[27.999rem]:min-h-11 {index === selection.index ? 'bg-slate-800 text-cyan-200' : 'text-slate-300 hover:bg-slate-800 hover:text-cyan-200 focus:bg-slate-800 focus:text-cyan-200'}"
        onpointerdown={(e) => e.preventDefault()}
        onmouseenter={() => {
          navigated = true
          selection.set(index)
        }}
        onclick={() => addSuggestion(suggestion)}>
        {#if option}
          {@render option(suggestion)}
        {:else}
          <span class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs {chipClassFor?.(suggestion) ?? chipClass}">{suggestion}</span>
        {/if}
      </button>
    {/each}
  </div>
{/if}
