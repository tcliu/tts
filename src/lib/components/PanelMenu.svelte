<script module lang="ts">
  export type PanelAction = 'reset' | 'save' | 'delete' | 'info' | 'copy' | 'clone'
</script>

<script lang="ts">
  import Menu, { type MenuItemState } from './Menu.svelte'
  import KebabIcon from '$lib/icons/KebabIcon.svelte'
  import RefreshIcon from '$lib/icons/RefreshIcon.svelte'
  import SaveIcon from '$lib/icons/SaveIcon.svelte'
  import DeleteIcon from '$lib/icons/DeleteIcon.svelte'
  import InfoIcon from '$lib/icons/InfoIcon.svelte'
  import CopyIcon from '$lib/icons/CopyIcon.svelte'
  import DocumentIcon from '$lib/icons/DocumentIcon.svelte'
  import { UI_TEXT, type UiLocale } from '$lib/ui-text'

  interface Props {
    locale: UiLocale
    actions: PanelAction[]
    onSelect: (action: PanelAction) => void
    isDisabled?: (action: PanelAction) => boolean
  }

  let { locale, actions, onSelect, isDisabled }: Props = $props()

  const uiText = $derived(UI_TEXT[locale])

  function actionDisabled(action: PanelAction): boolean {
    return isDisabled ? isDisabled(action) : false
  }

  function actionLabel(action: PanelAction): string {
    if (action === 'reset') return uiText.reset
    if (action === 'save') return uiText.save
    if (action === 'delete') return uiText.delete
    if (action === 'copy') return uiText.copy
    if (action === 'clone') return uiText.clone
    return uiText.info
  }

  function itemClass(_action: PanelAction, state: MenuItemState): string {
    return `flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm outline-none transition ${
      state.disabled
        ? 'cursor-not-allowed text-slate-600'
        : 'text-slate-300 hover:bg-slate-800 hover:text-cyan-200 focus:bg-slate-800 focus:text-cyan-200'
    }`
  }
</script>

<Menu
  items={actions}
  itemKey={action => action}
  onSelect={index => onSelect(actions[index])}
  ariaLabel={uiText.moreActions}
  align="right"
  autoPlace={true}
  triggerClass="p-2"
  panelClass="w-44"
  itemDisabled={actionDisabled}
  itemClass={itemClass}>
  {#snippet icon()}
    <KebabIcon className="h-4 w-4" />
  {/snippet}
  {#snippet item(action: PanelAction, state: MenuItemState)}
    <span class={`h-4 w-4 shrink-0 ${state.disabled ? 'text-slate-600' : 'text-slate-500'} [&_svg]:h-full [&_svg]:w-full`}>
      {#if action === 'reset'}
        <RefreshIcon />
      {:else if action === 'save'}
        <SaveIcon />
      {:else if action === 'delete'}
        <DeleteIcon />
      {:else if action === 'copy'}
        <CopyIcon />
      {:else if action === 'clone'}
        <DocumentIcon className="h-[80%] w-[80%] m-[10%]" />
      {:else}
        <InfoIcon />
      {/if}
    </span>
    <span>{actionLabel(action)}</span>
  {/snippet}
</Menu>
