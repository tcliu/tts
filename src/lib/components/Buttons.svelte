<script lang="ts">
  import type { Snippet } from 'svelte'

  type ButtonsAlign = 'left' | 'center' | 'right'

  interface Props {
    // Horizontal alignment for the default layout; a custom `className`
    // takes full control and ignores `align`.
    align?: ButtonsAlign
    className?: string
    children?: Snippet
  }

  const alignClasses: Record<ButtonsAlign, string> = {
    left: 'justify-start',
    center: 'justify-center',
    right: 'justify-end',
  }

  let { align = 'left', className, children }: Props = $props()

  // `w-full` gives `justify-*` free space to work with: without it the row
  // hugs its content inside flex parents (e.g. the showcase demo row) and
  // `align` has no visible effect.
  const resolvedClassName = $derived(className ?? `flex w-full shrink-0 flex-wrap items-center gap-3 ${alignClasses[align]}`)
</script>

<div class={resolvedClassName}>
  {@render children?.()}
</div>
