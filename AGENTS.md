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
- Follow the Svelte 5, SvelteKit, and Tailwind conventions named in
  `References` below so UI pieces stay mutually consistent.
- Reuse this project's existing UI primitives and patterns when they fit,
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
- JSON payloads and exported metadata files use `snake_case` field names per `references/api-client.md`; map to `camelCase` only at the app boundary.
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
  dialog — use `BaseDialog` `height="fixed"` (`h-[min(78vh,640px)] min-h-[480px] sm:min-h-[520px]`) and scroll the Voices list internally.
- Keyboard focus in text/number inputs should use a single custom `focus-visible` treatment (no double ring or orange native outline); when Tab focuses a number input, place the caret at the end instead of selecting the whole value.
- BaseDialog spans full screen (sheet) only on phone-class viewports: the fixed
  scrim carries `@container` (its width equals the viewport) and the padded
  centering row plus panel use `@max-md:*` — the default Tailwind *container*
  token `md` (28rem/448px), not the viewport `md` breakpoint (48rem/768px);
  don't confuse the two. The scrim padding (`px-3 py-4`) lives on the centering
  row, not the scrim, because a container cannot query itself. Dialog sizing is
  preset via `maxWidth` (`md`/`lg`/`xl`/`2xl`/`3xl`/`4xl`/`5xl`/`6xl`/`7xl`/`fit`/`wide`) and
  `height` (`auto`/`fixed`/`tall`); callers pick a preset instead of hardcoding
  `w-`/`h-` in `className`.
- Settings Voices tab follows the aligned label + control-group row pattern (see `references/responsive-design.md`): voice model group = spoken-language selector (if any) + voice-model selector; support four states a) `label | spoken | voice`, b) `label | voice` (no spoken), c) `label` / `spoken + voice`, d) `label` / `spoken` / `voice` with voice-group left aligned across languages and stacked `flex-col` below `sm` so shrinking forces label and voice-group into separate rows.
- Documents drawer docks at `lg` (`lg:static lg:w-72` expanded, `lg:w-0` collapsed; `absolute w-64 z-20` overlay below `lg`); keep `DOCKED_QUERY` in `+page.svelte` synced with `DocumentsDrawer` and gate overlay-only dismissals with `isDocked`; collapsed docked drawer is `inert` + `aria-hidden`. Overlay drawer closes by swipe/drag left via `dragCloseLeft` gated by `!isDocked` — see `docs/spec.md` §Documents model.
- Playback toolbar is a container-query ladder (`@container`, 9 bands `tiny→full` in `toolbar-ladder.ts`) with paired `TOOLBAR_BANDS`/`INLINE_AT_BAND`/`REVEAL_CLASS` literals; thresholds are calibrated at `--text-sm` worst-Latin (`--container-tts-*` in `src/styles.css`: `4→352`, `5→432`, `6→508`) and all three tables must change together.
- Icon-only `Button` uses uniform padding (`p-1.5` for `sm`, `p-2.5` for `md`) so vertical/horizontal match; text buttons keep `px`/`py` distinction.
- Dropdown/menu option panels show at most one highlighted row at a time, shared by mouse hover and keyboard (`ArrowUp/Down`, `Home/End`). The highlight follows `useListSelection` index via `onmouseenter` and `selection.move`; the selected value is `aria-selected`/`aria-checked` + checkmark only, not a second background.
- Option panels hide only when their trigger is clipped or out of viewport after scroll (via `useDropdown` `isHostHidden` check), not on any ancestor scroll; scrolling the panel's own list never dismisses.
- Synthesis cache dialog's table spans the dialog width (`w-full`), uses `DataTable` `fillHeight` (`min-h-0 overflow-auto`) inside the `BaseDialog` `maxWidth="wide" height="tall"` (`w-[min(96vw,96rem)] h-[min(88vh,860px)] flex-col`) shell so the dialog itself never vertically scrolls; pagination handles overflow. The table is the shared `DataTable` (`tableClass`
  `w-full`, `resizable` via `use-column-resize`, `storageKey` `synthesis-cache`).
- Dialogs containing `DataTable` keep a fixed outer height via `BaseDialog` `height` preset (`fixed`/`tall`) and let the table `fillHeight` fill the remaining vertical space with pagination pinned at the bottom; do not size the dialog to the table height.

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
  attributes stay camelCase in this project. Split by coherent responsibility
  into composable factories under `src/lib/`; route components stay thin
  orchestration layers and non-reactive domain clients stay in plain `.ts`.
- Follow `references/svelte-i18n.md` for multilingual UI text via `UI_TEXT`.
- Follow `references/js-ts.md` for module design; split by coherent
  responsibility, keep dependency flow one-way, and avoid micro-modules and
  over-fragmentation.
- Follow `references/tailwind.md` for literal utility classes, runtime style
  values, and the attribute-driven palette remapping that powers themes.
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
- Follow `references/api-client.md` for `snake_case` wire payloads and
  `camelCase`-at-the-boundary mapping.
- Follow `references/cross-browser.md` for browser-owned viewport and keyboard
  differences.
- Follow `references/logging.md` for server-side structured event logging.
- Follow `references/reliability.md` for state safety, async flows, and
  concurrency guards.
- Follow `references/verification.md` for lint, typecheck, and test validation
  before finishing changes.
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
  architecture detail belongs in `ARCHITECTURE.md` and user-facing behavior in
  `docs/design.md`.

## Quality checks

Run before finishing implementation changes:

```bash
npm run check
npm run build
npm test
```
