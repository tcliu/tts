/** Actions offered by the playback toolbar's overflow menu. */
export type PanelAction = 'reset' | 'save' | 'delete' | 'info' | 'copy' | 'clone' | 'upload'

/**
 * Playback-toolbar disclosure ladder.
 *
 * One band table owns both the inline reveal set and the overflow-menu
 * remainder, so band boundaries and menu contents cannot drift apart. Class
 * strings are full literals: Tailwind only generates utilities it finds
 * verbatim in source. Threshold tokens pair with `--container-tts-*` values in
 * `src/styles.css`, calibrated to measured button widths (labels at
 * `--text-sm`, worst-case Latin metrics).
 */

/** Saved documents offer Delete and Clone; a fresh editor does not. */
export type ToolbarMode = 'doc' | 'fresh'

export interface ToolbarBand {
  /** Ordered from narrowest to widest; `inline` grows monotonically. */
  name: 'compact' | 'narrow' | 'small' | 'mid' | 'wide' | 'full'
  /** Full literal visibility classes for this band's overflow menu trigger. */
  menuClass: string
}

export const TOOLBAR_BANDS: readonly ToolbarBand[] = [
  { name: 'compact', menuClass: 'inline-flex @tts-narrow:hidden' },
  { name: 'narrow', menuClass: 'hidden @tts-narrow:inline-flex @sm:hidden' },
  { name: 'small', menuClass: 'hidden @sm:inline-flex @md:hidden' },
  { name: 'mid', menuClass: 'hidden @md:inline-flex @xl:hidden' },
  { name: 'wide', menuClass: 'hidden @xl:inline-flex @tts-full:hidden' },
  { name: 'full', menuClass: '' },
]

/** Actions revealed inline when entering each band; earlier reveals persist. */
const INLINE_AT_BAND: Record<ToolbarMode, Record<ToolbarBand['name'], PanelAction[]>> = {
  doc: {
    compact: [],
    narrow: ['reset', 'save'],
    small: ['copy'],
    mid: ['delete'],
    wide: ['info'],
    full: ['clone', 'upload'],
  },
  fresh: {
    compact: [],
    narrow: ['reset', 'save'],
    small: ['copy'],
    mid: ['info'],
    wide: ['upload'],
    full: [],
  },
}

const ALL_ACTIONS: Record<ToolbarMode, readonly PanelAction[]> = {
  doc: ['reset', 'save', 'delete', 'info', 'copy', 'clone', 'upload'],
  fresh: ['reset', 'save', 'info', 'copy', 'upload'],
}

/** Actions still hidden inside the overflow menu while `band` is active. */
export function menuFor(band: ToolbarBand['name'], mode: ToolbarMode): PanelAction[] {
  const index = TOOLBAR_BANDS.findIndex(entry => entry.name === band)
  if (index < 0) {
    throw new Error(`Unknown toolbar band: ${band}`)
  }
  const inline = new Set(
    TOOLBAR_BANDS.slice(0, index + 1).flatMap(entry => INLINE_AT_BAND[mode][entry.name]),
  )
  return ALL_ACTIONS[mode].filter(action => !inline.has(action))
}

/**
 * Literal reveal classes for each action's standalone span; keyed per mode
 * where the reveal threshold differs between fresh editors and saved docs.
 */
export const REVEAL_CLASS = {
  reset: 'hidden @tts-narrow:inline-flex',
  save: 'hidden @tts-narrow:inline-flex',
  copy: 'hidden @sm:inline-flex',
  delete: 'hidden @md:inline-flex',
  info: { doc: 'hidden @xl:inline-flex', fresh: 'hidden @md:inline-flex' },
  clone: 'hidden @tts-full:inline-flex',
  upload: { doc: 'hidden @tts-full:inline-flex', fresh: 'hidden @xl:inline-flex' },
} as const
