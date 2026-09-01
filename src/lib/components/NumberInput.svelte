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
  let pointerFocused = false

  export function focus() {
    inputEl?.focus()
  }

  function moveCaretToEndIfKeyboardFocus(event: FocusEvent) {
    const input = event.currentTarget as HTMLInputElement
    if (pointerFocused) {
      pointerFocused = false
      return
    }
    queueMicrotask(() => {
      if (document.activeElement !== input) return
      const end = input.value.length
      input.setSelectionRange(end, end)
    })
  }

  const currentValue = $derived(Number.parseFloat(value))
  const isAtMax = $derived(max !== undefined && !Number.isNaN(currentValue) && currentValue >= max)
  const isAtMin = $derived(min !== undefined && !Number.isNaN(currentValue) && currentValue <= min)
  const inputType = $derived(step !== undefined && !Number.isInteger(step) ? 'decimal' : 'numeric')

  function stepDecimals() {
    if (step === undefined) return 0
    const s = String(step)
    if (s.includes('e-')) {
      const parts = s.split('e-')
      return Number(parts[1] ?? 0)
    }
    const dot = s.indexOf('.')
    return dot === -1 ? 0 : s.length - dot - 1
  }

  function snapToStep(val: number): number {
    if (step === undefined || min === undefined) return val
    const decimals = stepDecimals()
    const steps = Math.round((val - min) / step)
    const snapped = min + steps * step
    const clampedSnap =
      max !== undefined ? Math.min(max, Math.max(min, snapped)) : snapped
    return Number(clampedSnap.toFixed(decimals))
  }

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
    const snapped = snapToStep(clamped)
    const finalValue = snapped !== numValue ? snapped : clamped !== numValue ? clamped : null
    if (finalValue !== null) {
      const decimals = stepDecimals()
      const next = decimals > 0 ? String(Number(finalValue.toFixed(decimals))) : String(finalValue)
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
    next = snapToStep(next)
    // Ensure fixed decimals for display consistency when step has decimals
    const decimals = stepDecimals()
    const nextStr = decimals > 0 ? String(Number(next.toFixed(decimals))) : String(next)
    value = nextStr
    if (inputEl) {
      inputEl.value = nextStr
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
  class={`flex items-stretch ${showControls ? 'overflow-hidden rounded-lg border border-slate-700 bg-slate-950 transition motion-reduce:transition-none focus-within:border-cyan-500' : ''}`}>
  <input
    bind:this={inputEl}
    {id}
    type="text"
    inputmode={inputType}
    {placeholder}
    {disabled}
    aria-label={ariaLabel}
    {value}
    onpointerdown={() => {
      pointerFocused = true
    }}
    onpointerup={() => {
      queueMicrotask(() => {
        pointerFocused = false
      })
    }}
    onpointercancel={() => {
      pointerFocused = false
    }}
    onfocus={moveCaretToEndIfKeyboardFocus}
    oninput={e => {
      handleInput(e)
      oninput?.(e)
    }}
    onblur={handleBlur}
    onkeydown={handleKeydown}
    class={`flex-1 px-3 py-2 text-sm text-slate-100 outline-none transition motion-reduce:transition-none disabled:opacity-40 ${showControls ? 'min-w-0 border-0 bg-transparent' : ''} ${className}`} />
  {#if showControls}
    <div class="flex flex-col">
      <button
        type="button"
        onclick={() => adjust(1)}
        disabled={disabled || isAtMax}
        aria-label={incrementLabel || ariaLabel}
        class="flex flex-1 items-center justify-center border-b border-slate-700 bg-slate-900 px-1 text-slate-400 outline-none transition motion-reduce:transition-none hover:text-cyan-300 focus:text-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-inset disabled:opacity-40">
        <ChevronUpSmallIcon className="h-3 w-3" />
      </button>
      <button
        type="button"
        onclick={() => adjust(-1)}
        disabled={disabled || isAtMin}
        aria-label={decrementLabel || ariaLabel}
        class="flex flex-1 items-center justify-center bg-slate-900 px-1 text-slate-400 outline-none transition motion-reduce:transition-none hover:text-cyan-300 focus:text-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-inset disabled:opacity-40">
        <ChevronDownSmallIcon className="h-3 w-3" />
      </button>
    </div>
  {/if}
</div>
