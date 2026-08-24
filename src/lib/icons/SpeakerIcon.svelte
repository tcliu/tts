<script lang="ts">
  interface Props {
    className?: string
  }

  let { className = '' }: Props = $props()
</script>

<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class={className}>
  <path d="M10.5 3.75a.75.75 0 0 0-1.264-.546L5.203 6H2.667a.75.75 0 0 0-.75.75v6.5c0 .414.336.75.75.75h2.536l4.033 2.796a.75.75 0 0 0 1.264-.546V3.75Z" />
  <path d="M13.94 6.596a.75.75 0 0 0-1.06 1.06 4.25 4.25 0 0 1 0 6.01.75.75 0 1 0 1.06 1.06 5.75 5.75 0 0 0 0-8.13Z" />
  <path d="M16.413 4.79a.75.75 0 0 0-1.06 1.06 6.75 6.75 0 0 1 0 9.546.75.75 0 1 0 1.06 1.06 8 8 0 0 0 0-11.667Z" />
</svg>
