<script lang="ts">
  interface Props {
    className?: string
  }

  let { className = '' }: Props = $props()
</script>

<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class={className}>
  <path d="M8.5 4a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9M11.7 11.7l3.3 3.3" />
</svg>
