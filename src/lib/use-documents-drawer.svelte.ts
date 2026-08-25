import type { DocumentsHandle } from './use-documents.svelte'

export function useDocumentsDrawer(documents: DocumentsHandle) {
  let drawerOpen = $state(false)
  let documentSearch = $state('')

  const visibleDocuments = $derived.by(() => {
    const query = documentSearch.trim().toLowerCase()
    const all = documents.documents
    if (!query) {
      return all
    }
    return all.filter(doc => doc.name.toLowerCase().includes(query))
  })

  function openDrawer() {
    documentSearch = ''
    drawerOpen = true
  }

  function closeDrawer() {
    drawerOpen = false
  }

  // Returns the resulting open state so callers can manage trigger focus.
  function toggleDrawer(): boolean {
    drawerOpen = !drawerOpen
    if (drawerOpen) {
      documentSearch = ''
    }
    return drawerOpen
  }

  return {
    get drawerOpen() {
      return drawerOpen
    },
    set drawerOpen(value: boolean) {
      drawerOpen = value
    },
    get documentSearch() {
      return documentSearch
    },
    set documentSearch(value: string) {
      documentSearch = value
    },
    get visibleDocuments() {
      return visibleDocuments
    },
    openDrawer,
    closeDrawer,
    toggleDrawer,
  }
}

export type DocumentsDrawerHandle = ReturnType<typeof useDocumentsDrawer>
