/**
 * Shared chrome props for dropdown / menu / popover panels. Extracted so
 * `SelectDropdown`, `Menu` and `ChipDropdown` stay consistent without
 * copy-pasting the same knobs.
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

/**
 * `SelectDropdown` button/option classes matching a native select footprint
 * (12.5px font, 6px/9px padding, no min-width) so the control swaps in
 * invisibly wherever it replaces one. Passed through
 * `buttonClass`/`optionClass`, which replace the component defaults wholesale
 * — keep these in sync with the `SelectDropdown` base classes. Font and
 * line-height carry `!` where the host stylesheet sets `font:inherit` on bare
 * buttons (unlayered author CSS beats utilities).
 */
export const NATIVE_SELECT_BUTTON_CLASS =
  'inline-flex cursor-pointer items-center justify-between gap-2 rounded-md border border-slate-700 bg-slate-950 px-[9px] py-[6px] text-slate-100 outline-none transition motion-reduce:transition-none hover:border-cyan-500 focus-visible:border-cyan-500 text-[12.5px]! leading-[1.2]!'
export const NATIVE_SELECT_OPTION_CLASS =
  'flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-[9px] py-[6px] text-left outline-none transition motion-reduce:transition-none max-[27.999rem]:min-h-11 text-[12.5px]!'

export const CHIP_PANEL_BASE =
  'fixed left-0 top-0 z-40 max-h-[min(50vh,20rem)] w-64 rounded-xl border border-slate-800 bg-slate-900/95 shadow-2xl shadow-slate-950/60 backdrop-blur'

export const DEFAULT_CHIP_PANEL_CLASS = `${CHIP_PANEL_BASE} overflow-y-auto p-1`
