/** Actions offered by the playback toolbar's overflow menu. */
export type PanelAction = 'play' | 'reset' | 'save' | 'delete' | 'info' | 'copy' | 'clone' | 'upload'

/**
 * Playback-toolbar disclosure ladder.
 *
 * One band table owns both the inline reveal set and the overflow-menu
 * remainder, so band boundaries and menu contents cannot drift apart. Class
 * strings are full literals: Tailwind only generates utilities it finds
 * verbatim in source. Threshold tokens pair with `--container-tts-*` values in
 * `src/styles.css`, calibrated to measured button widths (labels at
 * `--text-sm`, worst-case Latin metrics) at the toolbar's container width.
 */

/** Saved documents offer Delete and Clone; a fresh editor does not. */
export type ToolbarMode = 'doc' | 'fresh'

export interface ToolbarBand {
  /** Ordered from narrowest to widest; `inline` grows monotonically. */
  name: 'tiny' | 'mini' | 'compact' | 'narrow' | 'small' | 'mid' | 'wide' | 'full'
  /** Full literal visibility classes for this band's overflow menu trigger. */
  menuClass: string
}

/**
 * Band table for the overflow-menu triggers. Each band's visible width range
 * is encoded in its `menuClass`; the variant that first makes it visible
 * (`<variant>:inline-flex`) is that band's lower bound. Pairing rule: an
 * action's `REVEAL_CLASS` threshold must equal the lower bound of the band
 * where it enters `INLINE_AT_BAND`, so each action is inline exactly when it
 * is absent from the active menu — never in both, never in neither. The
 * ladder-consistency test enforces this; change both tables together.
 */
export const TOOLBAR_BANDS: readonly ToolbarBand[] = [
  { name: 'tiny', menuClass: 'inline-flex @tts-mini:hidden' },
  { name: 'mini', menuClass: 'hidden @tts-mini:inline-flex @tts-narrow:hidden' },
  { name: 'compact', menuClass: 'hidden @tts-narrow:inline-flex @sm:hidden' },
  { name: 'narrow', menuClass: 'hidden @sm:inline-flex @md:hidden' },
  { name: 'small', menuClass: 'hidden @md:inline-flex @xl:hidden' },
  { name: 'mid', menuClass: 'hidden @xl:inline-flex @tts-full:hidden' },
  { name: 'wide', menuClass: '' },
  { name: 'full', menuClass: '' },
]

/** Actions revealed inline when entering each band; earlier reveals persist. */
const INLINE_AT_BAND: Record<ToolbarMode, Record<ToolbarBand['name'], PanelAction[]>> = {
  doc: {
    tiny: [],
    mini: ['play'],
    compact: ['save'],
    narrow: ['reset'],
    small: ['copy'],
    mid: ['delete'],
    wide: ['info', 'clone', 'upload'],
    full: [],
  },
  fresh: {
    tiny: [],
    mini: ['play'],
    compact: ['save'],
    narrow: ['reset'],
    small: ['copy'],
    mid: ['info'],
    wide: ['upload'],
    full: [],
  },
}

const ALL_ACTIONS: Record<ToolbarMode, readonly PanelAction[]> = {
  doc: ['play', 'reset', 'save', 'delete', 'info', 'copy', 'clone', 'upload'],
  fresh: ['play', 'reset', 'save', 'info', 'copy', 'upload'],
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
  play: 'hidden @tts-mini:inline-flex',
  reset: 'hidden @sm:inline-flex',
  save: 'hidden @tts-narrow:inline-flex',
  copy: 'hidden @md:inline-flex',
  delete: 'hidden @xl:inline-flex',
  info: { doc: 'hidden @tts-full:inline-flex', fresh: 'hidden @xl:inline-flex' },
  clone: 'hidden @tts-full:inline-flex',
  upload: 'hidden @tts-full:inline-flex',
} as const
