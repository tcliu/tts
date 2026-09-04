# Design — User-facing behavior

## Main page

- The page fills the browser viewport.
- The layout stacks a top row above the main body.

## Top row

- The left side shows a Documents button and the `TTS` title.
- The right side shows a toolbar with a language button, a theme button, and a
  settings button.
- Activating the Documents button toggles the documents drawer.
- Activating the language button opens a language panel.
- The language panel lists English, Traditional Chinese, and Simplified Chinese
  in their respective languages.
- Activating the theme button opens a color-theme panel.
- The theme panel lists Dark, Ember, Forest, Midnight, Nebula, Light, Mint,
  Sepia, Lavender, and Sky; the active theme shows a selected marker and each
  option carries its own icon, while the trigger uses a static palette icon.
- Dark is the default theme, and the choice persists across reloads.
- Activating the settings button opens the settings dialog.

## Main body

- The main body stacks playback controls above the editor.
- The editor shows line numbers.
- The playback controls include Play/Stop, Reset, Save, Copy, Delete (when a
  document is open), Info, Clone (when a document is open), and Upload.
- On narrow layouts the actions collapse into a `More actions` overflow menu;
  Upload and Info stay reachable at every width, and the inline set grows as the
  container widens.
- Playback speed is configured in the settings dialog's Speed tab and applies
  live during playback.

## Playback

- The playback button is enabled only when there is input text.
- Playback speaks the full editor content when no text is selected. When the
  editor has a non-empty text selection before Play, playback is scoped to that
  selected text only.
- Playback splits the input into segments and speaks them sequentially.
- During playback, the current spoken word is shown with a separate playback
  highlight in the editor: light-blue for full-document playback and emerald green when the word lies inside a manual text selection so the highlight remains visible above the blue selection background. The Info panel's active sentence/word row stays light-blue (cyan) in both modes.
- During playback, the playback button becomes a Stop button.
- Activating Stop ends playback and clears the playback highlight.
- The editor's native text selection remains the user's selection; when
  playback starts from a selection, that native selection stays visible under
  the playback highlight.
- While playback is active, pointer range selection is disabled (drag/shift-select collapses to caret) while caret movement remains enabled to seek playback.
- Playback controls appear above the editor once synthesis has produced a
  result or cached synthesis is available: chips showing the current language,
  voice, and segment counter, plus a seek slider with elapsed and total time.
  Opening or switching to a document with cached audio shows them immediately;
  editing the content hides them until the cache refreshes after a short pause.
- Clearing all client-side synthesis cache while the editor is open hides the
  playback controls and clears the Info panel rows for the current document;
  clearing selected cached entries does so only when the current playback/caret
  position belongs to one of the cleared segments.
- When a manual selection exists before Play and matching cached audio is
  available, the controls and Info panel scope to only the selected text even
  before playback starts, but no playback word highlight is shown until Play is
  clicked.
- Dragging the seek slider previews the position; releasing starts or resumes
  playback there.
- The language, locale, gender, and voice chips are dropdowns forming a
  cascade: language → locale → gender → voice. Picking a value overrides the
  position segment's language, respectively the voice for its language (locale
  and gender picks resolve to the first matching voice), for the active
  session only; the persisted default voice settings stay untouched. The
  locale chip lists the locales available for the current language and the
  gender chip lists the genders for the current language and locale; each is
  hidden when only one option exists. The voice chip lists only voices in the
  current locale. The language, locale, and gender chips require paused
  playback; the voice chip also works during playback.
- Changing the voice model during playback stops at the current word,
  resynthesizes the current segment with the new voice, and resumes from the
  same word once synthesis is ready; the status line reports the switch while
  synthesizing and Play is inert until the resume starts. A Stop during the
  switch leaves playback stopped instead of resuming. When the stop lands at
  the spoken end of the segment, playback finishes instead of resuming.

## Upload

- An Upload action loads a local text file into the editor.
- When the button panel has room, Upload appears as a button at the end of the
  panel; on narrower layouts it moves into the overflow menu.
- Uploading replaces the entire editor content.
- When the editor has unsaved changes, a discard confirmation is shown before
  the file picker opens; cancelling keeps the current content.
- Dropping a text file onto the Upload button imports it through the same flow
  as picking: discard confirmation first when the editor has unsaved changes,
  then validation and replacement. The button highlights while a file is
  dragged over it.
- Files are read as UTF-8 text. A file larger than 1 MiB of encoded text, one
  that fails to read, or one that is not entirely readable text — binary
  content such as control characters or invalid UTF-8 — is rejected with a
  transient status message above the editor; a successful load confirms there
  as well.

## Documents

- A Documents button toggles a side drawer that lists saved documents.
- The drawer has a `New document` button and a search field filtering rows by
  name; the list is empty before any document is saved.
- On large screens the drawer is docked inline and starts expanded; the
  Documents button can collapse it to free editor space and re-open it.
- On mobile the drawer overlays the content and also closes by dragging/swiping
  it left.
- Activating a row opens that document.
- Documents persist in the browser's `localStorage`; they are not sent to a
  server.
