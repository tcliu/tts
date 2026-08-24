<script lang="ts">
  interface Props {
    className?: string
  }
  let { className = 'h-4 w-4' }: Props = $props()
</script>

<svg
  class={className}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true">
  <rect x="3" y="4" width="18" height="16" rx="2" />
  <path d="M12 8v6" />
  <path d="M9 11l3 3 3-3" />
</svg>
