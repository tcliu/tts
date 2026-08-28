<script lang="ts">
  import Button from './Button.svelte'
  import SearchInput from './SearchInput.svelte'
  import DocumentIcon from '$lib/icons/DocumentIcon.svelte'
  import PlusIcon from '$lib/icons/PlusIcon.svelte'
  import { UI_TEXT, type UiLocale } from '$lib/ui-text'
  import type { StoredDocument } from '$lib/use-documents.svelte'

  interface Props {
    locale: UiLocale
    documents: StoredDocument[]
    search: string
    currentDocId: string | null
    panelRef?: HTMLElement | null
    inputRef?: HTMLInputElement | null
    onNew: () => void
    onOpen: (id: string) => void
  }

  let {
    locale,
    documents,
    search = $bindable(''),
    currentDocId,
    panelRef = $bindable(null),
    inputRef = $bindable(null),
    onNew,
    onOpen,
  }: Props = $props()

  const text = $derived(UI_TEXT[locale])
</script>

<!-- Docking classes (`lg:*`) must stay in sync with +page.svelte's
     DOCKED_QUERY, which treats below-lg as the dismissable overlay mode. -->
<aside
  bind:this={panelRef}
  aria-label={text.documents}
  class="absolute inset-y-0 left-0 z-20 flex w-64 shrink-0 flex-col gap-2 border-r border-slate-800 bg-slate-900 py-2 shadow-xl lg:static lg:bg-slate-900/40 lg:shadow-none lg:w-72">
  <div class="flex flex-none flex-col gap-2 px-3">
    <Button variant="outline" accent="cyan" size="sm" onClick={onNew} className="justify-center px-2.5 py-1.5 text-sm">
      {#snippet icon()}
        <PlusIcon className="h-4 w-4" />
      {/snippet}
      {text.newDocument}
    </Button>
    <SearchInput bind:value={search} bind:inputRef={inputRef} ariaLabel={text.documentSearch} placeholder={text.documentSearch} />
  </div>
  <div class="min-h-0 flex-1 overflow-y-auto px-3">
    {#if documents.length === 0}
      <p class="text-xs text-slate-500">{search.trim() ? text.noMatchingDocuments : text.noSavedDocuments}</p>
    {:else}
      <ul class="flex flex-col gap-1">
        {#each documents as doc (doc.id)}
          <li class="group/row flex items-center gap-1">
            <button
              type="button"
              aria-current={doc.id === currentDocId ? 'true' : undefined}
              onclick={() => onOpen(doc.id)}
              class={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition motion-reduce:transition-none ${
                doc.id === currentDocId
                  ? 'bg-cyan-500/15 text-cyan-200'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-cyan-200 focus:bg-slate-800 focus:text-cyan-200'
              }`}>
              <DocumentIcon className="h-4 w-4 shrink-0 text-slate-500" />
              <span class="truncate">{doc.name}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</aside>
