<script lang="ts">
  import ChevronUpSmallIcon from '$lib/icons/ChevronUpSmallIcon.svelte'
  import ChevronDownSmallIcon from '$lib/icons/ChevronDownSmallIcon.svelte'

  interface Props {
    value: string
    min?: number
    max?: number
    step?: number
    placeholder?: string
    disabled?: boolean
    className?: string
    showControls?: boolean
    id?: string
    ariaLabel: string
    incrementLabel?: string
    decrementLabel?: string
    onkeydown?: (event: KeyboardEvent) => void
    oninput?: (event: Event) => void
    onblur?: (event: FocusEvent) => void
  }

  let {
    value = $bindable(),
    min,
    max,
    step = 1,
    placeholder,
    disabled = false,
    className = '',
    showControls = true,
    id,
    ariaLabel,
    incrementLabel,
    decrementLabel,
    onkeydown,
    oninput,
    onblur,
  }: Props = $props()

  let inputEl = $state<HTMLInputElement | null>(null)

  export function focus() {
    inputEl?.focus()
  }

  const currentValue = $derived(Number.parseFloat(value))
  const isAtMax = $derived(max !== undefined && !Number.isNaN(currentValue) && currentValue >= max)
  const isAtMin = $derived(min !== undefined && !Number.isNaN(currentValue) && currentValue <= min)

  function handleInput(event: Event) {
    const input = event.target as HTMLInputElement
    let newValue = input.value.replace(/[^0-9.-]/g, '')

    if (min !== undefined && min >= 0) {
      newValue = newValue.replace(/-/g, '')
    }

    const decimalCount = (newValue.match(/\./g) || []).length
    if (decimalCount > 1) {
      newValue = newValue.replace(/\.(?=.*\.)/g, '')
    }

    if (newValue.indexOf('-') > 0) {
      newValue = newValue.replace(/-/g, '')
    }

    input.value = newValue
    value = newValue
  }

  function handleBlur(event: FocusEvent) {
    const input = event.target as HTMLInputElement
    const numValue = Number.parseFloat(input.value)
    if (input.value === '' || Number.isNaN(numValue)) {
      onblur?.(event)
      return
    }
    let clamped = numValue
    if (min !== undefined && clamped < min) {
      clamped = min
    }
    if (max !== undefined && clamped > max) {
      clamped = max
    }
    if (clamped !== numValue) {
      const next = String(clamped)
      input.value = next
      value = next
    }
    onblur?.(event)
  }

  function adjust(direction: 1 | -1) {
    if (disabled) {
      return
    }
    const current = Number.parseFloat(value)
    const base = Number.isNaN(current) ? (min ?? 0) : current
    let next = base + direction * step
    if (min !== undefined && next < min) {
      next = min
    }
    if (max !== undefined && next > max) {
      next = max
    }
    value = String(next)
    if (inputEl) {
      inputEl.value = String(next)
      inputEl.dispatchEvent(new Event('input', { bubbles: true }))
      inputEl.focus()
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      adjust(1)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      adjust(-1)
    }
    onkeydown?.(event)
  }
</script>

<div
  class={`flex items-stretch ${showControls ? 'overflow-hidden rounded-lg border border-slate-700 bg-slate-950 transition focus-within:border-cyan-500' : ''}`}>
  <input
    bind:this={inputEl}
    {id}
    type="text"
    inputmode="numeric"
    {placeholder}
    {disabled}
    aria-label={ariaLabel}
    {value}
    oninput={e => {
      handleInput(e)
      oninput?.(e)
    }}
    onblur={handleBlur}
    onkeydown={handleKeydown}
    class={`flex-1 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-500 disabled:opacity-40 ${showControls ? 'min-w-0 border-0 bg-transparent' : ''} ${className}`} />
  {#if showControls}
    <div class="flex flex-col">
      <button
        type="button"
        onclick={() => adjust(1)}
        disabled={disabled || isAtMax}
        tabindex="-1"
        aria-label={incrementLabel || ariaLabel}
        class="flex flex-1 items-center justify-center border-b border-slate-700 bg-slate-900 px-1 text-slate-400 outline-none transition hover:text-cyan-300 focus:text-cyan-300 disabled:opacity-40">
        <ChevronUpSmallIcon className="h-3 w-3" />
      </button>
      <button
        type="button"
        onclick={() => adjust(-1)}
        disabled={disabled || isAtMin}
        tabindex="-1"
        aria-label={decrementLabel || ariaLabel}
        class="flex flex-1 items-center justify-center bg-slate-900 px-1 text-slate-400 outline-none transition hover:text-cyan-300 focus:text-cyan-300 disabled:opacity-40">
        <ChevronDownSmallIcon className="h-3 w-3" />
      </button>
    </div>
  {/if}
</div>
