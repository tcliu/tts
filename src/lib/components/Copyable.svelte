<script lang="ts">
  import type { Snippet } from 'svelte'
  import CopyButton from '$lib/components/CopyButton.svelte'

  interface Props {
    text?: string
    copyText?: string
    className?: string
    containerClass?: string
    copyAriaLabel?: string
    copyTooltip?: string
    alwaysVisible?: boolean
    copyPosition?: 'inline' | 'top-right'
    children?: Snippet
  }

  let {
    text,
    copyText = text,
    className = 'text-slate-400',
    containerClass = '',
    copyAriaLabel,
    copyTooltip,
    alwaysVisible = false,
    copyPosition = 'inline',
    children,
  }: Props = $props()

  // hide copy button when there's nothing to copy (empty or whitespace)
  function hasCopyText() {
    return (copyText ?? '').toString().trim().length > 0
  }
</script>

{#if copyPosition === 'top-right'}
  <!-- Top-right mode: the copy button sits to the right of the wrapped content
       on the same row as its first line, and is always visible. -->
  <div class={`group flex items-start gap-1 ${containerClass}`}>
    <div class="min-w-0 flex-1">
      {#if children}
        {@render children()}
      {:else}
        <span class={`${className} block`}>{text}</span>
      {/if}
    </div>
    {#if hasCopyText()}
      <span class="mt-1.5 mr-1.5">
        <CopyButton text={copyText ?? ''} {copyAriaLabel} {copyTooltip} alwaysVisible />
      </span>
    {/if}
  </div>
{:else}
  <div class={`group flex min-w-0 flex-1 items-center gap-1 ${containerClass}`}>
    <span class={`${className} min-w-0 truncate`}>
      {#if children}
        {@render children()}
      {:else}
        {text}
      {/if}
    </span>
    {#if hasCopyText()}
      <CopyButton text={copyText ?? ''} {copyAriaLabel} {copyTooltip} alwaysVisible={alwaysVisible} />
    {/if}
  </div>
{/if}
