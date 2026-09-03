import { RESYNC_DEBOUNCE_MS } from '$lib/use-metadata.svelte'

export function createWarmCacheController(deps: { getContent: () => string; getDocId: () => string | null; warmFromCache: () => void }) {
  let lastContent: string | null = null
  let lastDocId: string | null | undefined = undefined
  let timer: ReturnType<typeof setTimeout> | null = null

  function handleEffect(): (() => void) | void {
    const content = deps.getContent()
    const docId = deps.getDocId()
    if (content === lastContent && docId === lastDocId) return
    const isOpening = docId !== lastDocId || lastContent === null
    lastContent = content
    lastDocId = docId
    if (isOpening) {
      if (timer) clearTimeout(timer)
      deps.warmFromCache()
      return
    }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => deps.warmFromCache(), RESYNC_DEBOUNCE_MS)
    return () => {
      if (timer) clearTimeout(timer)
    }
  }

  return { handleEffect }
}
