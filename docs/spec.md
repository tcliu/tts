# Spec — Behavioral contracts

This document describes what the system does and the contracts it obeys. For
how the code is organized, see `ARCHITECTURE.md`; for what the user sees and
does, see `docs/design.md`; for how to write code in this project, see
`AGENTS.md`.

## Overview

The project exposes a browser-based TTS editor. The existing `tts.mjs` script
remains in the repository as the reference for supported languages, voices,
speeds, text segmentation, and sequential segment playback behavior.

## Playback model

- A non-empty manual text selection before Play narrows playback scope to that
  selected substring. The substring is trimmed before synthesis/cache lookup so
  leading or trailing spaces do not fragment cache entries.
- When the trimmed selection starts and ends on whole-word boundaries and every
  covering source segment already has cached synthesis for the active voice and
  speed, playback reuses those cached blobs by slicing only the selected words
  from the source timeline into scoped session segments; if the first or last
  selected word is partial, or any covering segment is uncached, playback falls
  back to synthesizing the trimmed selected substring as a fresh scoped segment.
- A collapsed selection behaves as a caret position, not as a scoped playback
  request.
- The full playback text is segmented using the same rules as `tts.mjs`.
- Segments are played sequentially.
- Upcoming segments synthesize in parallel while the current one plays, capped
  by the Synthesis concurrency setting; cancellation (Stop or unmount) aborts
  in-flight synthesis requests and settles the active audio element.
- While a segment is active, playback timing follows word boundaries when they
  are available and the editor renders the current spoken word through a
  dedicated playback-highlight overlay (`--cm-playbackHighlight` light-blue for
  full-document, `--cm-playbackHighlightSelected` emerald green when the word
  lies inside a manual text selection); the Info panel's active row stays light-blue (cyan) in both modes. Sentence boundaries remain the metadata-table rows.
- Playback never mutates the user's native text selection. During playback the
  editor collapses any range selection to a caret so the native selection cannot
  drift while the overlay highlight advances, but caret movement (click/arrow)
  remains enabled to seek playback.
- Before playback starts, a cached scoped selection may prime the controls and
  Info panel with selected-text-only metadata, but it must not pre-highlight the
  first selected word in the editor.
- Stopping or finishing playback clears only the playback-highlight overlay.
- A metadata pipeline records per-sentence boundaries for the session. When a
  voice under-splits CJK text (e.g. spaces or commas separating sentences),
  `src/lib/bracket-merge.ts` `shouldUseRangeRows` falls back to highlight ranges
  with interpolated timing (`syntheticRangeAt`) so each sentence still surfaces as
  its own row. Editing the content invalidates the pipeline and re-synthesizes
  segments in a bounded, cancellable background pass to refresh boundaries. Info
  panel sentence/word speaker buttons first reuse already-cached segment audio:
  `src/lib/playback/isolated.ts` `createIsolatedPlayer` falls back to isolated
  fragment synthesis (`getCachedSynthesis`) only when no reliable cached window
  can be derived from the segment's boundaries and range offsets.
- The session keeps two override maps: per-segment language overrides and
  per-language voice overrides. Both live only in the active session (cleared
  when the session is re-primed or reset), never touch the persisted settings,
  and the pipeline resolves each segment's voice at launch time through them.
  Before synthesis the effective voice is the persisted default; after a
  cache hit or successful synthesis the voice is pinned to that written
  language so the chip stays sticky across position navigation until a manual
  chip pick overwrites it or cache clear / reset wipes it.
- Changing the voice model during playback pauses at the current word: the
  spoken position maps to a character offset through the old voice's word
  boundaries (duration-ratio interpolation when boundaries are missing), the
  segment resynthesizes with the new voice, and playback resumes from the same
  word mapped onto the new voice's boundaries. A stop landing at the spoken end
  finishes playback instead of resuming; a paused voice change remaps the
  stored resume time the same way so the next Play starts at the same word.

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
  (`lg:static`) with header-toggle open/collapsed width states (`lg:w-72` /
  `lg:w-0`); collapsed docked mode marks the drawer `inert` + `aria-hidden` so
  hidden controls are not keyboard focus targets. The overlay supports closing
  by dragging/swiping left through
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
   length, and returns base64 MP3 audio with sentence-boundary metadata as
   `snake_case` fields (`word_boundaries`, `spoken_start`, `spoken_end`) per
   `references/api-client.md`; the client maps to `camelCase` at the boundary
   and accepts legacy `camelCase` during rollout, and `$lib/server/tts-cache`
   normalizes both shapes on read.
- `$lib/server/edge-tts` speaks to the Edge read-aloud WebSocket service with
  an overall timeout; any close that bypasses the completion signal fails the
  request rather than leaving it pending.
- `POST /api/tts/synthesize` is rate-limited per IP (`TTS_RATE_LIMIT_MAX` per
  60s, default `60` via `src/lib/server/rate-limit.ts` `RETRY_AFTER_S`); cache
  hits / `304` are exempt and do not count toward the budget.
- `$lib/server/tts-cache` persists synthesis results on disk under `.tts/`
  behind an injectable directory, keyed by the shared `$lib/tts-cache-key`
  builder, with a time-to-live envelope stamped with a content-hash ETag;
  a request carrying `If-None-Match` that matches answers `304` without body.
- The client keeps a small LRU of decoded blobs for the session and mirrors
  synthesized segments in IndexedDB (bounded count). After a reload it verifies
  its local copy with `If-None-Match` and reuses the stored blob on `304`;
  warm-up waits for the IndexedDB hydration to land before scanning segments.
- Cache entries are keyed by trimmed `(text, voice)` at a single canonical
  synthesis rate; the server always synthesizes at 1× and the client scales
  playback via `HTMLAudioElement.playbackRate = effectiveSpeed / segRate`, so
  switching playback speed reuses the same cached audio instead of evicting it.
  A different voice still stores a separate entry; identical content with the
  same voice reuses the cached audio.
- Each persisted entry is tagged with the document id, so the cache can be
  cleared for a single document (the Reset action clears the open document's
  cached audio) or for every document from the Settings Synthesis tab (Cache entry).
  The Synthesis cache View dialog's `Clear` deletes only the selected keys from
  both the in-memory LRU and IndexedDB (`deletePersistedSegments`) and refreshes
  the summary.
- Clearing all client-side synthesis cache while the editor is open resets the
  active playback session and metadata rows when the current document has any
  surfaced playback/cache state; clearing selected cache entries resets them
  only when the current playback/caret scope's segment (`src/lib/tts-cache-clear.ts`
  `isScopeInvalidatedByClearedKeys`) is among the cleared entries.

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
- The Speed tab shows the default speed as a NumberInput (`0.25–3`, step `0.25`,
  default `1`); the Synthesis tab shows the Synthesis concurrency NumberInput
  (`1–8`, step `1`) and a Cache summary (`segments · bytes`) with `Clear all`
  and `View` (the `View` dialog is a second `BaseDialog` with a selectable
  `Lang`/`Voice`/`Text`/`Size`/`Saved` table, sticky header, `SearchInput`,
  `contain-layout`, and a `Play` control that stops main playback first).
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
- Both header radio menus render through the shared `Menu` component
  (radio variant with `Tooltip`), which owns open state, portal placement
  via `positionPanel`, dismissal via `useDropdown`, and roving keyboard
  handling via `useListSelection`.

## Constraints

- Ignore everything under `archive/` for implementation decisions.
- Do not consult any existing archived web implementation.
- Keep the app accessible and responsive as first-order requirements, not polish
  tasks.
