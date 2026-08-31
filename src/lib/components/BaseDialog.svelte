<script module>
  let openDialogCount = 0
</script>

<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import CloseIcon from '$lib/icons/CloseIcon.svelte'

  interface Props {
    title?: string
    className?: string
    maxWidth?: 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '6xl' | '7xl' | 'fit'
    closeLabel: string
    onCancel: () => void
    children?: import('svelte').Snippet
  }

  let { title, className = '', maxWidth = 'md', closeLabel, onCancel, children }: Props = $props()

  let dialogIndex = 0
  let dialogRef = $state<HTMLElement | null>(null)
  let titleId = $state('')
  let previouslyFocused: Element | null = null

  const maxWidthClasses = {
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '4xl': 'max-w-4xl',
    '6xl': 'max-w-6xl',
    '7xl': 'max-w-7xl',
    fit: 'w-fit max-w-[90vw]',
  } as const

  const sizeClass = $derived(maxWidth === 'fit' ? maxWidthClasses.fit : `w-full ${maxWidthClasses[maxWidth]}`)

  onMount(() => {
    openDialogCount += 1
    dialogIndex = openDialogCount
    titleId = `tts-dialog-title-${dialogIndex}`
    previouslyFocused = document.activeElement
    void tick().then(() => {
      dialogRef?.focus()
    })
  })

  onDestroy(() => {
    openDialogCount -= 1
    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
      previouslyFocused.focus()
    }
  })

  function isTopmostDialog() {
    return dialogIndex === openDialogCount
  }

  function handleCancelRequest() {
    onCancel()
  }

  function trapFocus(event: KeyboardEvent) {
    if (!dialogRef) return
    const focusable = dialogRef.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (!dialogRef.contains(active)) {
      event.preventDefault()
      first.focus()
    } else if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (!isTopmostDialog()) {
      return
    }
    if (event.defaultPrevented) {
      return
    }
    if (event.key === 'Escape') {
      const target = event.target
      if (target instanceof Element && target.closest('[data-escape-capture]')) {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      onCancel()
      return
    }
    if (event.key === 'Tab') {
      trapFocus(event)
    }
  }

  $effect(() => {
    document.addEventListener('keydown', handleWindowKeydown, true)
    return () => document.removeEventListener('keydown', handleWindowKeydown, true)
  })
</script>

<div class="fixed inset-0 z-40 @container">
  <button
    type="button"
    aria-label={closeLabel}
    class="absolute inset-0 bg-slate-950/80 outline-none"
    onclick={handleCancelRequest}></button>
  <div class="relative flex min-h-full items-center justify-center px-3 py-4 @max-md:p-0">
    <div
      bind:this={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      tabindex="-1"
      class={`relative flex max-h-[90vh] flex-col overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/95 p-4 shadow-2xl shadow-slate-950/60 outline-none backdrop-blur @max-md:h-dvh @max-md:max-h-full @max-md:w-full @max-md:max-w-none @max-md:rounded-none @max-md:border-x-0 ${sizeClass} ${className}`}>
      <button
        type="button"
        aria-label={closeLabel}
        onclick={handleCancelRequest}
        class="absolute right-3 top-3 flex items-center justify-center p-1 text-slate-500 outline-none transition hover:text-slate-100 focus:text-slate-100 motion-reduce:transition-none before:absolute before:-inset-1.5 before:content-['']">
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
      {#if title}
        <h2 id={titleId} class="pr-8 text-lg font-semibold tracking-tight text-slate-100">{title}</h2>
      {/if}
      <div class="mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto">
        {@render children?.()}
      </div>
    </div>
  </div>
</div>