- Opening a different document, starting a new document, cloning, uploading, or
  resetting with unsaved edits shows a discard confirmation first; cancelling
  keeps the current content.
- The open document's name shows as an inline editable title above the editor;
  editing and committing it renames the document.
- Save (the Save button or `Ctrl`/`Cmd`+`S`) opens a name dialog; saving under a
  name owned by a different document asks for confirmation before replacing it.
- Clone detaches the current content into a new, unsaved document carrying the
  same text; nothing is persisted until it is saved under a name.
- Copy copies the editor text to the clipboard and confirms success or failure
  via the action icon.
- Reset reverts to the saved document (or empties the editor when none is open).
- Deleting a document (via the toolbar Delete action when a document is open)
  asks for confirmation; deleting the open document clears it from the editor.

## Metadata panel

- An Info button toggles a metadata panel.
- The panel lists each spoken sentence for the current document during playback;
  the row count equals the number of sentences, not segments.
- The sentence table shows expand, play, number, offset, language, and text; the
  spoken row is highlighted while playing. The expand control reveals a word
  sub-table (play, word number, offset, text) for sentences with word timing.
  When Edge under-splits a segment (e.g. CJK text separated by spaces or commas),
  the panel synthesizes one row per highlight range with interpolated timing so
  each sentence still appears on its own row.
- The panel is empty before any playback.
- The panel's column headers are localized with the rest of the interface.
- Activating a sentence or word row (pointer or keyboard) replays from that
  position; per-row speaker buttons first try already-cached segment audio
  (derived from sentence/word boundaries and segment range offsets) and fall
  back to isolated fragment synthesis only when the segment is absent, is not
  cached, or no reliable time window can be derived.
 - A search field filters rows by text, offset, language, or word text.
 - A follow toggle scrolls the panel to keep the spoken row visible; scrolling
    respects reduced-motion preferences.
 - Each sentence with word timing has a per-row expand control; a bulk control
    above the table expands or collapses all currently visible word tables at
    once (filtered rows only, keyboard reachable, `Expand all` / `Collapse all`
    labels, offset-stable keys so filtering does not reopen the wrong rows).
 - Editing the editor content clears the rows and marks them stale; a status hint
    shows the rows were cleared, and the panel shows the cached segment rows again
    after a short pause once playback re-reads the synthesis cache.

## Settings dialog

- The dialog has `Voices`, `Speed`, and `Synthesis` tabs.
- The Voices tab lists all supported languages from the reference script.
  Chinese includes the spoken-language groups `Mandarin`, `Cantonese`,
  `Taiwanese`, and `Northeastern Mandarin` (Cantonese voices are merged into
  Chinese; group labels omit `Traditional`/`Simplified`).
- Languages with one spoken-language group show one voice-model dropdown.
- Languages with multiple spoken-language groups show a spoken-language
  dropdown and a voice-model dropdown.
- The Speed tab shows the default speed field (`1` as the default, NumberInput
  with `0.25–3` range and `0.25` step).
- The Synthesis tab contains a Synthesis concurrency field that caps how many
  segments synthesize in parallel and a Cache entry showing how many segments
  have stored synthesis and the total size on disk, with buttons to clear
  every cached audio file and to view cached segments in a dialog.
- The Synthesis cache dialog shows a full-width table (`Lang`, `Voice`, `Text`,
  `Size`, `Saved`) that is sortable by header, paginated, and searchable;
  the table fills the remaining vertical space of a fixed tall dialog shell
  with pagination pinned at the bottom, so the dialog itself never vertically
  scrolls. Each cached segment is keyed by `text + voice` and may be shared
  across documents, so no `Document` column is shown. Playback at any speed
  reuses the same `1×` cached audio via `playbackRate`.
- The dialog keeps the same outer size across all tabs, anchored to the Voices
  tab (largest content); switching to Speed or Synthesis does not shrink the
  dialog.
- The Voices tab has a search box filtering languages and voices by language
  name or voice name.

## Admin page

- `/admin` shows a sign-in card (username, password with show/hide,
  remember-me) when unauthenticated and `Properties` / `Synthesis cache`
  tabs when authenticated; the header carries language/theme menus plus
  back-to-editor and sign-out actions.
- The Properties tab edits rate limit, text length, cache TTL/count/size,
  and Edge timeout with per-row source badges (`File`/`Environment`/`Default`)
  and revert-to-default for file-sourced values.
- The Synthesis cache tab shows a searchable, sortable, paginated table of
  server cache entries with selective and clear-all actions.

## Responsive behavior

- The page works on both desktop and mobile layouts.
- Toolbar actions remain reachable and comfortably tappable on mobile.
- Dialogs and option panels remain usable without hover.

## Accessibility

- All controls are keyboard operable.
- Icon-only buttons expose accessible names.
- Focus states are clearly visible.
- The language and theme menus support full arrow-key navigation and return
  focus to their trigger on close.
- Live announcements cover playback state changes only; per-second progress
  details are hidden from assistive technology.
- Motion during panel and playback-state transitions respects reduced-motion
  preferences.
