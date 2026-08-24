# TTS

A responsive text-to-speech web app with `tts.mjs` kept as the reference script
for voice data, segmentation behavior, and playback flow.

## Implementation direction

- Build the browser app at the project root.
- Reuse the web UI stack and component patterns from `../share-text`.
- Keep `tts.mjs` as the reference for supported voices, speeds, and segment
  playback behavior.

## Requirements

- Responsive desktop and mobile layouts.
- Accessible keyboard and screen-reader behavior.
- A top toolbar with language and settings controls.
- A line-numbered editor.
- Sequential playback of segmented text with active-segment selection.
- Settings for language voices and default speed.

## Reference files

- `requirement.md` — approved product requirements.
- `tts.mjs` — reference behavior and data for voices, speeds, and text
  segmentation.
