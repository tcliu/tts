# AGENTS — tts

Project-specific development conventions for the TTS web app.

## Read first

- Read this `AGENTS.md` and the shared references it relies on before editing.
- When reviewing completed work, follow the `code-review` skill and report
  findings with severity, location, rule, and fix.
- When a task is ambiguous about what to change or how to approach it, ask the
  user to clarify or present up to three concrete options before editing, to
  avoid unwanted changes.

## Architecture

- The project root hosts the browser app; `tts.mjs` stays in the repo as the
  behavioral reference for supported voices, speeds, segmentation, and playback
  flow.
- Follow the same Svelte 5, SvelteKit, and Tailwind conventions used by
  `../share-text` so UI pieces can be reused with minimal reshaping.
- Reuse existing UI primitives and patterns from `../share-text` when they fit,
  especially dialog, dropdown, editor, and icon components; do not build a
  parallel design system for equivalent controls.
- Do not read or reuse any archived web implementation under `archive/`; it is
  out of scope for this project.
- Code changes are applied in a separate git branch and worktree under
  `.worktrees/` per the shared `references/git.md` worktree practice, unless the
  user opts to apply them on top of the current worktree. Create worktrees with
  `node scripts/create-worktree.mjs <branch>` from the default worktree; it
  copies the gitignored local dev files (`.env`, `.env.local`, `.env.dev`) and
  sets `DEV_TAG=<branch>` in the new worktree's `.env.dev` so the bottom-left
  worktree-tag block identifies the branch. Z ladder: sticky content `z-10`,
  drawer `z-20`, overlays (dialog scrim, menus, dropdown panels, tooltip)
  `z-40`, dev tag `z-50` — keep overlays at or below `z-40` so the tag is never
  covered by a tooltip or modal scrim.
- Server-side events log through `src/lib/server/logging` following
  `references/logging.md`: every state-changing action emits a structured
  `ip=<ip> action=<action> ...` line carrying key identifying info, and async
  operations also log `_start`/`_end` with `elapsed_ms`; never log secrets,
  tokens, or document contents.
- Written language is the top-level `code` in `reference-languages.json`; spoken variants are `aliases` there (e.g. `yue`→`zh`) resolved via `toWrittenLang` in `tts-reference.ts` with fixed groups in `SPOKEN_GROUP` (e.g. `yue`→`Cantonese`); voice variants are the per-voice `group` (e.g. Mandarin/Cantonese/Taiwanese under `zh`).
- Temporary scratch files (plans, proposals, scratch notes) go in `.tmp/`,
  never in source directories.
- Feature requirements for in-progress work go in `.tmp/features/{feature-name}.md`.
  Treat them as supplementary context during implementation and review, but keep
  source-of-truth conventions in `AGENTS.md` and durable design/spec details in
  `docs/design.md` and `docs/spec.md`.

## UI behavior

- Keep responsive layout decisions in CSS so the first paint is correct on
  mobile and desktop.
- Keep all focusable controls keyboard reachable, with explicit focus styles and
  accessible names for icon-only buttons.
- Keep non-interactive scroll wrappers out of the tab order (`tabindex="-1"` on overflow containers in dialogs, drawers, tables) so Tab lands only on interactive controls.
- Playback state must visibly highlight the current spoken word or segment in
  the editor while audio is active (`--cm-playbackHighlight` light-blue, `--cm-playbackHighlightSelected` emerald green when inside a manual text selection), but keep any pre-existing native text selection intact under the playback overlay; pointer range selection is collapsed to caret during playback so the native selection cannot drift while caret movement remains enabled to seek. The Info panel active row stays light-blue (cyan) in both modes.
- A cached manual text selection may scope the controls and Info panel before
  playback starts, but it must not pre-highlight the first selected word until
  Play is clicked.
- Document navigation is reflected in the URL as `{base}/{docId}` and history-backed so Back/Forward moves between documents.
- All user-facing strings must go through `UI_TEXT` (keyed by `UiLocale`); add
  each new string to every locale (`en`, `zh-TW`, `zh-CN`).
- The app shell fills the dynamic viewport with `h-dvh` over the
  `html/body { min-height: 100% }` base, with non-shrinking chrome
  (`shrink-0` header, `flex-none` rows) and one flexible editor region; do not
  add `min-h-screen`, clip the shell with `overflow-hidden`, or chase mobile
  keyboard gaps with viewport-unit workarounds — those differences are owned by
  the browser (see `references/cross-browser.md`).
- Defer editor focus with `tick()` whenever drawer or dialog state changes
  visibility (`focusEditor` in `+page.svelte`); synchronous focus into a
  just-hidden or not-yet-shown subtree is silently dropped.
- Controls that would move focus away from the editor (preview toggles, drawer
  buttons, list-collapse buttons) pass the `Button` `preventFocusSteal` prop so
  the button never takes focus on `pointerdown` while its `click` still fires;
  raw controls use `onpointerdown={e => e.preventDefault()}` for the same effect.
- Settings dialog keeps the same outer size across all tabs, anchored to the
  Voices tab (largest content); Speed and Synthesis tabs must not shrink the
  dialog — fix the outer height and scroll the Voices list internally.
- Keyboard focus in text/number inputs should use a single custom `focus-visible` treatment (no double ring or orange native outline); when Tab focuses a number input, place the caret at the end instead of selecting the whole value.
- BaseDialog spans full screen (sheet) only on phone-class viewports: the fixed
  scrim carries `@container` (its width equals the viewport) and the padded
  centering row plus panel use `@max-md:*` — the default Tailwind *container*
  token `md` (28rem/448px), not the viewport `md` breakpoint (48rem/768px);
  don't confuse the two. The scrim padding (`px-3 py-4`) lives on the centering
  row, not the scrim, because a container cannot query itself.
