<script lang="ts">
  interface Props {
    className?: string
  }

  let { className = 'h-4 w-4' }: Props = $props()
</script>

<svg
  class={`${className} animate-spin motion-reduce:animate-none`}
  viewBox="0 0 20 20"
  fill="currentColor"
  aria-hidden="true">
  <path
    fill-rule="evenodd"
    d="M10 3.5a6.5 6.5 0 1 0 6.112 8.707.75.75 0 1 1 1.409.517A8 8 0 1 1 10 2a.75.75 0 0 1 0 1.5Z"
    clip-rule="evenodd" />
</svg>
