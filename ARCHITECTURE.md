# Architecture — TTS web app

This document describes how the code is organized so you can navigate and
trace behavior quickly. For what the system does and the contracts it obeys,
see `docs/spec.md`; for what the user sees and does, see `docs/design.md`;
for how to write code in this project, see `AGENTS.md`.

## Stack

- **Svelte 5** (runes) + **SvelteKit** (routing, server endpoints)
- **Tailwind CSS v4** (utility-first styling, theme via CSS variable overrides)
- **CodeMirror 6** (editor)
- **Vercel** deployment (`@sveltejs/adapter-vercel`, Node.js runtime)

## Project structure

```
tts/
├── src/
│   ├── app.html                  # HTML shell, pre-paint theme script
│   ├── styles.css                # Tailwind entry, theme palette overrides
│   ├── routes/
│   │   ├── +layout.svelte        # Root layout (renders children + dev tag)
│   │   ├── +layout.server.ts     # Passes DEV_TAG env to layout
│   │   ├── [[docId]]/
│   │   │   └── +page.svelte      # Single page — thin orchestration layer
│   │   └── api/tts/synthesize/
│   │       └── +server.ts        # POST endpoint — validation, caching, TTS
│   └── lib/
│       ├── use-*.svelte.ts       # Composable factories (domain state)
│       ├── components/           # Presentational UI components
│       ├── playback/             # Playback engine internals
│       ├── server/               # Server-only modules (edge-tts, cache)
│       ├── metadata/             # Info panel row builders
│       ├── document-editor/      # Editor helpers (draft names, navigation gating)
│       ├── tts/                  # Language detection, segmentation
│       ├── synthesis-cache/      # Voice helpers
│       ├── data-table/           # Column resize helpers
│       ├── actions/              # Reusable DOM actions (dropdown, drag-close, list selection)
│       ├── locales/              # Per-locale UI strings (en, zh-TW, zh-CN)
│       └── page/                 # Page-level helpers (chips, toolbar, theme menu, page composables)
├── tts.mjs                       # Reference script (voices, speeds, segmentation)
├── reference-languages.json      # Written/spoken language + voice data
└── docs/
    ├── design.md                 # User-facing behavior
    └── spec.md                   # Behavioral contracts, API specs, constraints
```

## Entry points to trace

1. **`src/routes/[[docId]]/+page.svelte`** — the single page component. It
   instantiates all composables and wires them to view components. Read this
   first to see what state exists and how it connects.

2. **Composable factories** (`src/lib/use-*.svelte.ts`) — own all domain state:
   - `use-playback.svelte.ts` → playback engine
   - `use-metadata.svelte.ts` → Info panel rows
   - `use-settings.svelte.ts` → preferences, theme, voice resolution
   - `use-documents.svelte.ts` → localStorage document store
   - `use-document-editor.svelte.ts` → current doc, dirty state, dialog flows
   - `use-synthesis-cache.svelte.ts` → cache stats, clear flows

3. **`src/lib/playback/engine.ts`** — the core playback loop (segment
   sequencing, voice-switch remap, caching logic).

4. **`src/lib/tts-client.ts`** — synthesis API client with LRU cache.

5. **`src/lib/server/edge-tts.ts`** — server-side WebSocket TTS client.

6. **`src/lib/tts-reference.ts`** + `reference-languages.json` — voice and
   language data model.

## Layering

The app follows a strict dependency direction:

```
Route (+page.svelte)
  │  wires
  ▼
Composable factories (use-*.svelte.ts)
  │  own state, call
  ▼
Engines / clients (playback/engine.ts, tts-client.ts, metadata/rows.ts)
  │  call
  ▼
Server endpoints (+server.ts) ──► edge-tts.ts, server/tts-cache.ts
```

- **Routes** are thin orchestration — they instantiate composables and bind
  them to components. They contain no domain logic.
- **Composables** own reactive state and orchestrate engines. They are the
  only place where cross-domain coordination happens (e.g. playback notifying
  metadata).
- **Engines/clients** are non-reactive modules that perform work (playback
  timing, API calls, row building).
- **Server endpoints** handle HTTP concerns (validation, rate limiting,
  caching headers) and delegate to `edge-tts.ts` for synthesis.

## Key patterns

- **Composable factories** — `useXxx()` functions returning reactive state
  via Svelte 5 runes. Each owns one domain concern. They accept dependencies
  (settings, editor ref) as arguments to avoid circular imports.
- **Thin routes** — `+page.svelte` is mostly declarative markup; all logic
  lives in composables and `page/` helpers.
- **Server/client boundary** — the synthesis API is the only network
  boundary. The client (`tts-client.ts`) talks to `POST /api/tts/synthesize`;
  the server (`+server.ts`) validates and delegates to Edge TTS.
- **Theme system** — themes are CSS variable overrides in `src/styles.css`
  under `[data-theme='…']`. A pre-paint inline script in `app.html` applies
  the stored theme before first paint.
- **Reference data** — `tts.mjs` and `reference-languages.json` are the
  source of truth for voices, speeds, and segmentation rules. The app
  mirrors their behavior.
