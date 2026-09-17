<script module>
  let openDialogCount = 0
</script>

<script lang="ts">
  import { browser } from '$app/environment';
  import { onDestroy, onMount, tick } from 'svelte'
  import CloseIcon from '$lib/icons/CloseIcon.svelte'
  import { getI18nContext } from '$lib/i18n.svelte'
  const i18n = getI18nContext()

  interface Props {
    title?: string
    titleClass?: string
    className?: string
    maxWidth?: 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl' | 'fit' | 'wide'
    height?: 'auto' | 'fixed' | 'tall'
    pending?: boolean
    allowPendingCancel?: boolean
    dismissKeydownCapture?: boolean
    fullscreen?: boolean
    // Overrides the i18n close-dialog label (callers that pass their own
    // strings keep working); defaults to the shared locale label.
    closeLabel?: string
    onCancel: () => void
    header?: import('svelte').Snippet
    children?: import('svelte').Snippet
  }

  let { title, titleClass = '', className = '', maxWidth = 'md', height = 'auto', pending = false, allowPendingCancel = false, dismissKeydownCapture = true, fullscreen = false, closeLabel, onCancel, header, children }: Props = $props()

  // Derived (not a plain const) so locale switches re-resolve the label.
  const resolvedCloseLabel = $derived(closeLabel ?? i18n.t('common.closeDialog'))

  // While a pending operation runs the dialog stops dismissing unless the
  // caller opts into cancel-during-pending.
  const cancelDisabled = $derived(pending && !allowPendingCancel)

  let dialogIndex = 0
  let dialogRef = $state<HTMLElement | null>(null)
  let titleId = $state('')
  let previouslyFocused: Element | null = null

  const maxWidthClasses = {
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
    '6xl': 'max-w-6xl',
    '7xl': 'max-w-7xl',
    fit: 'w-fit max-w-[90vw]',
    wide: 'w-[min(96vw,96rem)] max-w-[96rem]',
  } as const

  const heightClasses = {
    auto: '',
    fixed: 'h-[min(78vh,640px)] min-h-[480px] sm:min-h-[520px]',
    tall: 'h-[min(88vh,860px)]',
  } as const

  const sizeClass = $derived.by(() => {
    const widthClass =
      maxWidth === 'fit' || maxWidth === 'wide'
        ? maxWidthClasses[maxWidth]
        : `w-full ${maxWidthClasses[maxWidth] ?? maxWidthClasses.md}`
    const hClass = heightClasses[height ?? 'auto']
    return [widthClass, hClass].filter(Boolean).join(' ')
  })

  onMount(() => {
    openDialogCount += 1
    dialogIndex = openDialogCount
    titleId = `tts-dialog-title-${dialogIndex}`
    previouslyFocused = document.activeElement
    void tick().then(() => {
      const firstInput = dialogRef?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [autofocus]',
      )
      ;(firstInput ?? dialogRef)?.focus()
    })
  })

  onDestroy(() => {
    openDialogCount -= 1
    if (browser && previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
      previouslyFocused.focus()
    }
  })

  function isTopmostDialog() {
    return dialogIndex === openDialogCount
  }

  function handleCancelRequest() {
    if (!cancelDisabled) {
      onCancel()
    }
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
    // Cooperates with sibling overlays (drawers, nested dialogs): whoever
    // handles the key first marks it so the other listeners stand down.
    const handledEvent = event as KeyboardEvent & {
      dialogHandled?: boolean
    }

    if (handledEvent.dialogHandled) {
      return
    }

    if (event.defaultPrevented) {
      return
    }

    if (!isTopmostDialog()) {
      return
    }

    if (event.key === 'Escape' && !cancelDisabled) {
      const target = event.target
      if (target instanceof Element && target.closest('[data-escape-capture]')) {
        return
      }
      handledEvent.dialogHandled = true
      event.stopImmediatePropagation()
      event.preventDefault()
      onCancel()
    } else if (event.key === 'Tab') {
      trapFocus(event)
    }
  }

  $effect(() => {
    if (!dismissKeydownCapture) {
      return
    }
    document.addEventListener('keydown', handleWindowKeydown, true)
    return () => document.removeEventListener('keydown', handleWindowKeydown, true)
  })
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="fixed inset-0 z-40 @container tts-dialog">
  <button
    type="button"
    data-testid="dialog-overlay"
    aria-label={resolvedCloseLabel}
    tabindex="-1"
    disabled={cancelDisabled}
    class="absolute inset-0 outline-none {fullscreen ? 'bg-slate-950' : 'bg-slate-950/80'} disabled:cursor-default"
    onclick={handleCancelRequest}></button>
  <div
    class={fullscreen
      ? 'relative h-full'
      : 'relative flex min-h-full items-center justify-center px-4 py-6 @max-md:p-0'}>
    <div
      bind:this={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={!header && title ? titleId : undefined}
      tabindex="-1"
      class={fullscreen
        ? `relative flex h-full w-full flex-col overflow-y-auto bg-slate-900 p-5.5 outline-none ${className}`
        : `relative flex max-h-[90vh] flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/95 shadow-2xl shadow-slate-950/60 outline-none backdrop-blur @max-md:h-dvh @max-md:max-h-full @max-md:w-full @max-md:max-w-none @max-md:rounded-none @max-md:border-x-0 ${sizeClass} ${className}`}>
      <button
        type="button"
        aria-label={resolvedCloseLabel}
        onclick={handleCancelRequest}
        disabled={cancelDisabled}
        class="absolute right-4 top-4 flex items-center justify-center p-1.5 text-slate-500 outline-none transition hover:text-slate-200 focus:text-slate-200 motion-reduce:transition-none before:absolute before:-inset-1.5 before:content-[''] disabled:cursor-not-allowed disabled:opacity-40">
        <CloseIcon className="h-4 w-4" />
      </button>
      {#if header}
        <div class="px-5.5 pt-5.5">{@render header()}</div>
      {:else if title}
        <h2 id={titleId} class="pl-5.5 pr-12 pt-5.5 text-2xl font-semibold tracking-tight text-slate-100 {titleClass}">{title}</h2>
      {/if}
      <div tabindex="-1" class="mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto px-5.5 pb-5.5 outline-none">
        {@render children?.()}
      </div>
    </div>
  </div>
</div>
