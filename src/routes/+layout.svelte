<script lang="ts">
  import type { Snippet } from 'svelte'
  import '../styles.css'
  import type { LayoutData } from './$types'

  let { children, data }: { children: Snippet; data: LayoutData } = $props()
</script>

{@render children()}

{#if data?.devTag}
  <div
    class="fixed bottom-0 left-0 z-40 flex max-w-72 bg-lime-400 px-3 py-2 text-sm font-bold text-green-950"
    title={data.devTag}>
    <span class="min-w-0 truncate">{data.devTag}</span>
  </div>
{/if}
