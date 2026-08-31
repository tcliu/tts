<script lang="ts">
  import CheckIcon from '$lib/icons/CheckIcon.svelte'

  interface Props {
    checked: boolean
    label?: string
    ariaLabel?: string
    name?: string
    disabled?: boolean
    indeterminate?: boolean
    stopPropagation?: boolean
    labelClass?: string
    wrapperClass?: string
    boxClass?: string
    inputRef?: HTMLInputElement | null
    onChange?: (checked: boolean) => void
  }

  let {
    checked = $bindable(),
    label,
    ariaLabel,
    name,
    disabled = false,
    indeterminate = false,
    stopPropagation = true,
    labelClass = 'text-sm text-slate-300',
    wrapperClass = '',
    boxClass = '',
    inputRef = $bindable(null),
    onChange,
  }: Props = $props()

  $effect(() => {
    if (!inputRef) return
    inputRef.indeterminate = indeterminate
  })
</script>

<label
  class={`inline-flex cursor-pointer items-center gap-3 ${disabled ? 'cursor-not-allowed opacity-40' : ''} ${wrapperClass}`}>
  <input
    bind:checked
    bind:this={inputRef}
    {name}
    type="checkbox"
    class="peer sr-only"
    {disabled}
    aria-label={ariaLabel ?? label}
    onclick={event => {
      if (stopPropagation) {
        event.stopPropagation()
      }
    }}
    onchange={event => onChange?.((event.currentTarget as HTMLInputElement).checked)} />
  <span
    aria-hidden="true"
    class={`inline-flex h-5 w-5 items-center justify-center rounded-md border transition peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-500/70 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-slate-900 ${checked ? 'border-cyan-500 bg-cyan-300 text-slate-950' : 'border-slate-700 bg-slate-950 text-transparent'} ${boxClass}`}>
    <CheckIcon className="h-3.5 w-3.5" />
  </span>
  {#if label}
    <span class={labelClass}>{label}</span>
  {/if}
</label>
