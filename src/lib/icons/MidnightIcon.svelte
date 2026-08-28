<script lang="ts">
  interface Props {
    className?: string
  }

  let { className = '' }: Props = $props()
</script>

<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class={className}>
  <path
    fill-rule="evenodd"
    clip-rule="evenodd"
    d="M10.868 2.884a1 1 0 0 0-1.736 0l-1.83 4.401-4.752.381a1 1 0 0 0-.536 1.772l3.62 3.102-1.106 4.637a1 1 0 0 0 1.473 1.08L10 15.59l4 2.668a1 1 0 0 0 1.474-1.08l-1.106-4.637 3.62-3.102a1 1 0 0 0-.536-1.772l-4.752-.38-1.832-4.402Z"
  />
</svg>
