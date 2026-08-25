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
- A top toolbar with the title on the left and language/theme/settings actions
  on the right.
- A main column containing playback controls and the editor.
- A settings dialog built on the shared `BaseDialog` pattern.
- Domain logic lives in composable factories under `src/lib/`:
  - `use-settings.svelte.ts` owns user preferences, persistence, and voice
    resolution.
  - `use-playback.svelte.ts` owns the playback engine, session state, progress,
    and status messaging.
  - `use-metadata.svelte.ts` owns boundary rows, search/follow state, staleness,
    and background resync.
  - `use-documents.svelte.ts` owns the `localStorage`-backed document store
    (list, save, rename, delete) and hydration.
  - `use-documents-drawer.svelte.ts` owns drawer open state and name search.
  - `use-document-editor.svelte.ts` owns the current-document identity, dirty
    state, and the save/rename/clone/delete/upload/discard dialog flows.
  - `tts-client.ts` is the non-reactive synthesis API with its LRU cache.
- The route component stays a thin orchestration layer that wires composables
  to view components.

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
- Upcoming segments synthesize in parallel while the current one plays, capped
  by the Synthesis concurrency setting; cancellation (Stop or unmount) aborts
  in-flight synthesis requests and settles the active audio element.
- While a segment is active, the matching editor text range is selected.
- Stopping playback preserves the current selection.
- When playback finishes, restore the pre-playback selection state so the editor
  returns to the selection the user had before playback started.
- A metadata pipeline records per-sentence boundaries for the session. Editing
  the content invalidates it and re-synthesizes segments in a bounded,
  cancellable background pass to refresh boundaries.

## Documents model

- Documents are a browser-only, `localStorage`-backed store keyed by an id with
  a name, content, and `updatedAt` timestamp; server-side persistence and
  resumable-upload libraries do not apply — there is no document endpoint.
- `use-documents` validates each stored record on read and writes the full list
  on every mutation; it sorts the visible list by `updatedAt` descending.
- `use-document-editor` tracks the open document id and a baseline snapshot of
  the editor content; `isDirty` is the comparison between the baseline and the
  live content. Save, rename, clone, delete, upload, and reset all route through
  discard confirmation when `isDirty` is true.
- Saving under a name owned by another document stacks a replace-confirmation on
  top of the save dialog rather than destroying it silently.
- The drawer is a view over `use-documents-drawer`'s filtered list; it only
  triggers handlers on the document editor and never mutates the store directly.

## Upload model

- Upload imports a local text file into the editor; it is a client-side read
  (`Blob.text()`), not a network upload, so resumable-upload libraries (tus,
  Uppy) do not apply — they require a server-side endpoint, and documents live
  only in the browser.
- The page hosts a hidden `input type="file"`; the document editor composable
  owns validation (UTF-8 byte cap plus an all-readable-text scan: disallowed C0
  controls, DEL, and the replacement character that invalid byte sequences
  decode to), discard confirmation reuse, content replacement, and transient
  status feedback.
- The Upload button is also a file drop target: the composable stores the
  dropped file as the pending upload so confirming the discard imports it
  instead of opening the picker. Non-file drags are ignored.

## Synthesis service

- The client posts `{ text, voice, rate }` to `POST /api/tts/synthesize`.
- The endpoint validates the voice against the reference voice list, caps text
  length, and returns base64 MP3 audio with sentence-boundary metadata.
- `$lib/server/edge-tts` speaks to the Edge read-aloud WebSocket service with
  an overall timeout; any close that bypasses the completion signal fails the
  request rather than leaving it pending.
- `$lib/server/tts-cache` persists synthesis results on disk under `.tts/`
  behind an injectable directory, keyed by the shared `$lib/tts-cache-key`
  builder, with a time-to-live envelope. The client keeps a small LRU of
  decoded blobs for the session.

## Settings model

- Supported languages and voice options come from the reference script.
- Languages with a single spoken-language group expose one voice-model
  dropdown.
- Languages with multiple spoken-language groups expose a spoken-language
  dropdown plus a voice-model dropdown scoped to that spoken language.
- Default speed options must match the speed list in `tts.mjs`.

## Theming

- `use-settings` owns the theme preference (`dark`, `light`, `ember`, `sepia`,
  `nebula`, `sky`) through the same persisted, validated settings flow as the
  other preferences. Dark is the default and needs no DOM attribute; every
  other theme sets `data-theme` on `<html>`.
- A pre-paint inline script in `app.html` applies the stored theme before first
  paint; its allowlist must stay in lockstep with the theme union and its
  validation in `use-settings`.
- Components keep literal default-theme utility classes. `src/styles.css`
  re-themes centrally by overriding Tailwind palette variables per
  `[data-theme='…']` block; the mapping rules are documented there. Ink on
  vivid accent fills uses the fixed `text-onaccent` token, never a remapped
  slate grade.
- The editor swaps its CodeMirror base theme and chrome colors through a
  compartment driven by the same theme value.
- The theme menu's option list, localized labels, and trigger-icon map
  enumerate the themes; extend them together with the union.
- Both header radio menus render through the shared `HeaderRadioMenu`
  component, which owns open state, portal placement, dismissal, and roving
  keyboard handling via `$lib/menu-keyboard`.

## Constraints

- Ignore everything under `archive/` for implementation decisions.
- Do not consult any existing archived web implementation.
- Keep the app accessible and responsive as first-order requirements, not polish
  tasks.
