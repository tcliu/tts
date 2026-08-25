<script lang="ts">
  interface Props {
    className?: string
  }

  let { className = '' }: Props = $props()
</script>

<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class={className}>
  <path
    d="M4 2h9l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm0 2v13h12V7.7L12.3 4H4Zm2 2v3h6V4H6v2Zm1 7h6v1H7v-1Z" />
</svg>
