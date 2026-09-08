<script lang="ts">
  import { onDestroy, tick } from 'svelte'
  import Button from './Button.svelte'
  import EditIcon from '$lib/icons/EditIcon.svelte'
  import { getI18nContext } from '$lib/i18n.svelte'
  import { TEXT_SIZE, type TextSize } from '$lib/text-size'

  interface Props {
    text: string
    // Return false to reject the committed value (e.g. duplicate name);
    // the component then restores the previous text and keeps editing.
    onChange: (text: string) => void | boolean
    size?: TextSize
    className?: string
    onActivate?: () => void
    // maximum width (in px) the editable input may expand to; actual max
    // will be clamped to the remaining horizontal space when editing.
    maxWidth?: number
  }

  let {
    text,
    onChange,
    size = 'md',
    className = 'text-slate-200',
    onActivate,
    maxWidth = 320,
  }: Props = $props()

  const i18n = getI18nContext()

  let editing = $state(false)
  let value = $state('')
  let cancelled = $state(false)
  let input = $state<HTMLInputElement | null>(null)
  let displayBtn = $state<HTMLButtonElement | null>(null)
  let editBtn = $state<HTMLElement | null>(null)
  let inputWidth = $state<number | null>(null)
  let computedMaxWidth = $state<number | null>(null)
  let clickTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleActivate() {
    if (editing || !onActivate) return
    clickTimer = setTimeout(() => onActivate(), 250)
  }

  function startEdit() {
    if (clickTimer) {
      clearTimeout(clickTimer)
      clickTimer = null
    }
    cancelled = false
    value = text
    // Measure the rendered label and edit-button widths so the input can
    // size to "label width + gap + edit icon width" when editing starts.
    // We measure before switching to edit mode because the display elements
    // are replaced when editing becomes true.
    try {
      const labelRect = displayBtn?.getBoundingClientRect()
      const editRect = editBtn?.getBoundingClientRect()
      const gapPx = 4 // Tailwind gap-1 is 0.25rem -> 4px at 16px root
      if (labelRect) {
        inputWidth = Math.ceil(labelRect.width + (editRect?.width ?? 0) + gapPx)
      } else {
        inputWidth = null
      }
      // Compute the remaining horizontal width so the editable input's max
      // width is the lesser of the `maxWidth` prop and available space.
      // Measured from the viewport's right edge (the header row spans the
      // full width), so no ancestor walk is needed.
      try {
        if (labelRect) {
          // Reserve room for sibling action buttons (e.g. delete) + padding.
          const reserved = 48
          const viewportRight = document.documentElement.clientWidth
          const remaining = Math.max(0, Math.floor(viewportRight - labelRect.left - reserved))
          computedMaxWidth = Math.min(maxWidth, remaining)
        } else {
          computedMaxWidth = maxWidth
        }
      } catch (e) {
        computedMaxWidth = maxWidth
      }
    } catch (e) {
      inputWidth = null
    }
    editing = true
  }

  function handleTextDoubleClick(event: MouseEvent) {
    event.preventDefault()
    startEdit()
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      cancelled = true
      editing = false
    } else if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    }
  }

  function commit() {
    if (cancelled) return
    const next = value.trim()
    if (!next || next === text) {
      editing = false
      return
    }
    const accepted = onChange(next)
    if (accepted === false) {
      value = text
      return
    }
    editing = false
  }

  $effect(() => {
    if (!editing) return
    void tick().then(() => input?.focus())
  })

  // Auto-resize the input to fit its content while editing, but don't shrink
  // below the initially measured label+icon width and cap at a sensible max.
  $effect(() => {
    if (!editing || !input) return
    // Depend on value so this effect runs as the user types.
    void value
    try {
      // Temporarily collapse width to let scrollWidth reflect content width.
      input.style.width = '0px'
      const contentWidth = input.scrollWidth
      // Account for horizontal padding (px-2 -> 0.5rem each side ~= 8px at 16px root)
      const paddingExtra = 16
      const base = inputWidth ?? 0
      const max = computedMaxWidth ?? maxWidth
      const next = Math.min(max, Math.max(base, contentWidth + paddingExtra))
      input.style.width = `${next}px`
      inputWidth = next
    } catch (e) {
      // ignore measurement errors
    }
  })

  onDestroy(() => {
    if (clickTimer) clearTimeout(clickTimer)
  })
</script>

  {#if editing}
  <!-- In edit mode size the input to the measured label+icon width so
       sibling tag chips don't shift. Fallback to min-width only if we
       couldn't measure. -->
  <div class="flex min-w-0 items-center">
    <input
      bind:this={input}
      bind:value={value}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { e.stopPropagation(); handleKeydown(e) }}
      onblur={commit}
      data-escape-capture
      aria-label={i18n.t('editor.editText')}
      style={inputWidth ? `width: ${inputWidth}px; min-width: 0` : 'min-width: 0'}
      class={`${TEXT_SIZE[size]} max-w-full rounded-md bg-slate-950 px-2 py-1 text-slate-100 outline outline-1 outline-slate-700 transition motion-reduce:transition-none focus:outline-cyan-500`} />
  </div>
{:else}
  {#snippet displayContent()}
    <button
      bind:this={displayBtn}
      type="button"
      class={`${TEXT_SIZE[size]} min-w-0 truncate bg-transparent p-0 pl-2 text-left transition motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 ${className}`}
      title={i18n.t('editor.doubleClickToEdit')}
      onclick={(e) => { e.stopPropagation(); scheduleActivate() }}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}
      ondblclick={handleTextDoubleClick}>
      {text}
    </button>
    <span bind:this={editBtn} class="[@media(hover:hover)]:opacity-0 transition motion-reduce:transition-none group-hover:opacity-100 focus-within:opacity-100">
      <Button
        size="sm"
        variant="ghost"
        ariaLabel={i18n.t('editor.edit')}
        tooltip={i18n.t('editor.edit')}
        onClick={(e) => { e.stopPropagation(); startEdit() }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}
        className="bg-transparent p-0 text-slate-400 hover:text-cyan-300">
        {#snippet icon()}
          <EditIcon />
        {/snippet}
      </Button>
    </span>
  {/snippet}

  <!-- Don't grow to fill the available space in display mode so sibling elements
       sit immediately after the name instead of being pushed to the right.
       Keep min-w-0 so truncation still works. -->
  <div class="group flex min-w-0 items-center gap-1">
    {@render displayContent()}
  </div>
{/if}
