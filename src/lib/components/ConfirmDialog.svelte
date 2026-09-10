<script lang="ts">
  import BaseDialog from './BaseDialog.svelte'
  import Button from './Button.svelte'
  import Buttons from './Buttons.svelte'

  interface Props {
    title: string
    message: string
    confirmLabel: string
    closeLabel: string
    className?: string
    maxWidth?: 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl' | 'fit' | 'wide'
    confirmColor?: 'rose' | 'amber' | 'emerald' | 'cyan'
    pending?: boolean
    onConfirm: () => void
    onCancel: () => void
  }

  let {
    title,
    message,
    confirmLabel,
    closeLabel,
    className = '',
    maxWidth = 'md',
    confirmColor = 'rose',
    pending = false,
    onConfirm,
    onCancel,
  }: Props = $props()
</script>

<BaseDialog {title} {className} {maxWidth} {closeLabel} {onCancel}>
  <div class="flex flex-col gap-4">
    <p class="text-sm leading-6 text-slate-400">{message}</p>
    <Buttons align="right">
      <Button variant="primary" accent={confirmColor} {pending} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </Buttons>
  </div>
</BaseDialog>
