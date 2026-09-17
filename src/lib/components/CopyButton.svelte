<script lang="ts">
  import { toast } from 'svelte-sonner'
  import Button from './Button.svelte'
  import CopyIcon from '$lib/icons/CopyIcon.svelte'
  import { getI18nContext } from '$lib/i18n.svelte'
  const i18n = getI18nContext()

  interface Props {
    text: string
    copyAriaLabel?: string
    copyTooltip?: string
    alwaysVisible?: boolean
  }

  let {
    text,
    copyAriaLabel,
    copyTooltip,
    alwaysVisible = false,
  }: Props = $props()

  const ariaLabel = $derived(copyAriaLabel ?? i18n.t('copy.toClipboard'))
  const tooltip = $derived(copyTooltip ?? i18n.t('common.copy'))

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(i18n.t('editor.toast.copied'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : i18n.t('editor.toast.copyFailed'))
    }
  }
</script>

<!-- Reveals on hover/focus via a `group` ancestor on hover-capable devices (hidden state gated behind `(hover: hover)`), always visible on touch devices; must not be portalled -->
<span class={`shrink-0 ${alwaysVisible ? '' : '[@media(hover:hover)]:opacity-0 transition group-hover:opacity-100 focus-within:opacity-100'}`}>
  <Button
    size="sm"
    variant="ghost"
    ariaLabel={ariaLabel}
    tooltip={tooltip}
    onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleCopy() }}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}
    className="bg-transparent text-slate-400 hover:text-cyan-300">
    {#snippet icon()}
      <CopyIcon />
    {/snippet}
  </Button>
</span>
