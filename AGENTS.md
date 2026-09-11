# AGENTS — tts
Project-specific development conventions for the TTS web app.

## Agent progress

- For non-trivial tasks, follow `~/.agents/references/agent-progress.md` alongside the primary skill; trivial single-step edits skip it.

## Skill routing

- Trivial single-skill requests invoke the matching skill directly, without routing; route non-trivial, composite, or ambiguous requests through the `skill-routing` skill.
- Honor the selected skills' approval, verification, and scope constraints.

## File editing

- Edit with the smallest possible range: select only the lines that change and put their complete final content in the edit body; if an edit is rejected or the file changed since the last read, re-read the section and issue a new minimal edit rather than retrying.
- An `edit` rejection saying the body "restates" adjacent lines means unchanged
  context lines leaked into the body: shrink the range to exactly the lines
  that change and resend; do not retry the same payload.

## Read first
- Read the shared references applicable to the files being edited before
  editing, keeping pre-edit investigation within the read cap in `~/.agents/references/agent-progress.md`.
- Before `read` on a path not seen in prior tool output or a directory
  listing, run `glob` to confirm the path instead of guessing file names or
  worktree paths.
- If a `~/.agents/references/...` path does not exist, the config root is
  unconfigured on this machine (fresh clone): ask the user for the config-root
  path once and use it for the session instead of guessing.
- When reviewing completed work, follow the `review` skill and report
  findings with severity, location, rule, and fix.
- When a task is ambiguous about what to change or how to approach it, ask the
  user to clarify or present up to three concrete options before editing, to
  avoid unwanted changes.

## Architecture

- The project root hosts the browser app; `tts.mjs` stays in the repo as the
  behavioral reference for supported voices, speeds, segmentation, and playback
  flow.
- Component attributes stay camelCase.
- Reuse this project's existing UI primitives and patterns when they fit,
  especially dialog, form, dropdown, editor, and icon components; do not build a
  parallel design system for equivalent controls.
- Do not read or reuse any archived web implementation under `archive/`; it is
  out of scope for this project.
- Apply code changes in a separate git branch and worktree under `.worktrees/`
  per the shared `git.md` worktree practice (branch `<type>/<change-name>`,
  path mirrors branch); create worktrees with
  `node scripts/create-worktree.mjs <branch>`, unless the user opts for the
  current worktree.
- Dev-server probe scripts matching by `GET /api/catalog` must require a string app identity; the catalog service itself answers 200 with an identity-less envelope and otherwise surfaces as null-identity noise.
- Z ladder: sticky content `z-10`, drawer `z-20`, overlays `z-40`, dev tag
  `z-50` — keep overlays at or below `z-40` so the tag is never covered.
- Log server-side state-changing actions through `src/lib/server/logging` per
  `logging.md` (structured `ip=<ip> action=<action> ...`, `_start`/`_end` with
  `elapsed_ms` for async ops); never log secrets, tokens, or document contents.
- Validate required prod env at startup and fail fast on missing credentials.
- Authenticate via self-registration at `/login` with HMAC-signed `httpOnly`
  `sameSite=strict` sessions; normalize usernames/emails, hash with scrypt,
  and reject the admin username.
- Write Postgres-first schema in `sql/schema.sql`, applied to prod via
  `npm run schema:apply`.
- Persist shared authentication throttles in the configured database, not
  process-local memory, so limits hold across serverless instances. Do not
  clear a shared IP failure bucket after an unrelated successful login.
- Enforce authentication invariants in the domain model as well as HTTP routes:
  reject reserved identities and short passwords at `createUser`, and expose
  stable generic registration error codes so account existence cannot be
  enumerated.
- Enforce per-user document quotas on writes inside a transaction; enable
  SQLite foreign keys so development matches production ownership and cascade
  behavior.
- Expose tunable policy thresholds as managed admin properties (file →
  environment → compiled default) instead of hardcoded constants, per `js-ts.md`.
