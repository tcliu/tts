<script lang="ts">
  import SearchIcon from '$lib/icons/SearchIcon.svelte'

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
    placeholder = 'Search...',
    wrapperClass = '',
    inputClass = 'w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 pl-7 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus-visible:border-cyan-500 motion-reduce:transition-none',
    inputRef = $bindable(null),
    oninput,
    onkeydown,
  }: Props = $props()
</script>

<div class={wrapperClass}>
  <div class="relative">
    <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
    <input bind:this={inputRef} type="search" bind:value aria-label={ariaLabel} {placeholder} {oninput} {onkeydown} class={inputClass} />
  </div>
</div>
