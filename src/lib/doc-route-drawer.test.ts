import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pageSource = readFileSync('src/routes/[[docId]]/+page.svelte', 'utf-8')
const drawerSource = readFileSync('src/lib/components/DocumentsDrawer.svelte', 'utf-8')

describe('doc route drawer layout contract', () => {
  it('renders the documents drawer regardless of drawerOpen state', () => {
    expect(pageSource).toContain('<DocumentsDrawer')
    expect(pageSource).not.toMatch(/\{#if\s+drawer\.drawerOpen\}[\s\S]*<DocumentsDrawer/)
  })

  it('keeps large screens docked by default but still lets the button toggle the drawer', () => {
    expect(pageSource).toContain('let dockedDrawerOpen = $state(true)')
    expect(pageSource).toContain('const drawerVisible = $derived(isDocked ? dockedDrawerOpen : drawer.drawerOpen)')
    expect(pageSource).toContain('isOpen={drawerVisible}')
    expect(pageSource).toContain('ariaExpanded={drawerVisible}')
    expect(pageSource).toContain('dockedDrawerOpen = !dockedDrawerOpen')
    expect(drawerSource).toContain('lg:w-0')
    expect(drawerSource).toContain('lg:pointer-events-none')
    expect(drawerSource).toContain('aria-hidden={dockedCollapsed ? \'true\' : undefined}')
    expect(drawerSource).toContain('inert={dockedCollapsed}')
    expect(drawerSource).toContain('style:transform={dragging || dragOffset !== 0 ? `translateX(${dragOffset}px)` : undefined}')
  })

  it('only autofocuses the drawer search in overlay mode', () => {
    expect(pageSource).toContain('const overlayDrawerOpen = $derived(!isDocked && drawer.drawerOpen)')
    expect(pageSource).toContain('if (!overlayDrawerOpen) {')
  })
})
