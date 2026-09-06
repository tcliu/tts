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
  `src/lib/metadata/rows.ts` `shouldUseRangeRows` falls back to highlight ranges
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

- Documents live in two stores merged by doc id: the browser `localStorage`
  store (`tts:web-documents`, each record an id, name, content, and `updatedAt`) and, for signed-in users, the per-user `user_documents` table
  behind `GET`/`PUT`/`DELETE /api/documents` (cookie-guarded, `snake_case`
  wire, `camelCase` at the boundary). The drawer lists the union,
  deduplicated by id with newest `updatedAt` winning each conflict.
- `use-documents` validates each stored record on read and writes the full
  local list on every mutation; when logged in it also pushes each mutation
  to the server fire-and-forget (failures surface as `syncError`) and pulls
  + merges the server copy on sign-in, then pushes never-synced local-only
  docs upward so logged-out drafts actually reach the server. Sign-out drops
  server-only rows fetched during the session (pre-existing local docs,
  session-created docs, and unsynced local-only docs stay) so a shared device
  does not leak the previous user's listing. It sorts the visible list by
  `updatedAt` descending. Sign-out invalidates the active sync generation, so
  a delayed server response cannot reinsert server-only rows. The server
  enforces `MAX_DOCUMENTS_PER_USER` on writes: updates to existing ids remain
  allowed at the limit, while new ids return `document_quota_exceeded`. SQLite
  enables foreign-key enforcement so local cascades match Neon.
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
- Playback toolbar: container-query ladder (`@container`, 9 bands `tiny→full`
  in `toolbar-ladder.ts`) with paired `TOOLBAR_BANDS`/`INLINE_AT_BAND`/
  `REVEAL_CLASS` literals; thresholds are calibrated at `--text-sm`
  worst-Latin via `--container-tts-*` in `src/styles.css` (`4→352`, `5→432`,
  `6→508`).
- The Synthesis cache View dialog is a `BaseDialog` `maxWidth="wide"
  height="tall"` shell (`w-[min(96vw,96rem)] h-[min(88vh,860px)] flex-col`)
  whose selectable `DataTable` (`w-full`, `resizable` via `use-column-resize`,
  `storageKey` `synthesis-cache`) fills the dialog with `fillHeight`
  (`min-h-0 overflow-auto`); pagination handles overflow and the dialog itself
  never vertically scrolls.

## Upload model

- Upload imports a local text file into the editor; it is a client-side read
  (`Blob.text()`), not a network upload, so resumable-upload libraries (tus,
  Uppy) do not apply — they require a server-side endpoint. Uploaded text is
  persisted only once it is saved as a document.
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
  Voices tab (largest); other tabs do not shrink it. The shell is `BaseDialog`
  `height="fixed"`: `h-[min(78vh,640px)] min-h-[480px] sm:min-h-[520px]`, with
  the Voices list scrolled internally. `BaseDialog` presets: `maxWidth`
  (`md`/`lg`/`xl`/`2xl`/`3xl`/`4xl`/`5xl`/`6xl`/`7xl`/`fit`/`wide`) and `height`
  (`auto`/`fixed`/`tall`); sheet mode (full-screen on phone-class viewports)
  puts `@container` on the fixed scrim, `@max-md:*` on the padded centering row
  plus panel, and the scrim padding (`px-3 py-4`) on the centering row because
  a container cannot query itself.
- The Speed tab shows the default speed as a NumberInput (`0.25–3`, step `0.25`,
  default `1`); the Synthesis tab shows the Synthesis concurrency NumberInput
  (`1–8`, step `1`) and a Cache summary (`segments · bytes`) with `Clear all`
  and `View` (the `View` dialog is a second `BaseDialog` with a selectable
  `Lang`/`Voice`/`Text`/`Size`/`Saved` table, sticky header, `SearchInput`,
  `contain-layout`, and Play / Clear-selected / Clear-all controls; Play stops
  main playback first).
- Default speed options must match the speed list in `tts.mjs`.

- `/admin` hosts `Properties` and `Synthesis cache` tabs; bare `/admin` renders the Properties tab. `+layout.server.ts` redirects visitors without an admin session to `/login`; authenticated loads expose `adminAuthenticated` so first paint picks the right state. All admin data loads client-side through cookie-guarded APIs.
- Sign-in requires `ADMIN_PASSWORD_HASH` (or `ADMIN_PASSWORD`, hashed in
  memory) plus `SESSION_SECRET`; sessions are `httpOnly` `sameSite=strict`
  cookies (`tts-admin-session`) bound to a fingerprint of the credential
  material, so rotating credentials invalidates issued cookies. TTL is 24h
  (30d with remember-me); login attempts are rate-limited per IP (5 per
  15 min).
- Application properties persist in a file-backed JSON store
  (`TTS_PROPERTIES_FILE`, else `.data/admin-properties.json`; `/tmp` variant
  on Vercel). Precedence is file, then environment, then compiled default;
  out-of-range file/environment values fall back to defaults and updates
  apply atomically in one write. Server readers use a sync read with a
  short TTL cache.
