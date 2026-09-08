/**
 * Shared chrome props for dropdown / menu / popover panels.
 * Extracted so `SelectDropdown`, `Menu` and `ChipDropdown`
 * stay consistent without copy-pasting the same three knobs.
 */

export type DropdownAlign = 'left' | 'right'

export interface DropdownPositionProps {
  /** Which edge of the trigger the panel is anchored to. */
  align?: DropdownAlign
  /** Flip to the opposite side when crowded (viewport clamping). */
  autoPlace?: boolean
}

export interface DropdownPanelProps extends DropdownPositionProps {
  /** Tailwind classes for the floating panel container. Override to theme per use. */
  panelClass?: string
}

/**
 * Phone-sheet viewport cutoff shared by `Menu` bottom sheets and the
 * `SelectDropdown` phone row-height variant (single shared value: keep the
 * `max-[…]` class in `SelectDropdown` on `PHONE_SHEET_MAX`).
 * Mirrors `BaseDialog` sheet mode (Tailwind container token `md` = 28rem);
 * keep the two in sync or phone menus and phone dialogs diverge.
 */
export const PHONE_SHEET_MAX = '27.999rem'
export const PHONE_SHEET_QUERY = `(max-width: ${PHONE_SHEET_MAX})`

export const CHIP_PANEL_BASE =
  'fixed left-0 top-0 z-40 max-h-[min(50vh,20rem)] w-64 rounded-xl border border-slate-800 bg-slate-900/95 shadow-2xl shadow-slate-950/60 backdrop-blur'

export const DEFAULT_CHIP_PANEL_CLASS = `${CHIP_PANEL_BASE} overflow-y-auto p-1`
