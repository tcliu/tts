<script lang="ts" generics="TState">
  import type { Snippet } from 'svelte'

  export interface Tab<TState> {
    label: string
    path: string
    toolbar?: Snippet<[TState]>
    content: Snippet<[TState]>
  }

  interface Props<TState> {
    tabs: Tab<TState>[]
    state: TState
    pathname?: string
    ariaLabel?: string
    class?: string
    headerClass?: string
  }

  let { tabs, state: tabState, pathname, ariaLabel = 'Tabs', class: className = '', headerClass = 'sticky top-0 z-10 flex w-full flex-wrap items-center justify-between gap-2 bg-transparent pb-3' }: Props<TState> = $props()

  let activePath = $state('')

  const activeTab = $derived(tabs.find(tab => tab.path === (pathname ?? activePath)) ?? tabs[0])
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class={`${headerClass} ${className}`}>
    <nav aria-label={ariaLabel} class="inline-flex rounded-xl border border-slate-700 bg-slate-950 p-1">
      {#each tabs as tab}
        {#if pathname !== undefined}
          <a
            href={tab.path}
            aria-current={tab.path === pathname ? 'page' : undefined}
            onclick={event => {
              if (tab.path === pathname) {
                event.preventDefault()
              }
            }}
            class={`rounded-lg px-3 py-1.5 text-sm font-medium outline-none transition motion-reduce:transition-none ${tab.path === pathname ? 'bg-cyan-500 text-onaccent' : 'text-slate-300 hover:text-cyan-300 focus:text-cyan-300'}`}>
            {tab.label}
          </a>
        {:else}
          <button
            type="button"
            aria-pressed={tab.path === activeTab?.path}
            onclick={() => (activePath = tab.path)}
            class={`rounded-lg px-3 py-1.5 text-sm font-medium outline-none transition motion-reduce:transition-none ${tab.path === activeTab?.path ? 'bg-cyan-500 text-onaccent' : 'text-slate-300 hover:text-cyan-300 focus:text-cyan-300'}`}>
            {tab.label}
          </button>
        {/if}
      {/each}
    </nav>
    {#if activeTab?.toolbar}
      <div class="flex items-center gap-2">
        {@render activeTab.toolbar(tabState)}
      </div>
    {/if}
  </div>
  {#if activeTab}
    <div class="flex min-h-0 flex-1 flex-col">
      {@render activeTab.content(tabState)}
    </div>
  {/if}
</div>