- Managed properties (all numeric, `key` → env key → default):
  `tts_rate_limit_max` → `TTS_RATE_LIMIT_MAX` → `60`,
  `tts_max_text_length` → `TTS_MAX_TEXT_LENGTH` → `2000`,
  `tts_cache_ttl_ms` → `TTS_CACHE_TTL_MS` → `604800000`,
  `tts_cache_max_entries` → `TTS_CACHE_MAX_ENTRIES` → `500`,
  `tts_cache_max_bytes` → `TTS_CACHE_MAX_BYTES` → `209715200`,
  `edge_tts_timeout_ms` → `EDGE_TTS_TIMEOUT_MS` → `30000`,
  `auth_password_min_length` → `AUTH_PASSWORD_MIN_LENGTH` → `8`.
- Synthesis consumers read effective values: per-IP rate limit window,
  request text cap, cache TTL/caps, Edge WebSocket timeout. Cache hits and
  `304` responses stay exempt from the rate limit.
- Admin APIs (`snake_case` wire, `camelCase` at the boundary):
  `GET /api/admin/session`, `POST /api/admin/login`,
  `POST /api/admin/logout`, `GET`/`PUT /api/admin/properties`,
  `GET /api/admin/synthesis-cache`,
  `GET /api/admin/synthesis-cache/audio`,
  `DELETE /api/admin/synthesis-cache` (clear all or selected keys).
  Error bodies carry stable codes the client maps to localized `UI_TEXT`
  strings.
- The Synthesis cache tab lists unexpired server entries (`key`, `text`,
  `voice`, `saved_at`, `bytes`) with search/sort/pagination, selection-scoped
  Play, and selective or total clear; stats cover every cache file including
  expired ones.
- State-changing admin actions log `admin_*_start`/`admin_*_end` with
  `elapsed_ms` per `references/logging.md`; secrets and document contents
  are never logged.

## Auth model

- Public self-registration at `/login`. Users sign in with username-or-email
  + password; admins can also sign in through the same form (identifier
  matches `ADMIN_USERNAME`). Usernames and emails are normalized, the configured
  admin username is rejected case-insensitively by the user model, and passwords
  must meet the configured `auth_password_min_length` (default 8) up to 256
  characters. New users are created via `POST /api/auth/register`.
  Login and registration attempts share a database-backed per-IP bucket (5 per
  15 min; `rate_limited` at 429). Successful login does not clear the bucket.
  Registration failures use generic stable codes and never disclose whether a
  username or email is already registered; short passwords surface
  `password_too_short` with the configured `min_length` so the form can name it.
- Sessions are HMAC-signed `httpOnly` `sameSite=strict` cookies:
  `tts-user-session` for users, `tts-admin-session` for admins (24h TTL,
  30d with remember-me). The `hooks.server.ts` handle resolves
  `event.locals.user` on every request.
- Auth APIs (`snake_case` wire, `camelCase` at the boundary):
  `POST /api/auth/register`, `POST /api/auth/login`,
  `GET /api/auth/session`, `POST /api/auth/logout`. The login endpoint
  returns `{ user }` for user logins or `{ admin: true }` when the identifier
  matches the configured admin username.
- Signed-in users persist documents server-side via `GET`/`PUT`/`DELETE
  /api/documents` (per-user rows, `updated_at` in ms); every save/rename logs
  `user_document_save` and every delete logs `user_document_delete`
  (identifiers and sizes only, never contents).
- Already-authenticated visitors to `/login` never see the form: admins are
  redirected server-side to `/admin/properties`, while users are bounced
  client-side to the last-opened document (active slug persisted in
  `localStorage` by every editor navigation; `/` for a fresh buffer), so
  opening a doc, visiting login, and returning reopens the same doc instead
  of a fresh buffer. No `returnTo` query is threaded — the server cannot read
  `localStorage`.

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
  (radio variant with `Tooltip`). On phone-class viewports (the same
  `<28rem` threshold used for dialog sheet mode), those menus switch from an
  anchored popover to a backdrop bottom sheet while preserving the same
  checked state, roving keyboard navigation, Escape/backdrop/drag-down
  dismissal, and focus return to the trigger; they do not switch to native
  pickers. The sheet is pointer-modal via its backdrop but does not trap
  keyboard focus: tabbing out dismisses it through focus-out handling.
  The sheet chrome is a labelled dialog wrapping an inner radio menu so the
  title and close button are not menu children; entrance motion and the
  drag snap-back are disabled under `prefers-reduced-motion`. `Menu` owns
  the open state, portal placement for anchored popovers via
  `positionPanel`, dismissal via `useDropdown`, drag dismissal via
  `dragCloseDown`, and roving keyboard handling via `useListSelection`.
- In-dialog dropdowns (e.g. Settings Voices) keep the anchored popover on
  every viewport instead of a bottom sheet: a sheet stacked over the
  full-screen phone dialog would fight the dialog focus trap, since sheet
  focus moves outside the dialog DOM while popover focus stays on the
  in-dialog trigger. Phone tap targets there come from a CSS-only row
  minimum height.

## Constraints

- Ignore everything under `archive/` for implementation decisions.
- Do not consult any existing archived web implementation.
- Keep the app accessible and responsive as first-order requirements, not polish
  tasks.
