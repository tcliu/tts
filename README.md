# TTS

A responsive text-to-speech web app.

## Setup

- Build the browser app at the project root; the web UI stack and component patterns stay in this repo.

## Environment variables

`.env.example` is the single example file documenting all knobs; it is never
loaded. Copy it to `.env` (git-ignored) to override locally — Vite loads
`.env` automatically during `npm run dev` — and create `.env.vercel`
(git-ignored) for the values to push to Vercel. Every setting is optional:
the app ships sensible defaults in code (the synthesis cache, for example,
uses `.tts` locally and `/tmp/.tts` on Vercel).

## Deployment (Vercel)

The app ships with `@sveltejs/adapter-vercel` (Node.js runtime) and is ready to
deploy to Vercel.

1. Install the Vercel CLI and log in:

   ```bash
   npx vercel login
   ```

2. Link the repo to your Vercel project once:

   ```bash
   npx vercel link
   ```

   Or skip the manual step: set `VERCEL_PROJECT=<slug>` in `.env.vercel`
   (or pass `npm run deploy -- --project <slug>`). The deploy auto-links an
   unlinked checkout — prompting when the name is unknown and saving the
   answer to `.env.vercel` before syncing env — creating the remote project
   when it does not exist yet. Updating the slug and redeploying switches
   the link interactively after confirmation; a non-interactive run requires
   an explicit `--project <name>` to opt in.

3. Push environment variables (optional; the cache works without them):

   Create `.env.vercel` (git-ignored; see `.env.example` for the documented
   knobs) with at least:

   ```bash
   APP_BASE_URL=https://<your-alias>.vercel.app
   ```

   then sync it to Vercel:

   ```bash
   npm run env:sync:vercel
   ```

   By default this only upserts the vars from `.env.vercel` and leaves any
   other project env vars untouched. Pass `--prune` to also remove vars that
   are no longer present in that file.

4. Deploy:

   ```bash
   npm run deploy -- --profile prod --target vercel
   ```

    This starts a production deploy, streams the Vercel upload/build logs,
    waits for the deployment to reach `READY`, and points the project's
    production domain at `APP_BASE_URL` (resolved from the shell env, then
    `.env.vercel`, then `.env`). Stale `<project>.vercel.app` aliases are
    removed so only the configured domain remains.

    The repo's `.vercelignore` also excludes large local-only directories such
    as `archive/`, `.worktrees/`, `node_modules/`, and `.vercel/` so they do
    not inflate upload time.

`vercel.json` sets the SvelteKit framework with `npm run build`. The synthesis
endpoint runs on the Node.js runtime with a 60s `maxDuration` to cover Edge TTS
latency, and the cache falls back to `/tmp/.tts` on Vercel's read-only
filesystem.
