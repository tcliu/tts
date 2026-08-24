# Spec — Web app architecture

## Overview

The project will expose a browser-based TTS editor. The existing `tts.mjs`
script remains in the repository as the reference for:

- supported languages and voices
- supported playback speeds
- text segmentation rules
- sequential segment playback behavior

The browser implementation should reuse the same stack and UI primitives as
`../share-text` so the settings dialog, dropdowns, editor, and icons follow one
coherent system instead of a new parallel one.

## Planned app structure

- A root page containing a full-height shell.
- A top toolbar with the title on the left and language/settings actions on the
  right.
- A main column containing playback controls and the editor.
- A settings dialog built on the shared `BaseDialog` pattern.

## Shared component reuse

- Reuse the `CodeEditor` component pattern for the line-numbered editor.
- Reuse the `SelectDropdown` pattern for voice and speed selection.
- Reuse dialog structure and dismissal behavior from `BaseDialog`.
- Reuse shared icon components or add new icon components rather than inlining
  SVGs in feature code.

## Playback model

- Playback input is the current editor selection when one exists; otherwise it
  is the full editor content.
- The selected playback text is segmented using the same rules as `tts.mjs`.
- Segments are played sequentially.
- While a segment is active, the matching editor text range is selected.
- Stopping playback preserves the current selection.
- When playback finishes, restore the pre-playback selection state described in
  `requirement.md`.

## Settings model

- Supported languages and voice options come from the reference script.
- Languages with a single spoken-language group expose one voice-model
  dropdown.
- Languages with multiple spoken-language groups expose a spoken-language
  dropdown plus a voice-model dropdown scoped to that spoken language.
- Default speed options must match the speed list in `tts.mjs`.

## Constraints

- Ignore everything under `archive/` for implementation decisions.
- Do not consult any existing archived web implementation.
- Keep the app accessible and responsive as first-order requirements, not polish
  tasks.
