<script lang="ts">
  import Button from './Button.svelte'
  import NumberInput from './NumberInput.svelte'
  import ResetIcon from '$lib/icons/ResetIcon.svelte'
  import RefreshIcon from '$lib/icons/RefreshIcon.svelte'
  import SaveIcon from '$lib/icons/SaveIcon.svelte'
  import { adminErrorMessage } from '$lib/admin-client'
  import { UI_TEXT, type UiLocale } from '$lib/ui-text'
  import type { useAdminProperties } from '$lib/use-admin-properties.svelte'

  interface Props {
    locale: UiLocale
    propertiesState: ReturnType<typeof useAdminProperties>
  }

  let { locale, propertiesState }: Props = $props()

  const text = $derived(UI_TEXT[locale])

  const sourceLabels = $derived<Record<string, string>>({
    file: text.adminSourceFile,
    environment: text.adminSourceEnvironment,
    default: text.adminSourceDefault,
  })

  let applyError = $state('')
  let resetError = $state('')

  function propertyLabel(property: { labelKey: string; key: string }): string {
    return text[property.labelKey as keyof typeof text] ?? property.key
  }

  function propertyDescription(property: { descriptionKey: string }): string {
    return text[property.descriptionKey as keyof typeof text] ?? ''
  }

  function handleApply() {
    resetError = ''
    applyError = propertiesState.apply(text) ?? ''
  }

  async function handleResetProperty(property: Parameters<typeof propertiesState.resetProperty>[0]) {
    applyError = ''
    const code = await propertiesState.resetProperty(property)
    resetError = code ? adminErrorMessage(code, text) : ''
  }
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
  {#if propertiesState.loadError || applyError || resetError}
    <p class="rounded-lg border border-rose-700 bg-rose-950/50 px-3 py-2 text-sm text-rose-200" role="alert">
      {applyError || resetError || (propertiesState.loadError ? adminErrorMessage(propertiesState.loadError, text) : '')}
    </p>
  {/if}
  <section aria-label={text.adminPropertiesActions} class="flex flex-none flex-wrap items-center gap-1.5">
    <Button
      variant="outline"
      accent="cyan"
      size="sm"
      disabled={!propertiesState.hasUnsavedChanges || propertiesState.pending}
      pending={propertiesState.pending}
      ariaLabel={text.adminApply}
      onClick={handleApply}>
      {#snippet icon()}
        <SaveIcon className="h-4 w-4" />
      {/snippet}
      {text.adminApply}
    </Button>
    <Button
      variant="secondary"
      size="sm"
      disabled={propertiesState.pending}
      ariaLabel={text.adminReload}
      onClick={() => void propertiesState.reload()}>
      {#snippet icon()}
        <RefreshIcon className="h-4 w-4" />
      {/snippet}
      {text.adminReload}
    </Button>
    <Button
      variant="secondary"
      size="sm"
      disabled={propertiesState.pending || !propertiesState.hasUnsavedChanges}
      ariaLabel={text.adminReset}
      onClick={() => propertiesState.resetDraft()}>
      {#snippet icon()}
        <ResetIcon className="h-4 w-4" />
      {/snippet}
      {text.adminReset}
    </Button>
  </section>
  <div
    tabindex="-1"
    class="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden rounded-xl border border-slate-800 bg-slate-950/50">
    {#each propertiesState.properties as property, i}
      {@const label = propertyLabel(property)}
      <div class="grid min-w-0 grid-cols-1 items-center gap-2 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] {i > 0 ? 'border-t border-slate-800' : ''}">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium text-slate-100">{label}</span>
            <span
              class="rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide {property.source ===
              'file'
                ? 'border-cyan-700 bg-cyan-950/50 text-cyan-200'
                : property.source === 'environment'
                  ? 'border-violet-700 bg-violet-950/50 text-violet-200'
                  : 'border-slate-700 bg-slate-900 text-slate-400'}">
              {sourceLabels[property.source]}
            </span>
          </div>
          <p class="mt-0.5 text-xs text-slate-400">{propertyDescription(property)}</p>
          <p class="mt-0.5 truncate text-xs text-slate-500" title={`${property.key} (${text.adminEnv} ${property.envKey})`}>
            {property.key} ({text.adminEnv} {property.envKey})
          </p>
        </div>
        <div class="flex min-w-0 items-center gap-2">
          <NumberInput
            bind:value={
              () => propertiesState.draftValues[property.key] ?? String(property.value),
              v => propertiesState.setDraftValue(property.key, v)
            }
            min={property.min}
            max={property.max}
            step={1}
            disabled={propertiesState.pending}
            ariaLabel={label}
            incrementLabel={text.increment}
            decrementLabel={text.decrement} />
          {#if property.source === 'file'}
            <Button
              size="sm"
              ariaLabel={text.adminRevertToDefault}
              tooltip={text.adminRevertToDefault}
              tooltipAlign="right"
              disabled={propertiesState.pending}
              onClick={() => void handleResetProperty(property)}
              className="shrink-0 text-slate-400 hover:text-cyan-300">
              {#snippet icon()}
                <ResetIcon />
              {/snippet}
            </Button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>
