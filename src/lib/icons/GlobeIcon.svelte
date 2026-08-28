<script lang="ts">
  interface Props {
    className?: string
  }

  let { className = '' }: Props = $props()
</script>

<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class={className}>
  <circle cx="12" cy="12" r="9.25" stroke="currentColor" stroke-width="1.5" fill="none" />
  <g stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none">
    <path d="M3.3 12H20.7M4.3 7Q12 9.5 19.7 7M4.3 17Q12 14.5 19.7 17" />
    <path d="M12 2.75V21.25M12 2.75A4.5 9.25 0 0 0 12 21.25A4.5 9.25 0 0 0 12 2.75" />
  </g>
</svg>
