<script lang="ts">
  import type { Snippet } from 'svelte'
  import Tooltip from './Tooltip.svelte'

  interface Props {
    variant?: 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost'
    accent?: 'cyan' | 'emerald' | 'amber' | 'violet' | 'rose'
    size?: 'sm' | 'md'
    disabled?: boolean
    pending?: boolean
    type?: 'button' | 'submit' | 'reset'
    className?: string
    ariaPressed?: boolean
    onClick?: (event: MouseEvent) => void
    onKeyDown?: (event: KeyboardEvent) => void
    preventFocusSteal?: boolean
    ariaLabel?: string
    ariaExpanded?: boolean
    tooltip?: string
    tooltipAlign?: 'center' | 'left' | 'right'
    badge?: string | number
    icon?: Snippet
    children?: Snippet
    buttonEl?: HTMLButtonElement | null
  }

  let {
    variant = 'secondary',
    accent = 'cyan',
    size = 'md',
    disabled = false,
    pending = false,
    type = 'button',
    className = '',
    onClick,
    onKeyDown,
    preventFocusSteal = false,
    ariaLabel,
    ariaPressed,
    ariaExpanded,
    tooltip,
    tooltipAlign = 'center',
    badge,
    icon,
    children,
    buttonEl = $bindable<HTMLButtonElement | null>(null),
  }: Props = $props()

  const primaryClasses: Record<string, string> = {
    cyan: 'bg-cyan-500 text-onaccent hover:bg-cyan-400 focus:bg-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-500',
    emerald: 'bg-emerald-500 text-onaccent hover:bg-emerald-400 focus:bg-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-500',
    amber: 'bg-amber-500 text-onaccent hover:bg-amber-400 focus:bg-amber-400 focus-visible:ring-2 focus-visible:ring-amber-500',
    violet: 'bg-violet-500 text-onaccent hover:bg-violet-400 focus:bg-violet-400 focus-visible:ring-2 focus-visible:ring-violet-500',
    rose: 'bg-rose-500 text-onaccent hover:bg-rose-400 focus:bg-rose-400 focus-visible:ring-2 focus-visible:ring-rose-500',
  }

  const outlineClasses: Record<string, string> = {
    cyan: 'border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:border-cyan-400 hover:text-cyan-100 focus:border-cyan-400 focus:text-cyan-100 focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-cyan-500',
    emerald:
      'border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:border-emerald-400 hover:text-emerald-100 focus:border-emerald-400 focus:text-emerald-100 focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-emerald-500',
    amber: 'border border-amber-500/40 bg-amber-500/10 text-amber-200 hover:border-amber-400 hover:text-amber-100 focus:border-amber-400 focus:text-amber-100 focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-amber-500',
    violet:
      'border border-violet-500/40 bg-violet-500/10 text-violet-200 hover:border-violet-400 hover:text-violet-100 focus:border-violet-400 focus:text-violet-100 focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-violet-500',
    rose: 'border border-rose-500/40 bg-rose-500/10 text-rose-200 hover:border-rose-400 hover:text-rose-100 focus:border-rose-400 focus:text-rose-100 focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-rose-500',
  }

  const iconSizeClass = $derived(size === 'sm' ? 'h-4 w-4' : 'h-5 w-5')

  const disabledState = $derived(disabled || pending)

  const badgeClasses: Record<string, string> = {
    cyan: 'bg-cyan-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    violet: 'bg-violet-500',
    rose: 'bg-rose-500',
  }

  // Count pill overhanging the button's top-right corner; omit the prop to hide it.
  const hasBadge = $derived(badge !== undefined && badge !== null && badge !== '')

  const isIconOnly = $derived(!!icon && !children)

  // `relative` anchors the `before:` hit-area expansion that brings every size
  // to the 44px touch target: do not remove it, and callers must not pass
  // position utilities via `className` (`relative` outranks `absolute` in the
  // stylesheet, so the override silently loses). Position the Button with a wrapper or in-flow layout instead.
  const baseClass = $derived.by(() => {
    const common = isIconOnly
      ? `${size === 'sm' ? 'p-1.5 relative inline-flex items-center justify-center rounded-md before:absolute before:-inset-2 before:content-[\'\']' : 'relative inline-flex items-center justify-center rounded-lg p-2.5 before:absolute before:-inset-0.5 before:content-[\'\']'} cursor-pointer outline-none transition motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-40`
      : `${size === 'sm' ? 'px-2.5 py-1.5 text-sm relative inline-flex items-center justify-center rounded-md before:absolute before:-inset-1.5 before:content-[\'\']' : 'relative inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold before:absolute before:-inset-0.5 before:content-[\'\']'} cursor-pointer outline-none transition motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-40`
    if (variant === 'primary') {
      return `${common} ${primaryClasses[accent]}`
    }
    if (variant === 'danger') {
      return `${common} bg-rose-500 text-onaccent hover:bg-rose-400 focus:bg-rose-400 focus-visible:ring-2 focus-visible:ring-rose-500`
    }
    if (variant === 'outline') {
      return `${common} ${outlineClasses[accent]}`
    }
    if (variant === 'ghost') {
      return `${common} text-slate-400 hover:text-cyan-300 focus:text-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-500`
    }
    if (size === 'sm') {
      return `${common} border border-slate-700 bg-slate-950 text-slate-200 hover:border-cyan-500 hover:text-cyan-300 focus:border-cyan-500 focus:text-cyan-300 focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-cyan-500`
    }
    return `${common} border border-slate-700 bg-slate-950 hover:border-slate-500 hover:text-slate-100 focus:border-slate-500 focus:text-slate-100 focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-cyan-500`
  })

  function handlePreventFocusSteal(event: PointerEvent) {
    event.preventDefault()
  }

  let triggerEl = $state<HTMLElement | null>(null)
</script>

{#snippet buttonInner()}
  {#if icon}
    <span class="inline-flex items-center gap-2">
      <span class={`${iconSizeClass} [&_svg]:h-full [&_svg]:w-full`}>{@render icon()}</span>
      {@render children?.()}
    </span>
  {:else}
    {@render children?.()}
  {/if}
{/snippet}

  {#snippet buttonElement()}
    <button bind:this={buttonEl} {type} aria-label={ariaLabel} aria-pressed={ariaPressed} aria-expanded={ariaExpanded} onclick={onClick} onkeydown={onKeyDown} onpointerdown={preventFocusSteal ? handlePreventFocusSteal : undefined} disabled={disabledState} class={`${baseClass} ${hasBadge ? 'relative' : ''} ${className}`}>
      {@render buttonInner()}
      {#if hasBadge}
        <span class={`absolute -top-2 -right-2 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold text-slate-950 ${badgeClasses[accent]}`}>{badge}</span>
      {/if}
    </button>
  {/snippet}

{#if tooltip}
  <span bind:this={triggerEl} class="group relative inline-flex">
    {@render buttonElement()}
    <Tooltip align={tooltipAlign} trigger={triggerEl}>{tooltip}</Tooltip>
  </span>
{:else}
  {@render buttonElement()}
{/if}
