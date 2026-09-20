<script lang="ts">
  type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg'

  interface Props {
    className?: string
    size?: SpinnerSize
  }

  // Width/height attributes (not classes) so `size` composes with `className`:
  // a tint-only className no longer drops the default sizing, and explicit
  // size classes in className still win, since CSS beats attributes.
  const SIZE_PX: Record<SpinnerSize, number> = { xs: 16, sm: 24, md: 32, lg: 40 }

  let { className = '', size = 'xs' }: Props = $props()
</script>

<svg
  class={`${className} animate-spin motion-reduce:animate-none`}
  viewBox="0 0 20 20"
  fill="currentColor"
  aria-hidden="true"
  width={SIZE_PX[size]}
  height={SIZE_PX[size]}>
  <path
    fill-rule="evenodd"
    d="M10 3.5a6.5 6.5 0 1 0 6.112 8.707.75.75 0 1 1 1.409.517A8 8 0 1 1 10 2a.75.75 0 0 1 0 1.5Z"
    clip-rule="evenodd" />
</svg>