- Throwaway e2e accounts use `e2e_<purpose>_<timestamp>` usernames
  (`load_<purpose>_<timestamp>` for stress runs, which never target prod);
  machine rows are identifiable via `LIKE 'e2e\_%'` and must be deleted after
  the run.
- Treat the top-level language `code` as the written language; spoken variants
  are `aliases`, voice variants are the per-voice `group`.
- Temporary scratch files (plans, proposals, notes) go in `.tmp/` (plans in
  `.tmp/plans/`), never in source directories. In-progress feature requirements
  go in `.tmp/features/{feature-name}.md` as supplementary context only.

## UI behavior

- Keep responsive layout decisions in CSS (no JS `matchMedia` for initial
  layout) so the first paint is correct on mobile and desktop.
- Keep all focusable controls keyboard reachable, with explicit focus styles and
  accessible names for icon-only buttons. Keep non-interactive scroll wrappers
  out of the tab order (`tabindex="-1"` on overflow containers) so Tab lands
  only on interactive controls.
- Playback visibly highlights the current spoken word in the editor while
  keeping the native text selection intact; pointer range selection collapses
  to caret during playback but caret movement still seeks. A cached manual
  selection may scope the controls and Info panel before playback but must not
  pre-highlight until Play is clicked.
- Document navigation is reflected in the URL as `{base}/{docId}` and
  history-backed so Back/Forward moves between documents.
- All user-facing strings go through the context i18n store (`src/lib/i18n.svelte.ts`):
  components call `getI18nContext()` once and render `i18n.t('dotted.key')`;
  plain `.ts` helpers receive the store explicitly instead of calling
  `getContext`. Add each new string to every locale (`en`, `zh-TW`, `zh-CN`).
  Keys are namespaced by area (`auth.signIn.failed`, `cache.clearAll`,
  `table.text`); `admin.*` stays flat because the server resolves those keys
  dynamically. Surface server failures as stable wire codes mapped to
  localized strings; never surface raw English literals or technical detail
  as user-facing errors. Locale persistence stays in the `tts:web-settings`
  blob owned by `use-settings` (`settings.locale` delegates to the store).
- The app shell fills the dynamic viewport with `h-dvh` (non-shrinking chrome,
  one flexible editor region); do not add `min-h-screen`, clip the shell with
  `overflow-hidden`, or chase mobile keyboard gaps — those differences are
  owned by the browser (see `cross-browser.md`).
- Defer editor focus with `tick()` whenever creating a new document changes
  drawer or dialog visibility; opening an existing document keeps
  drawer-owned focus.
- Never move focus away from the editor via preview toggles, drawer buttons,
  or list-collapse buttons.
- Settings dialog keeps a fixed outer size anchored to the Voices tab via the
  `BaseDialog` `height="fixed"` preset with the Voices list scrolling
  internally.
- Text/number inputs use a single custom `focus-visible` treatment; Tab into a
  number input places the caret at the end instead of selecting the value.
- `BaseDialog` sheet mode and header menu bottom sheets share the phone-class
  threshold (container token `md`, 28rem, not the viewport breakpoint); dialog
  sizing is preset via `maxWidth`/`height`, never hardcoded `w-`/`h-`.
- Settings Voices tab uses aligned label + control-group rows, stacking below
  `sm`. Documents drawer docks at `lg` with overlay-only dismissals gated on
  docked state. Playback toolbar is a container-query ladder; recalibrate
  paired band tables together when thresholds change.
- `/login` carries no form: unauthenticated visits redirect to the editor with
  `?login=1`, which auto-opens the sign-in dialog once (param stripped via
  `replaceState`, no navigation). Explicit sign-out lands on `/`; only expired
  sessions redirect to `/login`.
- Icon-only `Button` uses uniform padding (`p-1.5` for `sm`, `p-2.5` for `md`);
  text buttons keep `px`/`py` distinction. Every size carries a `before:`
  hit-area expansion so the target reaches 44px (`-inset-2` on `sm`, `-inset-0.5` on `md`).
