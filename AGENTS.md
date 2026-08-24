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

- `requirement.md` is the source of truth for the web app's user-facing
  behavior; when it conflicts with the migrated TUI docs, follow
  `requirement.md`.
- Keep responsive layout decisions in CSS so the first paint is correct on
  mobile and desktop.
- Keep all focusable controls keyboard reachable, with explicit focus styles and
  accessible names for icon-only buttons.
- Playback state must drive editor selection so the current spoken segment is
  visibly selected while audio is active.
- All user-facing strings must go through `UI_TEXT` (keyed by `UiLocale`); add
  each new string to every locale (`en`, `zh-TW`, `zh-CN`).

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

## Quality checks

Run before finishing implementation changes:

```bash
npm run check
npm run build
npm test
```
