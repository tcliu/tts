<script lang="ts">
  import Button from '$lib/components/Button.svelte'
  import Checkbox from '$lib/components/Checkbox.svelte'
  import RefreshIcon from '$lib/icons/RefreshIcon.svelte'
  import { createFocusoutClose } from '$lib/actions/use-focusout-close'
  import { useDropdown } from '$lib/actions/use-dropdown.svelte'

  export interface ChooserColumn {
    key: string
    header: string
    checked: boolean
  }

  interface Props {
    /** Accessible name and tooltip for the icon trigger; passed translated. */
    label: string
    /** Accessible name and tooltip for the reset button; passed translated. */
    resetLabel: string
    columns: ChooserColumn[]
    onToggle: (key: string, checked: boolean) => void
    onReset: () => void
  }

  let { label, resetLabel, columns, onToggle, onReset }: Props = $props()

  let open = $state(false)
  let containerRef = $state<HTMLSpanElement | null>(null)
  let triggerRef = $state<HTMLButtonElement | null>(null)
  let panelRef = $state<HTMLDivElement | null>(null)

  function close(focusTrigger = false) {
    open = false
    if (focusTrigger) triggerRef?.focus()
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      // Close before viewer-level Escape handling runs, then keep focus.
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }
  }

  const handleFocusOut = createFocusoutClose(
    () => open,
    () => ({ container: containerRef, panel: panelRef }),
    () => close(),
  )

  useDropdown(() => ({
    isOpen: () => open,
    container: () => containerRef,
    onOutsideClick: () => close(),
    // Escape from anywhere (trigger or panel) closes and restores focus so
    // unmounting the panel never drops focus to the body.
    onEscape: () => close(true),
    panel: () => panelRef,
  }))
</script>

<span class="colchooser relative inline-flex gap-1" bind:this={containerRef} onfocusout={handleFocusOut}>
  {#snippet triggerIcon()}
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 3.75A.75.75 0 0 1 2.75 3h2.5a.75.75 0 0 1 0 1.5h-2.5A.75.75 0 0 1 2 3.75Zm0 4A.75.75 0 0 1 2.75 7h2.5a.75.75 0 0 1 0 1.5h-2.5A.75.75 0 0 1 2 7.75Zm0 4A.75.75 0 0 1 2.75 11h2.5a.75.75 0 0 1 0 1.5h-2.5A.75.75 0 0 1 2 11.75Zm6-8A.75.75 0 0 1 8.75 3h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 8 3.75Zm0 4A.75.75 0 0 1 8.75 7h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 8 7.75Zm0 4A.75.75 0 0 1 8.75 11h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 8 11.75Z" /></svg>
  {/snippet}
  {#snippet resetIcon()}
    <RefreshIcon className="h-3.5 w-3.5" />
  {/snippet}
  <Button
    variant="ghost"
    size="sm"
    ariaLabel={label}
    dataTip={label}
    ariaExpanded={open}
    onClick={() => (open = !open)}
    onKeyDown={handleKeydown}
    bind:buttonEl={triggerRef}
    icon={triggerIcon} />
  <Button
    variant="ghost"
    size="sm"
    ariaLabel={resetLabel}
    dataTip={resetLabel}
    onClick={() => onReset()}
    icon={resetIcon} />
  {#if open}
    <!-- Prevent the focus shift on row pointerdown (as TopbarMenu options do)
         so focusout-close cannot win the race with the label click. -->
    <div
      bind:this={panelRef}
      class="panel absolute right-0 top-[calc(100%+4px)] z-40 max-h-[50dvh] min-w-36 overflow-auto rounded-lg border border-slate-700 bg-slate-900/95 p-1.5 shadow-2xl shadow-slate-950/60 backdrop-blur"
      role="group"
      aria-label={label}
      onpointerdown={event => event.preventDefault()}>
      {#each columns as column (column.key)}
        <div class="chooser-row whitespace-nowrap rounded px-1.5 py-0.5 hover:bg-slate-800">
          <Checkbox
            checked={column.checked}
            label={column.header}
            size="sm"
            onChange={checked => onToggle(column.key, checked)} />
        </div>
      {/each}
    </div>
  {/if}
</span>
