# Design — User-facing behavior

## Main page

- The page fills the browser viewport.
- The layout stacks a top row above the main body.

## Top row

- The left side shows the `TTS` title.
- The right side shows a toolbar with a language button and a settings button.
- Activating the language button opens a language panel.
- The language panel lists English, Traditional Chinese, and Simplified Chinese
  in their respective languages.
- Activating the settings button opens the settings dialog.

## Main body

- The main body stacks playback controls above the editor.
- The editor shows line numbers.
- The playback controls include a playback button. Playback speed is configured
  in the settings dialog's Speed tab and applies live during playback.

## Playback

- The playback button is enabled only when there is input text.
- If the editor has a text selection, playback uses that selection.
- Otherwise playback uses the full editor content.
- Playback splits the input into segments and speaks them sequentially.
- During playback, the current segment is selected in the editor.
- During playback, the playback button becomes a Stop button.
- Activating Stop ends playback and leaves the current segment selected.
- When playback completes, clear the selection only when playback started
  without a pre-existing selection.

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
- Editing the editor content clears the rows and refreshes them in the
  background after a short pause; a status hint reflects refreshing and cleared
  states.

## Settings dialog

- The dialog has `Voices` and `Speed` tabs.
- The Voices tab lists all supported languages from the reference script.
- Languages with one spoken-language group show one voice-model dropdown.
- Languages with multiple spoken-language groups show a spoken-language
  dropdown and a voice-model dropdown.
- The Speed tab shows the default speed field with `1x` as the default and a
  Synthesis concurrency field that caps how many segments synthesize in
  parallel.

## Responsive behavior

- The page works on both desktop and mobile layouts.
- Toolbar actions remain reachable and comfortably tappable on mobile.
- Dialogs and option panels remain usable without hover.

## Accessibility

- All controls are keyboard operable.
- Icon-only buttons expose accessible names.
- Focus states are clearly visible.
- The language menu supports full arrow-key navigation and returns focus to its
  trigger on close.
- Live announcements cover playback state changes only; per-second progress
  details are hidden from assistive technology.
- Motion during panel and playback-state transitions respects reduced-motion
  preferences.
