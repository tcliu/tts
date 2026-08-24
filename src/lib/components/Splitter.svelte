<script lang="ts">
  interface Props {
    value: number
    min: number
    max: number
    onChange: (value: number) => void
    onDragEnd?: () => void
    ariaLabel?: string
    className?: string
    lineClass?: string
    unit?: 'px' | '%'
    orientation?: 'vertical' | 'horizontal'
  }

  let {
    value,
    min,
    max,
    onChange,
    onDragEnd,
    ariaLabel = 'Resize panes',
    className = '',
    lineClass = '',
    unit = 'px',
    orientation = 'vertical',
  }: Props = $props()

  let handleRef = $state<HTMLElement | null>(null)
  let dragging = $state(false)
  let startPos = 0
  let startValue = 0
  let containerSize = 0

  function clamp(next: number) {
    return Math.min(max, Math.max(min, next))
  }

  function deltaToUnits(deltaPos: number) {
    if (unit === '%') {
      return containerSize > 0 ? (deltaPos / containerSize) * 100 : 0
    }
    return deltaPos
  }

  function handlePointerDown(event: PointerEvent) {
    dragging = true
    startPos = orientation === 'vertical' ? event.clientX : event.clientY
    startValue = value
    const parent = handleRef?.parentElement
    containerSize = orientation === 'vertical' ? (parent?.clientWidth ?? 0) : (parent?.clientHeight ?? 0)
    handleRef?.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function handlePointerMove(event: PointerEvent) {
    if (!dragging) return
    const pos = orientation === 'vertical' ? event.clientX : event.clientY
    onChange(clamp(startValue + deltaToUnits(pos - startPos)))
  }

  function handlePointerUp(event: PointerEvent) {
    if (!dragging) return
    dragging = false
    if (handleRef?.hasPointerCapture(event.pointerId)) {
      handleRef.releasePointerCapture(event.pointerId)
    }
    onDragEnd?.()
  }

  function handlePointerCancel() {
    if (!dragging) return
    dragging = false
    onDragEnd?.()
  }

  function handleKeydown(event: KeyboardEvent) {
    let delta = 0
    const positiveKey = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown'
    const negativeKey = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp'
    if (event.key === negativeKey) {
      delta = unit === '%' ? -1 : -16
    } else if (event.key === positiveKey) {
      delta = unit === '%' ? 1 : 16
    } else if (event.key === 'Home') {
      onChange(min)
      onDragEnd?.()
      return
    } else if (event.key === 'End') {
      onChange(max)
      onDragEnd?.()
      return
    } else {
      return
    }
    event.preventDefault()
    onChange(clamp(value + delta))
    onDragEnd?.()
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  bind:this={handleRef}
  role="separator"
  aria-orientation={orientation}
  aria-label={ariaLabel}
  aria-valuenow={value}
  aria-valuemin={min}
  aria-valuemax={max}
  tabindex="0"
  class={`relative shrink-0 touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${orientation === 'vertical' ? '-mx-1.5 w-3' : '-my-1.5 h-3'} ${orientation === 'vertical' ? 'cursor-col-resize' : 'cursor-row-resize'} ${className}`}
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointercancel={handlePointerCancel}
  onkeydown={handleKeydown}>
  {#if orientation === 'vertical'}
    <span class={`absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 cursor-col-resize ${lineClass}`}></span>
  {:else}
    <span class={`absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 cursor-row-resize ${lineClass}`}></span>
  {/if}
</div>
