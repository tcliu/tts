import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pageSource = readFileSync('src/routes/[[docId]]/+page.svelte', 'utf-8')
const drawerSource = readFileSync('src/lib/components/DocumentsDrawer.svelte', 'utf-8')

describe('doc route drawer layout contract', () => {
  it('renders the documents drawer regardless of drawerOpen state', () => {
    expect(pageSource).toContain('<DocumentsDrawer')
    expect(pageSource).not.toMatch(/\{#if\s+drawer\.drawerOpen\}[\s\S]*<DocumentsDrawer/)
  })

  it('treats large screens as visibly docked even when the overlay drawer is closed', () => {
    expect(pageSource).toContain('const drawerVisible = $derived(isDocked || drawer.drawerOpen)')
    expect(pageSource).toContain('ariaExpanded={drawerVisible}')
    expect(drawerSource).toContain("${isOpen ? 'translate-x-0' : '-translate-x-full'}")
    expect(drawerSource).toContain('lg:translate-x-0')
    expect(drawerSource).toContain('style:transform={dragging || dragOffset !== 0 ? `translateX(${dragOffset}px)` : undefined}')
  })

  it('only autofocuses the drawer search in overlay mode', () => {
    expect(pageSource).toContain('const overlayDrawerOpen = $derived(!isDocked && drawer.drawerOpen)')
    expect(pageSource).toContain('if (!overlayDrawerOpen) {')
  })
})
