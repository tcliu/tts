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
  worktree-tag block identifies the branch.
- Server-side events log through `src/lib/server/logging` following
  `references/logging.md`: every state-changing action emits a structured
  `ip=<ip> action=<action> ...` line carrying key identifying info, and async
  operations also log `_start`/`_end` with `elapsed_ms`; never log secrets,
  tokens, or document contents.
- Temporary scratch files (plans, proposals, scratch notes) go in `.tmp/`,
  never in source directories.

## UI behavior

- Keep responsive layout decisions in CSS so the first paint is correct on
  mobile and desktop.
- Keep all focusable controls keyboard reachable, with explicit focus styles and
  accessible names for icon-only buttons.
- Playback state must drive editor selection so the current spoken segment is
  visibly selected while audio is active.
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
- Follow `references/responsive-design.md` for breakpoint and touch-target
  behavior.
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
