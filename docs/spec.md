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

- Playback always synthesizes and caches the full editor content; a manual text
  selection never narrows synthesis scope, it only selects the segment and word
  boundary where playback starts.
- When a manual text selection exists, playback snaps to the first available
  word boundary inside that selection; if the selection begins mid-word or no
  in-range word boundary exists yet, it falls back to the nearest earlier
  boundary in the same segment.
- The full playback text is segmented using the same rules as `tts.mjs`.
- Segments are played sequentially.
- Upcoming segments synthesize in parallel while the current one plays, capped
  by the Synthesis concurrency setting; cancellation (Stop or unmount) aborts
  in-flight synthesis requests and settles the active audio element.
- While a segment is active, playback timing follows word boundaries when they
  are available and the editor selects the current spoken word. Sentence
  boundaries remain the metadata-table rows.
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
  Below `lg` it overlays the content (`absolute`) and above it docks inline
  (`lg:static`); the overlay supports closing by dragging/swiping left through
  the shared `dragCloseLeft` action (touch/pen pointers, `touch-action: pan-y`,
  horizontal dominance, clamped `translateX`, ~30% width or fast-swipe
  threshold) gated by the docked state, and returns focus to the trigger on
  close.
- History: the page lives at `src/routes/[[docId]]/+page.svelte` (optional single segment) so `/{docId}` deep-links render the same shell and avoid a 404. Navigation is reflected as `{base}/{docId}` (base path for a fresh buffer) via `src/lib/document-history.ts`; Open, New, Save, Clone, and Delete-current push a new entry (`pushDocHistory`), pure content edits do not, `popstate` and initial load replay through the single guarded path `editor.handleHistoryNavigation` (which reverts with `replaceDocHistory` when the discard/playback gates trip).

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
  builder, with a time-to-live envelope stamped with a content-hash ETag;
  a request carrying `If-None-Match` that matches answers `304` without body.
- The client keeps a small LRU of decoded blobs for the session and mirrors
  synthesized segments in IndexedDB (bounded count). After a reload it verifies
  its local copy with `If-None-Match` and reuses the stored blob on `304`;
  warm-up waits for the IndexedDB hydration to land before scanning segments.
- Cache entries are keyed by `(text, voice, rate)`, so a different voice or speed
  stores a separate entry; identical content with the same voice and speed reuses
  the cached audio.
- Each persisted entry is tagged with the document id, so the cache can be
  cleared for a single document (the Reset action clears the open document's
  cached audio) or for every document from the Settings Synthesis tab (Cache entry).

## Settings model

- Supported languages and voice options come from the reference script.
  Chinese exposes the spoken-language groups `Mandarin`, `Cantonese`,
  `Taiwanese`, and `Northeastern Mandarin` (Cantonese voices are merged into
  Chinese; labels omit `Traditional`/`Simplified`).
- Languages with a single spoken-language group expose one voice-model
  dropdown.
- Languages with multiple spoken-language groups expose a spoken-language
  dropdown plus a voice-model dropdown scoped to that spoken language.
- The Voices tab has a search box filtering by language name or voice name.
- The settings dialog keeps the same outer size across all tabs, sized to the
  Voices tab (largest); other tabs do not shrink it.
- The Speed tab shows the default speed as a NumberInput (`0.5–2`, step `0.25`,
  default `1`); the Synthesis tab shows the Synthesis concurrency NumberInput
  (`1–8`, step `1`).
- Default speed options must match the speed list in `tts.mjs`.

## Theming

- `use-settings` owns the theme preference (`dark`, `light`, `ember`, `sepia`,
  `nebula`, `sky`, `forest`, `midnight`, `mint`, `lavender`) through the same
  persisted, validated settings flow as the other preferences. Dark is the
  default and needs no DOM attribute; every other theme sets `data-theme` on
  `<html>`.
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
- The theme menu's option list, localized labels, and per-option icon map
  enumerate the themes; the trigger uses a static palette icon. Extend them
  together with the union.
- Both header radio menus render through the shared `HeaderRadioMenu`
  component, which owns open state, portal placement, dismissal, and roving
  keyboard handling via `$lib/menu-keyboard`.

## Constraints

- Ignore everything under `archive/` for implementation decisions.
- Do not consult any existing archived web implementation.
- Keep the app accessible and responsive as first-order requirements, not polish
  tasks.