- Settings Voices tab follows the aligned label + control-group row pattern (see `references/responsive-design.md`): voice model group = spoken-language selector (if any) + voice-model selector; support four states a) `label | spoken | voice`, b) `label | voice` (no spoken), c) `label` / `spoken + voice`, d) `label` / `spoken` / `voice` with voice-group left aligned across languages and stacked `flex-col` below `sm` so shrinking forces label and voice-group into separate rows.
- Documents drawer is docked at `lg` with two states: expanded (`lg:static lg:w-72`) and header-toggle collapsed (`lg:static lg:w-0`), and overlayed below it (`absolute inset-y-0 left-0 w-64 z-20`) on smaller viewports; keep `DOCKED_QUERY` (`(min-width: 64rem)`) in `+page.svelte` synced with `DocumentsDrawer`'s `lg:*` classes and gate overlay-only dismissals (click-outside, Escape, swipe) with `isDocked`.
- A docked-collapsed drawer must be non-interactive (`inert` + `aria-hidden`) so keyboard focus cannot move into hidden controls.
- Overlay drawer must close by dragging/swiping left on mobile — the shared
  `dragCloseLeft` action owns the pointer state machine (touch/pen only,
  `touch-action: pan-y`, pointer capture, horizontal dominance, left-only
  motion, clamped `translateX`) and dismisses on ~30% width or fast-swipe
  (>0.5px/ms and >40px) threshold; `DocumentsDrawer` renders the drag offset,
  suppresses the snap animation when `prefers-reduced-motion: reduce` is active,
  and routes `onClose` through `dismissDrawerAndFocusTrigger` to return focus;
  disable the gesture when docked (see `references/responsive-design.md`).
- Playback toolbar is a container-query ladder (`@container`, 9 bands `tiny→full` in `toolbar-ladder.ts`) with paired `TOOLBAR_BANDS`/`INLINE_AT_BAND`/`REVEAL_CLASS` literals; thresholds are calibrated at `--text-sm` worst-Latin (`--container-tts-*` in `src/styles.css`: `4→352`, `5→432`, `6→508`) and all three tables must change together.
- Icon-only `Button` uses uniform padding (`p-1.5` for `sm`, `p-2.5` for `md`) so vertical/horizontal match; text buttons keep `px`/`py` distinction.
- Dropdown/menu option panels show at most one highlighted row at a time, shared by mouse hover and keyboard (`ArrowUp/Down`, `Home/End`). The highlight follows `useListSelection` index via `onmouseenter` and `selection.move`; the selected value is `aria-selected`/`aria-checked` + checkmark only, not a second background.
- Option panels hide only when their trigger is clipped or out of viewport after scroll (via `useDropdown` `isHostHidden` check), not on any ancestor scroll; scrolling the panel's own list never dismisses.
- Synthesis cache dialog's table spans the dialog width (`w-full`), uses `DataTable` `fillHeight` (`min-h-0 overflow-auto`) inside the `BaseDialog` `max-h-[min(84vh,760px)] flex-col` shell so the dialog itself never vertically scrolls; pagination handles overflow. The table is the shared `DataTable` (`tableClass` `w-full`, `resizable` via `use-column-resize`, `storageKey` `synthesis-cache`) following the admin Users table (`src/lib/components/AdminUsersView.svelte` in `../share-text`).

## Theming

- Theme palettes live only in `src/styles.css` as `[data-theme]` overrides of
  the Tailwind palette variables; do not add per-component theme conditionals
  or duplicate palette values.
- Ink on vivid accent fills uses the fixed `text-onaccent` token, never a
  remapped slate grade.
- Adding or renaming a theme means updating every sync point in one change
  (see `docs/spec.md` § Theming); missed sync points silently fall back to the
  default palette.

## References

- Follow `references/svelte.md` for Svelte 5 runes and effect rules; component
  attributes stay camelCase in this project.
- Follow `references/tailwind.md` for literal utility classes and runtime style
  values.
- Follow `references/tailwind-theming.md` for the attribute-driven palette
  remapping that powers the app's themes.
- Follow `references/accessibility.md` for focus management, keyboard access,
  labels, and reduced motion.
- Follow `references/responsive-design.md` for breakpoint, touch-target, and
  overlay-drawer (docked vs overlay, swipe-to-close) behavior.
- Follow `references/portals.md` for portal and overlay positioning
  (dropdown panels, tooltips, dialogs) including viewport clamping and
  flip-when-crowded placement.
- Follow `references/ui-patterns.md` for dialogs (centered/full-screen, dismiss
  affordances, focus-first-input), form dialogs (OK/Apply + Reset, discard
  unsaved-changes confirm), icons, comboboxes, and the two-arrow table sort
  pattern.
- Follow `references/logging.md` for server-side structured event logging.
- Follow `references/git.md` for commit message conventions and worktree
  isolation.

## Keeping references in sync

- When a code change establishes or revises a project-specific convention, update
  this `AGENTS.md` in the same change.
- When a code change establishes or revises a generic reusable convention, update
  the appropriate file under `$AI_CONFIG_DIR/references/` in the same change rather
  than duplicating it here.
- Shared reference files under `$AI_CONFIG_DIR/references/` must stay generic and
  implementation-agnostic: no project-specific paths, component names, routes, or
  internal identifiers. Put project-level details in this `AGENTS.md` instead.
- This `AGENTS.md` holds project-specific *development conventions* — rules to
  follow when writing code — not feature descriptions or implementation
  narratives. Keep each bullet to the rule plus the briefest rationale;
  architecture detail belongs in `docs/spec.md` and user-facing behavior in
  `docs/design.md`.

## Quality checks

Run before finishing implementation changes:

```bash
npm run check
npm run build
npm test
```
