# AGENTS — tts
Project-specific development conventions for the TTS web app.

## Agent progress

- For non-trivial tasks, apply the `agent-progress` skill alongside the primary skill; trivial single-step edits skip it.

## Skill routing

- Trivial single-skill requests invoke the matching skill directly, without routing; route non-trivial, composite, or ambiguous requests through the `skill-routing` skill.
- Honor the selected skills' approval, verification, and scope constraints.

## File editing

- Edit with the smallest possible range: select only the lines that change and put their complete final content in the edit body; if an edit is rejected or the file changed since the last read, re-read the section and issue a new minimal edit rather than retrying.

## Read first
- Read the shared references applicable to the files being edited before
  editing, keeping pre-edit investigation within the `agent-progress` read cap.
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
    user opts to apply them on top of the current worktree. Branch names use
    `<type>/<change-name>` (`type` from the conventional-commit set: `feat`,
    `fix`, `refactor`, …) and the worktree path mirrors the branch
    (`.worktrees/<type>/<change-name>`). Create worktrees with
    `node scripts/create-worktree.mjs <branch>` from the default worktree; it
    copies the gitignored local dev files (`.env`, `.env.local`) and
    sets `DEV_TAG=<branch>` in the new worktree's `.env.local` so the bottom-left
    worktree-tag block identifies the branch.
- Z ladder: sticky content `z-10`, drawer `z-20`, overlays (dialog scrim, menus,
  dropdown panels, tooltip) `z-40`, dev tag `z-50` — keep overlays at or below
  `z-40` so the tag is never covered by a tooltip or modal scrim.
- Server-side events log through `src/lib/server/logging` following `references/logging.md`: every state-changing action emits a structured `ip=<ip> action=<action> ...` line carrying key identifying info, and async operations also log `_start`/`_end` with `elapsed_ms`; never log secrets, tokens, or document contents.
- Server validates required prod env at startup via `assertProdEnv` (`src/lib/server/env.ts`, called from `hooks.server.ts`): missing prod credentials log `env_invalid` and throw fail-fast; see `docs/spec.md` for the gate semantics.
- User accounts self-register at `/login` with HMAC-signed `httpOnly` `sameSite=strict` sessions; normalize usernames/emails, hash with scrypt, reject the admin username, and share the admin IP-keyed brute-force bucket — see `docs/spec.md` §Auth model.
- Expose tunable policy thresholds as managed admin properties (file → environment → compiled default via `src/lib/server/admin-properties`) instead of hardcoded constants, per `references/js-ts.md`.
- Throwaway e2e accounts use `e2e_<purpose>_<timestamp>` usernames (`load_<purpose>_<timestamp>` for stress runs, which never target prod); machine rows are identifiable via `LIKE 'e2e\_%'` and must be deleted after the run.
- Database is dual-backend (dev SQLite, prod Neon via `DATABASE_URL`); follow `references/sql.md` with Postgres-first `sql/schema.sql` and apply prod schema via `npm run schema:apply` — see `ARCHITECTURE.md` for backend topology.
- Persist shared authentication throttles in the configured database, not process-local memory, so limits hold across serverless instances. Do not clear a shared IP failure bucket after an unrelated successful login; let the configured window expire.
- Enforce authentication invariants in the domain model as well as HTTP routes: reject reserved identities and short passwords at `createUser`, and expose stable generic registration error codes so account existence cannot be enumerated.
- Enforce per-user document quotas on writes inside a transaction; enable SQLite foreign keys so development matches production ownership and cascade behavior.
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
  each new string to every locale (`en`, `zh-TW`, `zh-CN`). Surface server
  failures as stable wire codes mapped to localized strings; never surface raw
  English literals or technical detail as user-facing errors.
- The app shell fills the dynamic viewport with `h-dvh` over the
  `html/body { min-height: 100% }` base, with non-shrinking chrome
  (`shrink-0` header, `flex-none` rows) and one flexible editor region; do not
  add `min-h-screen`, clip the shell with `overflow-hidden`, or chase mobile
  keyboard gaps with viewport-unit workarounds — those differences are owned by
  the browser (see `references/cross-browser.md`).
- Defer editor focus with `tick()` whenever creating a new document changes drawer or dialog visibility (`focusEditor` in `+page.svelte`); synchronous focus into a just-hidden or not-yet-shown subtree is silently dropped. Opening an existing document keeps focus behavior owned by the drawer interaction.
- Controls that would move focus away from the editor (preview toggles, drawer
  buttons, list-collapse buttons) pass the `Button` `preventFocusSteal` prop so
  the button never takes focus on `pointerdown` while its `click` still fires;
  raw controls use `onpointerdown={e => e.preventDefault()}` for the same effect.
