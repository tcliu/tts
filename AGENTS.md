# AGENTS — tts

Project-specific development conventions for the TTS web app.

## Read first

- Read this `AGENTS.md` and the shared references it relies on before editing.
- When reviewing completed work, follow the `code-review` skill and report
  findings with severity, location, rule, and fix.

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

## References

- Follow `references/svelte.md` for Svelte 5 runes and effect rules.
- Follow `references/tailwind.md` for literal utility classes and runtime style
  values.
- Follow `references/accessibility.md` for focus management, keyboard access,
  labels, and reduced motion.
- Follow `references/responsive-design.md` for breakpoint and touch-target
  behavior.
- Follow `references/portals.md` for portal and overlay positioning
  (dropdown panels, tooltips, dialogs) including viewport clamping and
  flip-when-crowded placement.
- Follow `references/git.md` for commit message conventions and worktree
  isolation.

## Quality checks

Run before finishing implementation changes:

```bash
npm run check
npm run build
npm test
```
