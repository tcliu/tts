<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    label: string
    htmlFor?: string
    className?: string
    children?: Snippet
  }

  let { label, htmlFor, className = '', children }: Props = $props()
</script>

<div class="flex min-w-0 flex-col gap-1.5 {className}">
  <label for={htmlFor} class="w-fit cursor-pointer text-sm text-slate-300">{label}</label>
  {@render children?.()}
</div>