- Settings dialog keeps the same outer size across all tabs, anchored to the
  Voices tab (largest content); Speed and Synthesis tabs must not shrink the
  dialog — use the `BaseDialog` `height="fixed"` preset and scroll the Voices
  list internally (see `docs/spec.md` §Settings model).
- Keyboard focus in text/number inputs should use a single custom `focus-visible` treatment (no double ring or orange native outline); when Tab focuses a number input, place the caret at the end instead of selecting the whole value.
- BaseDialog spans full screen (sheet) only on phone-class viewports: the
  sheet threshold is the Tailwind *container* token `md` (28rem/448px), not
  the viewport `md` breakpoint (48rem/768px) — don't confuse the two. Dialog
  sizing is preset via `maxWidth` and `height`; callers pick a preset instead
  of hardcoding `w-`/`h-` in `className` (implementation detail in
  `docs/spec.md` §Settings model).
- Settings Voices tab follows the aligned label + control-group row pattern (see `references/responsive-design.md`): voice model group = spoken-language selector (if any) + voice-model selector; support four states a) `label | spoken | voice`, b) `label | voice` (no spoken), c) `label` / `spoken + voice`, d) `label` / `spoken` / `voice` with voice-group left aligned across languages and stacked `flex-col` below `sm` so shrinking forces label and voice-group into separate rows.
- Documents drawer docks at `lg` and gates overlay-only dismissals (backdrop,
  Escape, swipe) with `isDocked`; keep `DOCKED_QUERY` in `+page.svelte` synced
  with `DocumentsDrawer`; collapsed docked drawer is `inert` + `aria-hidden`.
  Overlay drawer closes by swipe/drag left via `dragCloseLeft` gated by
  `!isDocked` — see `docs/spec.md` §Documents model.
- Playback toolbar is a container-query ladder (`@container`, 9 bands
  `tiny→full` in `toolbar-ladder.ts`) with paired `TOOLBAR_BANDS`/
  `INLINE_AT_BAND`/`REVEAL_CLASS` literals; recalibrate all three tables
  together when thresholds change (calibration basis in `docs/spec.md`
  §Playback model).
- Icon-only `Button` uses uniform padding (`p-1.5` for `sm`, `p-2.5` for `md`) so vertical/horizontal match; text buttons keep `px`/`py` distinction.
- Dropdown/menu option panels show at most one highlighted row at a time, shared by mouse hover and keyboard (`ArrowUp/Down`, `Home/End`). The highlight follows `useListSelection` index via `onmouseenter` and `selection.move`; the committed value is `aria-selected`/`aria-checked` only, not a second background or checkmark — the shared highlight already marks it on hover/focus.
- Header language/theme menus keep the shared custom `Menu` component across devices; on phone-class viewports (same `<28rem` threshold as `BaseDialog` sheet mode) they present as bottom sheets with the same radio-menu semantics and focus-return behavior, not native pickers. Bottom sheets are top-level only and never stack inside a dialog: in-dialog dropdowns keep their anchored popover on all viewports (phone tap targets via CSS `min-h`, focus stays on the in-dialog trigger so the dialog focus trap holds).
- Option panels hide only when their trigger is clipped or out of viewport after scroll (via `useDropdown` `isHostHidden` check), not on any ancestor scroll; scrolling the panel's own list never dismisses.
- Synthesis cache dialog keeps a fixed outer `BaseDialog` shell (`maxWidth="wide" height="tall"`) whose table `fillHeight` fills the remaining vertical space with pagination pinned at the bottom; the dialog itself never vertically scrolls. Use the shared `DataTable` (`tableClass` `w-full`, `resizable` via `use-column-resize`, `storageKey` `synthesis-cache`).
- Dialogs containing `DataTable` keep a fixed outer height via the `BaseDialog` `height` preset (`fixed`/`tall`) and let the table `fillHeight` fill the remaining vertical space; do not size the dialog to the table height.

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
- When recording a convention borrowed from a sibling project, describe only the rule and its content; never name the source project.
- This `AGENTS.md` holds project-specific *development conventions* — rules to
  follow when writing code — not feature descriptions or implementation
  narratives. Keep each bullet to the rule plus the briefest rationale;
  architecture detail belongs in `ARCHITECTURE.md` and user-facing behavior in
  `docs/design.md`.

## Quality checks

- Trivial non-behavioral edits (docs, comments, strings) need only a targeted
  check (e.g. `npm run check` or the single affected test).
- Run the full suite before finishing behavior-affecting changes or handing
  off a worktree:

```bash
npm run check
npm run build
npm test
```
