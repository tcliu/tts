<script lang="ts">
  interface Props {
    className?: string
  }

  let { className = '' }: Props = $props()
</script>

<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class={className}>
  <path d="M10 2 6.75 5.25M6.75 2.75v2.5h2.5M2 10l3.25-3.25M5.25 9.25v-2.5H2.75" />
</svg>
