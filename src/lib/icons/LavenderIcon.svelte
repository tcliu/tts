<script lang="ts">
  interface Props {
    className?: string
  }

  let { className = '' }: Props = $props()
</script>

<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class={className}>
  <path d="M9.653 16.915a.5.5 0 0 0 .694 0l.002-.002c.02-.014 1.15-.8 2.43-1.98C14.32 13.5 16 11.1 16 8.5 16 5.67 13.99 3.5 11.5 3.5c-1.06 0-2.02.55-2.6 1.4A3.2 3.2 0 0 0 6.5 3.5C4.01 3.5 2 5.67 2 8.5c0 2.6 1.68 5 3.22 6.43 1.28 1.18 2.41 1.97 2.43 1.98l.002.002Z" />
</svg>