- Dropdown/menu option panels show one shared hover/keyboard highlight; the
  committed value is `aria-selected`/`aria-checked` only. Panels hide only when
  their trigger is clipped or out of viewport after scroll, never on own-list
  scroll.
- Header language/theme menus keep the shared `Menu` component on all devices
  (bottom sheets on phone, never stacked inside a dialog: in-dialog dropdowns
  keep their anchored popover on all viewports).
- Dialogs containing `DataTable` keep a fixed outer height via the `BaseDialog`
  `height` preset with the table `fillHeight` filling the remaining space and
  pagination pinned; the dialog itself never scrolls.

## Theming

- Theme palettes live only in `src/styles.css` as `[data-theme]` overrides of
  the Tailwind palette variables; do not add per-component theme conditionals
  or duplicate palette values.
- Ink on vivid accent fills uses the fixed `text-onaccent` token, never a
  remapped slate grade.
- Adding or renaming a theme means updating every sync point in one change;
  missed sync points silently fall back to the default palette.

## References

- Follow `~/.agents/references/svelte.md` for Svelte 5 runes and effect rules.
- Follow `~/.agents/references/svelte-i18n.md` for multilingual UI text via the context store (`getI18nContext`/`i18n.t`).
- Follow `~/.agents/references/js-ts.md` for module design with one-way dependency flow.
- Follow `~/.agents/references/tailwind.md` for literal utility classes and attribute-driven palette remapping.
- Follow `~/.agents/references/accessibility.md` for focus management, keyboard access, labels, and reduced motion.
- Follow `~/.agents/references/responsive-design.md` for breakpoints, touch targets, and overlay drawers.
- Follow `~/.agents/references/portals.md` for portal and overlay positioning, viewport clamping, and flip-when-crowded placement.
- Follow `~/.agents/references/ui-patterns.md` for dialogs, form dialogs, icons, comboboxes, and the two-arrow table sort pattern.
- Follow `~/.agents/references/api-client.md` for `snake_case` wire payloads and `camelCase`-at-the-boundary mapping.
- Follow `~/.agents/references/cross-browser.md` for browser-owned viewport and keyboard differences.
- Follow `~/.agents/references/logging.md` for server-side structured event logging.
- Follow `~/.agents/references/reliability.md` for state safety, async flows, and concurrency guards.
- Follow `~/.agents/references/verification.md` for lint, typecheck, and test validation tiering.
- Follow `~/.agents/references/sql.md` for SQL schema and query conventions.
- Follow `~/.agents/references/git.md` for commit message conventions and worktree isolation.

## Keeping references in sync

- When a code change establishes or revises a project-specific convention, update
  this `AGENTS.md` in the same change.
- When a code change establishes or revises a generic reusable convention, update
  the appropriate file under `$AI_CONFIG_DIR/references/` in the same change rather
  than duplicating it here.
- Shared reference files under `$AI_CONFIG_DIR/references/` must stay generic and
  implementation-agnostic: no project-specific paths, component names, routes, or
  internal identifiers. Put project-level details in this `AGENTS.md` instead.
- When recording a convention borrowed from a sibling project, describe only the rule and its content; never name the source project.
- This `AGENTS.md` holds project-specific *development conventions* — rules to
  follow when writing code — not feature descriptions or implementation
  narratives. Keep each bullet to the rule plus the briefest rationale;
  architecture detail belongs in `ARCHITECTURE.md` and user-facing behavior in
  `docs/design.md`.
- When the user corrects a mistake, approves a fix, or states a new convention, invoke the `learn` skill so the lesson is not repeated.

## Quality checks

- Trivial non-behavioral edits (docs, comments, strings) need only a targeted
  check (e.g. `npm run check` or the single affected test).
- Run the full suite before finishing behavior-affecting changes or handing
  off a worktree:

```bash
npm run check
npm run build
npm test
```
- Run browser e2e with `npm run e2e` (Playwright smoke over the resolved dev port; reports land in `.tmp/e2e/`).
