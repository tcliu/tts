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
  }

  let { tabs, state: tabState, pathname, ariaLabel = 'Tabs' }: Props<TState> = $props()

  let activePath = $state('')

  const activeTab = $derived(tabs.find(tab => tab.path === (pathname ?? activePath)) ?? tabs[0])
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 bg-slate-900 pb-3">
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
            class={`rounded-lg px-3 py-1.5 text-sm font-medium outline-none transition ${tab.path === pathname ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 hover:text-cyan-300 focus:text-cyan-300'}`}>
            {tab.label}
          </a>
        {:else}
          <button
            type="button"
            aria-pressed={tab.path === activeTab?.path}
            onclick={() => (activePath = tab.path)}
            class={`rounded-lg px-3 py-1.5 text-sm font-medium outline-none transition ${tab.path === activeTab?.path ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 hover:text-cyan-300 focus:text-cyan-300'}`}>
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
