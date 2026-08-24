# TTS

Create a TTS webapp which is referenced from tts.mjs. The webapp supports both web and mobile modes. Resonsive design and accessibility are required. Reuse UI dsign and components from ../share-text project (e.g. dialogs, dropdowns, inputs). Do not read any existing web based implementation.

## Reference script
tts.mjs

## Main page
- Top row and main body positioned vertically, occupying the entire browser.

### Top row
- Showing the "TTS" title on the left, and a button toolbar on the right.
- The button toolbar consists of a Language icon and a Settings icon.
- When language icon is clicked, an option panel for available languages is displayed, which includes English, Traditional Chinese and Simplified Chinese displayed in respective language.
- When Settings icon is clicked, a Settings dialog (based on BaseDialog) is displayed.

### Main body
- Button panel and editor position vertically.
- Editor uses CodeEditor which shows the line number on the left.
- Button panel contains playback button, and playback speed button.
- The playback button is enabled when there is input text. When there is text selection, the input text is the selected text. Otherwise, the input text is all text in the editor. When clicked, the input text is divided into multiple segments and speech is delivered for each segment sequentially. 
- During playback, the text for the current segment is selected. The playback button turns into a Stop button. When the Stop button is clicked, the playback is stopped and the text selection stays for the current segment.
- When the playback for all segments are finished, clear the text selection if there is no text selection before playback.
- An Info button toggles a metadata panel that lists each spoken sentence boundary for the current segment during playback (time, offset, language, text); the sentence currently being spoken is highlighted, and the panel is empty before any playback.
- Upcoming segments are synthesized in parallel while the current segment is still playing, so playback proceeds without waiting for each segment's synthesis to finish. The number of concurrent synthesis requests is capped by the Synthesis concurrency setting.

## Settings dialog
- Contains 2 tabs: Voices, Speed
- Voice tab lists all supported languages. Refer to reference script.
- If the supported language has only one spoken language, there is a custom dropdown for the default voice model for the language.
- If the supported language has more than one spoken language (e.g. Chinese), there are 2 custom dropdowns, one for the spoken language, another for the default voice model for the spoken language.
- Speed tab shows a field for the default speed (1x) and a Synthesis concurrency field. Synthesis concurrency is the number of concurrent synthesis requests sent to the TTS service; once a segment is synthesized, the next remaining segment is synthesized without waiting for playback to finish. Refer to reference script for the supported speeds.

