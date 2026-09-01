<script module lang="ts">
  import type { PanelAction } from '$lib/toolbar-ladder'

  export type { PanelAction }
</script>

<script lang="ts">
  import Menu, { type MenuItemState } from './Menu.svelte'
  import KebabIcon from '$lib/icons/KebabIcon.svelte'
  import SpeakerIcon from '$lib/icons/SpeakerIcon.svelte'
  import StopIcon from '$lib/icons/StopIcon.svelte'
  import RefreshIcon from '$lib/icons/RefreshIcon.svelte'
  import SaveIcon from '$lib/icons/SaveIcon.svelte'
  import DeleteIcon from '$lib/icons/DeleteIcon.svelte'
  import InfoIcon from '$lib/icons/InfoIcon.svelte'
  import CopyIcon from '$lib/icons/CopyIcon.svelte'
  import DocumentIcon from '$lib/icons/DocumentIcon.svelte'
  import UploadIcon from '$lib/icons/UploadIcon.svelte'
  import { UI_TEXT, type UiLocale } from '$lib/ui-text'

  interface Props {
    locale: UiLocale
    actions: PanelAction[]
    onSelect: (action: PanelAction) => void
    isDisabled?: (action: PanelAction) => boolean
    /** Per-action label overrides, e.g. Play toggling to Stop while playing. */
    labels?: Partial<Record<PanelAction, string>>
    /** Swaps the Play item's glyph to Stop while playback is active. */
    isPlaying?: boolean
  }

  let { locale, actions, onSelect, isDisabled, labels, isPlaying = false }: Props = $props()

  const uiText = $derived(UI_TEXT[locale])

  function actionDisabled(action: PanelAction): boolean {
    return isDisabled ? isDisabled(action) : false
  }

  function actionLabel(action: PanelAction): string {
    const override = labels?.[action]
    if (override !== undefined) {
      return override
    }
    if (action === 'play') return uiText.playback
    if (action === 'reset') return uiText.reset
    if (action === 'save') return uiText.save
    if (action === 'delete') return uiText.delete
    if (action === 'copy') return uiText.copy
    if (action === 'clone') return uiText.clone
    if (action === 'upload') return uiText.upload
    return uiText.info
  }

  function itemClass(_action: PanelAction, state: MenuItemState): string {
    return `flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm outline-none transition motion-reduce:transition-none ${
      state.disabled
        ? 'cursor-not-allowed text-slate-600'
        : state.active
          ? 'bg-slate-800 text-cyan-200'
          : 'text-slate-300'
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
  triggerClass="p-2 before:absolute before:-inset-1.5 before:content-['']"
  panelClass="w-44"
  itemDisabled={actionDisabled}
  itemClass={itemClass}>
  {#snippet icon()}
    <KebabIcon className="h-4 w-4" />
  {/snippet}
  {#snippet item(action: PanelAction, state: MenuItemState)}
    <span class={`h-4 w-4 shrink-0 ${state.disabled ? 'text-slate-600' : 'text-slate-500'} [&_svg]:h-full [&_svg]:w-full`}>
      {#if action === 'play'}
        {#if isPlaying}
          <StopIcon />
        {:else}
          <SpeakerIcon />
        {/if}
      {:else if action === 'reset'}
        <RefreshIcon />
      {:else if action === 'save'}
        <SaveIcon />
      {:else if action === 'delete'}
        <DeleteIcon />
      {:else if action === 'copy'}
        <CopyIcon />
      {:else if action === 'clone'}
        <DocumentIcon className="h-[80%] w-[80%] m-[10%]" />
      {:else if action === 'upload'}
        <UploadIcon />
      {:else}
        <InfoIcon />
      {/if}
    </span>
    <span>{actionLabel(action)}</span>
  {/snippet}
</Menu>
