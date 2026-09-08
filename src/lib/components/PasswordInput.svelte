<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'
  import Tooltip from './Tooltip.svelte'
  import EyeIcon from '$lib/icons/EyeIcon.svelte'
  import EyeSlashIcon from '$lib/icons/EyeSlashIcon.svelte'
  import { getI18nContext } from '$lib/i18n.svelte'

  interface Props {
    value: string
    id?: string
    name?: string
    placeholder?: string
    autocomplete?: HTMLInputAttributes['autocomplete']
    disabled?: boolean
    required?: boolean
    className?: string
    oninput?: (event: Event) => void
  }

  let {
    value = $bindable(),
    id,
    name,
    placeholder,
    autocomplete = 'current-password',
    disabled = false,
    required = false,
    className = '',
    oninput,
  }: Props = $props()

  const i18n = getI18nContext()

  let visible = $state(false)
  let input = $state<HTMLInputElement>()
  let toggleBtn = $state<HTMLElement | null>(null)
  export function focus() {
    input?.focus()
  }

  function toggleVisibility() {
    visible = !visible
    requestAnimationFrame(() => {
      if (input) input.setSelectionRange(input.value.length, input.value.length)
    })
  }
</script>

<div class="relative">
  <input
    {id}
    bind:this={input}
    bind:value
    {name}
    {placeholder}
    {autocomplete}
    {disabled}
    {required}
    type={visible ? 'text' : 'password'}
    {oninput}
    class="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pr-12 pl-3 text-sm text-slate-100 outline-none transition focus:border-cyan-500 disabled:opacity-40 {className}" />
  <button
    bind:this={toggleBtn}
    onclick={toggleVisibility}
    aria-label={visible ? i18n.t('adminPasswordHide') : i18n.t('adminPasswordShow')}
    type="button"
    {disabled}
    class="absolute inset-y-0 right-1 my-1 inline-flex w-9 items-center justify-center rounded-md text-slate-400 outline-none transition hover:bg-slate-800 hover:text-cyan-300 focus:bg-slate-800 focus:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">
    {#if visible}
      <EyeSlashIcon className="h-5 w-5" />
    {:else}
      <EyeIcon className="h-5 w-5" />
    {/if}
    <Tooltip trigger={toggleBtn}>{visible ? i18n.t('adminPasswordHide') : i18n.t('adminPasswordShow')}</Tooltip>
  </button>
</div>
