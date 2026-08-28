<script lang="ts">
  interface Props {
    className?: string
  }

  let { className = '' }: Props = $props()
</script>

<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class={className}>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M8.5 3.528V8.172a3 3 0 0 0-.805 1.944L3.66 14.15a2 2 0 0 0 1.34 3.07A18.5 18.5 0 0 0 10 18c1.86 0 3.69-.26 5.45-.78a2 2 0 0 0 1.14-2.77L12.56 10.116A3 3 0 0 0 11.5 8.172V3.528A11.5 11.5 0 0 0 8.5 3.528ZM10 2c-.77 0-1.54.02-2.29.07a.75.75 0 0 0 .29 1.47c.74-.04 1.48-.06 2.28-.06h.4c.52 0 1.03.02 1.54.05a.75.75 0 0 0 .08-1.5A23.5 23.5 0 0 0 10 2Z" />
</svg>
