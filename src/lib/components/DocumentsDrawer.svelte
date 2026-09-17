<script lang="ts">
  import Button from './Button.svelte'
  import SearchInput from './SearchInput.svelte'
  import DocumentIcon from '$lib/icons/DocumentIcon.svelte'
  import PlusIcon from '$lib/icons/PlusIcon.svelte'
  import { getI18nContext } from '$lib/i18n.svelte'
  import { dragCloseLeft, type DragCloseLeftOptions } from '$lib/actions/drag-close-left'
  import type { StoredDocument } from '$lib/use-documents.svelte'

  interface Props {
    documents: StoredDocument[]
    search: string
    currentDocId: string | null
    panelRef?: HTMLElement | null
    inputRef?: HTMLInputElement | null
    isOpen?: boolean
    isDocked?: boolean
    syncError?: string | null
    onNew: () => void
    onOpen: (id: string) => void
    onClose?: () => void
  }

  let {
    documents,
    search = $bindable(''),
    currentDocId,
    panelRef = $bindable(null),
    inputRef = $bindable(null),
    isOpen = false,
    isDocked = false,
    syncError = null,
    onNew,
    onOpen,
    onClose,
  }: Props = $props()

  const i18n = getI18nContext()

  const syncErrorText = $derived(syncError && syncError !== 'session_expired' ? i18n.t('documents.syncFailed') : '')

  let dragOffset = $state(0)
  let dragging = $state(false)
  let reduceMotion = $state(false)

  $effect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => (reduceMotion = mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  })

  const dragCloseOptions: DragCloseLeftOptions = {
    isEnabled: () => !isDocked && !!onClose,
    onDragUpdate: (offset, active) => {
      dragOffset = offset
      dragging = active
    },
    onClose: () => onClose?.(),
  }

  const drawerTransition = $derived.by(() => {
    if (dragging || reduceMotion) {
      return 'none'
    }
    return undefined
  })

  const dockedClasses = $derived(
    isDocked && !isOpen
      ? 'lg:static lg:w-0 lg:min-w-0 lg:overflow-hidden lg:border-r-0 lg:py-0 lg:shadow-none lg:opacity-0 lg:pointer-events-none'
      : 'lg:static lg:translate-x-0 lg:bg-slate-900/40 lg:shadow-none lg:w-72',
  )

  const dockedCollapsed = $derived(isDocked && !isOpen)
</script>

<!-- Docking classes (`lg:*`) must stay in sync with +page.svelte's
     DOCKED_QUERY, which treats below-lg as the dismissable overlay mode. -->
<aside
  bind:this={panelRef}
  aria-label={i18n.t('documents.label')}
  aria-hidden={dockedCollapsed ? 'true' : undefined}
  inert={dockedCollapsed}
  class={`absolute inset-y-0 left-0 z-20 flex w-64 shrink-0 flex-col gap-2 border-r border-slate-800 bg-slate-900 py-2 shadow-xl transition-[transform,width,opacity] duration-200 ease-out motion-reduce:transition-none ${isOpen ? 'translate-x-0' : '-translate-x-full'} ${dockedClasses}`}
  style:transform={dragging || dragOffset !== 0 ? `translateX(${dragOffset}px)` : undefined}
  style:transition={drawerTransition}
  style:touch-action={isDocked ? undefined : 'pan-y'}
  style:will-change={dragging ? 'transform' : undefined}
  use:dragCloseLeft={dragCloseOptions}>
  <div class="flex flex-none flex-col gap-2 px-3">
    <Button variant="outline" accent="cyan" size="sm" onClick={onNew} className="justify-center">
      {#snippet icon()}
        <PlusIcon className="h-4 w-4" />
      {/snippet}
      {i18n.t('documents.newDocument')}
    </Button>
    <SearchInput bind:value={search} bind:inputRef={inputRef} ariaLabel={i18n.t('documents.search')} placeholder={i18n.t('documents.search')} />
  </div>
  <div tabindex="-1" class="min-h-0 flex-1 overflow-y-auto px-3 outline-none">
    {#if syncErrorText}
      <p class="mb-2 text-xs text-amber-200/90" role="status">{syncErrorText}</p>
    {/if}
    {#if documents.length === 0}
      <p class="text-xs text-slate-400">{search.trim() ? i18n.t('documents.noMatchingDocuments') : i18n.t('documents.noSavedDocuments')}</p>
    {:else}
      <ul class="flex flex-col gap-1">
        {#each documents as doc (doc.id)}
          <li class="group/row flex items-center gap-1">
            <button
              type="button"
              aria-current={doc.id === currentDocId ? 'true' : undefined}
              onclick={() => onOpen(doc.id)}
              class={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-sm outline-none transition motion-reduce:transition-none ${
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
