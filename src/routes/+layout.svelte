<script lang="ts">
  import type { Snippet } from 'svelte'
  import '../styles.css'

  let { children }: { children: Snippet } = $props()
</script>

{@render children()}
