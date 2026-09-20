<script lang="ts">
  import type { ComponentProps, Snippet } from 'svelte'
  import BaseDialog from '$lib/components/BaseDialog.svelte'
  import Button from '$lib/components/Button.svelte'
  import Buttons from '$lib/components/Buttons.svelte'
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte'

  interface Props {
    title: string
    maxWidth?: ComponentProps<typeof BaseDialog>['maxWidth']
    closeLabel: string
    saveLabel: string
    resetLabel: string
    discardTitle: string
    discardMessage: string
    discardLabel: string
    /** Caller-owned draft-vs-snapshot compare. Gates the discard prompt and Reset. */
    dirty: boolean
    /** Caller combines validity/domain rules; `pending` is ORed in automatically. */
    saveDisabled?: boolean
    pending?: boolean
    /** Callers that only edit show Reset in edit mode; default keeps it always. */
    showReset?: boolean
    onSave: () => void
    onReset: () => void
    /** Final close: invoked directly when clean, or after discard is confirmed. */
    onClose: () => void
    children?: Snippet
  }

  let {
    title,
    maxWidth = 'md',
    closeLabel,
    saveLabel,
    resetLabel,
    discardTitle,
    discardMessage,
    discardLabel,
    dirty,
    saveDisabled = false,
    pending = false,
    showReset = true,
    onSave,
    onReset,
    onClose,
    children,
  }: Props = $props()

  let discardOpen = $state(false)

  function handleCancelRequest(): void {
    if (discardOpen) return
    if (dirty) {
      discardOpen = true
      return
    }
    onClose()
  }

  function handleDiscard(): void {
    discardOpen = false
    onClose()
  }

  function handleSubmit(event: SubmitEvent): void {
    event.preventDefault()
    if (pending || saveDisabled) return
    onSave()
  }
</script>

<BaseDialog {title} {maxWidth} {closeLabel} onCancel={handleCancelRequest}>
  <form class="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4" onsubmit={handleSubmit}>
    <div class="min-h-0 min-w-0 flex-1 overflow-y-auto">
      {@render children?.()}
    </div>
    <Buttons>
      <Button variant="primary" accent="cyan" type="submit" disabled={pending || saveDisabled} {pending}
        >{saveLabel}</Button>
      {#if showReset}
        <Button variant="outline" type="button" disabled={pending || !dirty} onClick={onReset}>{resetLabel}</Button>
      {/if}
    </Buttons>
  </form>
</BaseDialog>

{#if discardOpen}
  <ConfirmDialog
    title={discardTitle}
    message={discardMessage}
    confirmLabel={discardLabel}
    confirmColor="rose"
    {closeLabel}
    onConfirm={handleDiscard}
    onCancel={() => (discardOpen = false)} />
{/if}
