<script lang="ts">
  interface Props {
    className?: string
  }

  let { className = '' }: Props = $props()
</script>

<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class={className}>
  <path d="M10 2.5L4.5 10h2.2L3.5 16.5H6l1.2 2h5.6l1.2-2h2.5l-3.2-6.5H16L10 2.5Z" />
</svg>
