<script module lang="ts">
  export type ToastPosition = 'top-right' | 'top-center' | 'bottom-right' | 'bottom-center'
  export type ToastSize = 'sm' | 'md'
  export type ToastType = 'success' | 'info' | 'warning' | 'error'
</script>

<script lang="ts">
  import Button from './Button.svelte'
  import CloseIcon from '$lib/icons/CloseIcon.svelte'

  interface Props {
    message: string
    closeLabel: string
    position?: ToastPosition
    size?: ToastSize
    type?: ToastType
    onClose: () => void
  }

  let { message, closeLabel, position = 'bottom-right', size = 'sm', type = 'info', onClose }: Props = $props()

  // Viewport-edge positions in the ToastifierJS style: corners and top/bottom
  // center. On phone widths the toast spans the viewport with safe margins;
  // from `sm` up it docks to the chosen edge.
  const positionClasses: Record<ToastPosition, string> = {
    'top-right': 'top-4 inset-x-4 sm:inset-x-auto sm:top-4 sm:right-4 sm:w-96',
    'top-center': 'top-4 inset-x-4 sm:inset-x-auto sm:top-4 sm:left-1/2 sm:w-96 sm:-translate-x-1/2',
    'bottom-right': 'bottom-4 inset-x-4 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-96',
    'bottom-center': 'bottom-4 inset-x-4 sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:w-96 sm:-translate-x-1/2',
  }

  const sizeClasses: Record<ToastSize, string> = {
    sm: 'text-sm leading-5',
    md: 'text-base leading-6',
  }

  const typeClasses: Record<ToastType, string> = {
    success:
      'border border-transparent border-l-8 border-l-[var(--toast-success-border)] bg-[var(--toast-success-bg)] text-[var(--toast-success-fg)]',
    info:
      'border border-transparent border-l-8 border-l-[var(--toast-info-border)] bg-[var(--toast-info-bg)] text-[var(--toast-info-fg)]',
    warning:
      'border border-transparent border-l-8 border-l-[var(--toast-warning-border)] bg-[var(--toast-warning-bg)] text-[var(--toast-warning-fg)]',
    error:
      'border border-transparent border-l-8 border-l-[var(--toast-error-border)] bg-[var(--toast-error-bg)] text-[var(--toast-error-fg)]',
  }

  // Escape dismisses the toast. Dialogs consume Escape first in the capture
  // phase and stop propagation, so an open dialog keeps precedence.
  $effect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  })
</script>

<div
  role="status"
  aria-live="polite"
  class={`fixed z-40 flex items-start gap-3 rounded-md px-4 py-3 shadow-lg shadow-slate-950/25 backdrop-blur-sm ${typeClasses[type]} ${positionClasses[position]}`}>
  <p class={`min-w-0 flex-1 font-medium ${sizeClasses[size]}`}>{message}</p>
  <Button
    variant="ghost"
    size="sm"
    ariaLabel={closeLabel}
    onClick={onClose}
    className="-mr-1 -mt-1 shrink-0 opacity-75 hover:opacity-100">
    {#snippet icon()}
      <CloseIcon className="h-4 w-4" />
    {/snippet}
  </Button>
</div>
