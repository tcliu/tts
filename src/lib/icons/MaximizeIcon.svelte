<script lang="ts">
  interface Props {
    className?: string
  }

  let { className = '' }: Props = $props()
</script>

<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class={className}>
  <path d="M7.25 2H10v2.75M4.75 10H2V7.25M10 2 6.75 5.25M2 10l3.25-3.25" />
</svg>
