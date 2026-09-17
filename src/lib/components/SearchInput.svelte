<script lang="ts">
  import SearchIcon from '$lib/icons/SearchIcon.svelte'
  import { getI18nContext } from '$lib/i18n.svelte'

  const i18n = getI18nContext()

  interface Props {
    value: string
    ariaLabel: string
    placeholder?: string
    wrapperClass?: string
    inputClass?: string
    inputRef?: HTMLInputElement | null
    oninput?: (event: Event) => void
    onkeydown?: (event: KeyboardEvent) => void
  }

  let {
    value = $bindable(),
    ariaLabel,
    placeholder,
    wrapperClass = '',
    inputClass = 'w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 pl-7 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus-visible:border-cyan-500 motion-reduce:transition-none',
    inputRef = $bindable(null),
    oninput,
    onkeydown,
  }: Props = $props()

  // Derived (not a plain const) so locale switches re-resolve the placeholder.
  const resolvedPlaceholder = $derived(placeholder ?? i18n.t('search.placeholder'))
</script>

<div class={wrapperClass}>
  <div class="relative">
    <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
    <input
      bind:this={inputRef}
      type="search"
      bind:value
      aria-label={ariaLabel}
      placeholder={resolvedPlaceholder}
      {oninput}
      {onkeydown}
      class={inputClass} />
  </div>
</div>

<style>
  /* 16px on touch pointers so iOS Safari does not auto-zoom on focus. Plain
     scoped CSS on purpose: a stacked Tailwind variant inside a class
     expression never reaches the scanner, so it would silently not exist. */
  @media (pointer: coarse) {
    input {
      font-size: 1rem;
    }
  }
</style>
