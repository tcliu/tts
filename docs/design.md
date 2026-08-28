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
- Playback always speaks the full editor content; when the editor has a text
  selection, playback starts from the selected text instead of the beginning.
- Playback splits the input into segments and speaks them sequentially.
- During playback, the current spoken word is selected in the editor.
- During playback, the playback button becomes a Stop button.
- Activating Stop ends playback and leaves the current segment selected.
- When playback completes, clear the selection only when playback started
  without a pre-existing selection.
- Playback controls appear above the editor once synthesis has produced a
  result or cached synthesis is available: chips showing the current language,
  voice, and segment counter, plus a seek slider with elapsed and total time.
  Opening or switching to a document with cached audio shows them immediately;
  editing the content hides them until the cache refreshes after a short pause.
- Dragging the seek slider previews the position; releasing starts or resumes
  playback there.

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
- The panel lists each spoken sentence boundary for the current segment during
  playback as a table of columns.
- Columns are segment, time, offset, language, and text; the spoken row is
  highlighted while playing.
- The panel is empty before any playback.
- The panel's column headers are localized with the rest of the interface.
- Activating a row (pointer or keyboard) replays the session starting from that
  sentence.
- A search field filters rows by text, offset, or language.
- A follow toggle scrolls the panel to keep the spoken row visible; scrolling
  respects reduced-motion preferences.
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
  with `0.5–2` range and `0.25` step).
- The Synthesis tab contains a Synthesis concurrency field that caps how many
  segments synthesize in parallel and a Cache entry showing how many segments
  have stored synthesis and the total size on disk, with a button to clear
  every cached audio file.
- The dialog keeps the same outer size across all tabs, anchored to the Voices
  tab (largest content); switching to Speed or Synthesis does not shrink the
  dialog.
- The Voices tab has a search box filtering languages and voices by language
  name or voice name.

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
