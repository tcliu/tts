<script lang="ts">
  import Tooltip from './Tooltip.svelte'
  import CloseIcon from '$lib/icons/CloseIcon.svelte'
  import { getI18nContext } from '$lib/i18n.svelte'
  const i18n = getI18nContext()

  interface Props {
    label: string
    chipClass: string
    style?: string
    ariaLabel?: string
    removeButtonClass?: string
    removeButtonStyle?: string
    tooltip?: string
    disabled?: boolean
    onRemove?: () => void
    // Toggle mode: renders an `aria-pressed` button instead of the static
    // pill. `chipClass` supplies the color; the pressed frame swaps border
    // weight while the invisible-bold grid keeps the width stable.
    active?: boolean
    onclick?: () => void
  }

  let {
    label,
    chipClass,
    style = '',
    ariaLabel,
    removeButtonClass = '',
    removeButtonStyle = '',
    tooltip,
    disabled = false,
    onRemove,
    active = false,
    onclick,
  }: Props = $props()
</script>

<span class={tooltip ? 'group relative inline-flex' : 'inline-flex'}>
  {#if onclick}
    <button
      type="button"
      aria-pressed={active}
      {onclick}
      {disabled}
      class={`inline-flex w-fit cursor-pointer items-center rounded-full px-2 py-0.5 text-xs transition disabled:cursor-not-allowed ${chipClass} ${active ? 'border-2 font-semibold opacity-100' : 'm-px border opacity-70 hover:opacity-100'}`}>
      <span class="grid">
        <span class="col-start-1 row-start-1 {active ? 'font-semibold' : ''}">{label}</span>
        <span class="col-start-1 row-start-1 invisible font-semibold" aria-hidden="true">{label}</span>
      </span>
    </button>
  {:else}
    <span {style} class={`${chipClass} inline-flex items-center gap-1`}>
      {label}
      {#if onRemove}
        <button type="button" aria-label={ariaLabel ?? i18n.t('combobox.remove', { name: label })} onclick={onRemove} {disabled} style={removeButtonStyle} class={removeButtonClass}>
          <CloseIcon className="h-2.5 w-2.5" />
        </button>
      {/if}
    </span>
  {/if}
  {#if tooltip}
    <Tooltip>{tooltip}</Tooltip>
  {/if}
</span>
