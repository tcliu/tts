<script lang="ts">
  interface Props {
    className?: string
  }

  let { className = '' }: Props = $props()
</script>

<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class={className}>
  <path
    fill-rule="evenodd"
    d="M10 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM3.5 15.75a6.5 6.5 0 0 1 13 0 .75.75 0 0 1-.75.75h-11.5a.75.75 0 0 1-.75-.75Z"
    clip-rule="evenodd" />
</svg>