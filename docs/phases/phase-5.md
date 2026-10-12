# Phase 5 — Local Web UI

## Goal

A browser UI on the developer's machine for everything the CLI does today:

```
npm start   →   http://127.0.0.1:3000
```

The user picks a role (remembered), types a question, watches progress and the
answer stream in, then sees the final answer with its confidence banner,
clickable citation chips, a Sources panel, gaps and conflicts, "Who might
know", a "Show more detail" button and thumbs up/down feedback.

## Out of scope

Conversation memory (each question is answered on its own; the UI says so),
login/SSO, multi-user access, deployment, a frontend framework or build step,
the eval set (Phase 6). The CLI stays as it is.

## What Phases 1–4 left in place

- `askQuestion({ question, role, onDelta })` returns the full result object:
  `status`, `confidence`, `confidenceReason`, `capsApplied`, `answer`,
  `sources` (with `inferred`, `stale`, `friendlyLabel`, pinned URLs),
  `alsoConsulted`, `gaps`, `conflicts`, `clarifyingQuestion`, `whoToAsk`,
  `styleViolations`, `rewritten`, `rewriteRejected`, `toolCalls`, `model`,
  `durationMs`, etc.
- `renderFinalAnswer(result, role)` builds the banner, conflicts, gaps,
  not-found and out-of-scope text — designed to be shared by CLI and server.
- The model's answer ends with an `answer-meta` fenced block that must never
  be shown; streamed deltas include it.
- Roles in `roles/*.yaml` with `displayName`, `description`, `depth`.
- One Copilot client per process; one session per question; tools locked
  during the style rewrite.

## Inputs to read first

- `CLAUDE.md`, `docs/CODING_PRINCIPLES.md`, this file.
- `docs/SYSTEM_DESIGN.md`: "API contract and data model" (endpoints and the
  `done` event), "Citations and source links" (chips, Sources panel,
  role-specific display), "Honesty and confidence" (banners).
- The Phase 4 PR's hand-off note.

## Decisions already made

| Area | Decision |
| --- | --- |
| Server | Fastify, started by `npm start` (`src/server/index.js`). `npm run dev` runs it with `node --watch`. Prints the URL on start. One Copilot client created at start and stopped on `SIGINT`/`SIGTERM` (temp dirs cleaned as today). |
| Binding and access | Listen on `127.0.0.1` only (configurable `HOST`, default `127.0.0.1`; refuse to start on `0.0.0.0` unless `ALLOW_REMOTE=true`, which the README warns against). No CORS headers. |
| Local-only protections | Every `/api/*` request must have a `Host` of `127.0.0.1:<port>` or `localhost:<port>` (blocks DNS-rebinding); state-changing requests must send `Content-Type: application/json` and, when an `Origin` header is present, it must equal the server's own origin (blocks cross-site requests from other tabs). Rejections → 403 with a short JSON error, logged at `warn`. |
| Security headers | `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. No inline scripts or styles. |
| Frontend | Plain HTML, CSS and vanilla JavaScript ES modules in `public/`, served statically. No framework, no bundler. JSDoc and `// @ts-check` apply; ESLint with browser globals for `public/`. Logic lives in small pure modules (`public/js/*.js`) that are unit-tested with Vitest + `happy-dom` and count toward the 90% coverage gate. |
| Markdown and XSS | The **server** renders the final answer markdown to HTML with `marked`, then sanitises it with `sanitize-html` (allow-list: paragraphs, headings h3–h5, lists, emphasis, inline code, code blocks, blockquotes, tables, links). Links get `target="_blank" rel="noopener noreferrer"`; only `https:` links survive. Citation keys (`[C1]`, `[G2*]`) are turned into `<button class="cite" data-key="C1" data-inferred="true">` chips during rendering. The browser inserts only this server-sanitised HTML; streamed text is always inserted with `textContent`. |
| API | `GET /api/roles` → `[{ id, displayName, description, depth }]`. `POST /api/ask` `{ question, role, detailLevel }` → `text/event-stream` (SSE format over a `fetch` response stream, since `EventSource` cannot POST). `POST /api/feedback`. `GET /api/health`. Request bodies validated with Fastify JSON schemas (question 1–2000 chars, role must exist, detailLevel `default` \| `more`). |
| SSE events | `progress` `{ message }` — friendly tool progress ("Searching Confluence…", "Reading README.md", "Checking the code…"), built from tool events with no arguments or secrets; `token` `{ text }` — answer deltas with the `answer-meta` block filtered out; `done` `{ result, html }` — the final result object (as returned by `askQuestion`, minus internal fields like `toolCalls[].args`) plus the sanitised HTML of the rendered answer; `error` `{ message, kind }` — user-safe message (no stack traces, no tokens). The stream always ends with exactly one `done` or `error`. |
| Meta filtering while streaming | `createMetaStreamFilter()` (pure): buffers from any line that starts with a code fence until it can tell whether the fence is `answer-meta`; drops the meta block, releases anything else. Handles a fence split across deltas. |
| Draft then final | While streaming, the answer shows as plain draft text (muted) with a "Checking sources…" note. On `done`, the draft is replaced by the final server-rendered HTML — which can differ from the stream (invalid keys stripped, `*` added, not-found replacement, rewrite). Citation chips appear only in the final answer. |
| One question at a time | The server handles one `ask` at a time; a second concurrent request gets 429 `{ message: "Already answering a question" }`. |
| Cancel | A "Stop" button aborts the fetch; the server detects the closed request, aborts the Copilot session and disconnects it. `askQuestion` gains an optional `signal` (AbortSignal) for this; tested. |
| Show more detail | Re-asks the same question with `detailLevel: 'more'`: the role block is built as if `depth` were one higher (max 3) and banned terms are relaxed for depth ≥ 2. The shared base stays identical (existing test). Shown only when depth < 3 and status is `answered`. |
| Role picker | Populated from `/api/roles`; choice saved in `localStorage` (wrapped in try/catch; works without it). Default `developer` on first visit. Description shown under the picker. |
| Sources panel | Numbered list in key order: key chip, title (Developers) or `friendlyLabel` (depth 1), link, version or short commit, "may be out of date" badge when `stale`, "my reading" badge when `inferred`. "Also consulted" collapsed below. Clicking a chip in the answer scrolls to and highlights its source; chips have `aria-describedby` with the source title. |
| Status rendering | Banner at the top with the level (colour plus text, never colour alone). `clarify` → only the question, styled as a question, with the input focused for the reply. `not_found` / `out_of_scope` → role text and closest pages. Gaps ("What I couldn't confirm"), conflicts and "Who might know" rendered from the result fields. |
| Feedback | Thumbs up/down plus optional comment and optional "wrong source" key. `POST /api/feedback` appends one JSON line to `data/feedback.jsonl` (git-ignored, created on demand): timestamp, question, role, detailLevel, status, confidence, cited keys, rating, comment, wrongSourceKey, model. No answer text, no tokens. Phase 6 reads this. |
| Accessibility | Labelled controls, keyboard-only use works (Enter submits, Esc stops), visible focus, the answer region is `aria-live="polite"` during streaming, colour contrast AA, no information conveyed by colour alone. |
| Look and feel | Clean, readable, neutral: one centred column (max ~760px), system font stack, generous line height, light and dark via `prefers-color-scheme`. The answer is the hero; controls are quiet. No external fonts or CDNs (CSP is `'self'`). |
| Errors | Network or server errors show a short message with a Retry button. Config/auth problems at startup fail fast in the terminal, as the CLI does. |

## Modules to create or change

```
src/
├── server/
│   ├── index.js           # wiring only: config, client, app, listen, shutdown (coverage-excluded)
│   ├── app.js             # buildApp(deps) → Fastify instance (testable with app.inject)
│   ├── guards.js          # host / origin / content-type checks
│   ├── headers.js         # security headers hook
│   ├── sse.js             # writeEvent(reply, type, data), stream lifecycle
│   ├── progress.js        # toolEventToProgress(event) → friendly message or null
│   ├── routes/            # roles.js, ask.js, feedback.js, health.js
│   └── feedbackStore.js   # appendFeedback(record, { dir, appendFile, mkdir })
├── render/
│   ├── markdown.js        # renderAnswerHtml(markdown) → sanitised HTML with citation chips
│   └── metaFilter.js      # createMetaStreamFilter()
├── copilot/systemMessage.js   # detailLevel support (depth + 1)
└── answer/askQuestion.js      # optional signal; detailLevel passthrough
public/
├── index.html
├── css/app.css
└── js/
    ├── main.js            # wiring only (coverage-excluded, tiny)
    ├── api.js             # fetchRoles, ask (SSE parser over fetch), sendFeedback
    ├── sseParser.js       # parse SSE text chunks into events (pure)
    ├── state.js           # UI state transitions (pure)
    ├── render.js          # DOM updates for banner, answer, sources, gaps, conflicts
    └── storage.js         # safe localStorage wrapper
```

## Tests required

- `guards`: allowed hosts; rebinding host rejected; cross-origin `Origin`
  rejected; missing `Origin` allowed; non-JSON content type rejected on POST.
- `headers`: every response carries the security headers.
- `routes` (with `app.inject` and a fake `askQuestion`): roles list; ask
  streams `progress`, `token`, then exactly one `done`; validation errors →
  400; unknown role → 400; concurrent ask → 429; thrown error → one `error`
  event with no stack or token; client disconnect aborts the session;
  feedback appends a line without answer text.
- `sse` / `sseParser`: framing, multi-line data, events split across chunks.
- `metaFilter`: meta dropped; other code fences kept; fence split across
  deltas; text after the meta block kept; no meta at all.
- `markdown`: `<script>`, `onerror=`, `javascript:` and `data:` links removed;
  `http:` links removed, `https:` kept with `rel`/`target`; citation chips
  (including `*` and combined keys) produced; code blocks escaped.
- `progress`: each allow-listed tool maps to a message; no arguments leak.
- `systemMessage`: `detailLevel: 'more'` raises depth by one (capped at 3);
  base unchanged.
- `askQuestion`: abort via `signal` aborts and disconnects the session.
- `public/js`: SSE parsing, state transitions (idle → asking → streaming →
  done/error/stopped), rendering of each status, chip → source highlight,
  storage fallback when `localStorage` throws.

## Acceptance criteria

- [x] `npm run verify` passes; coverage ≥ 90% on all four measures, including `public/js`.
- [x] `npm start` serves the UI on `127.0.0.1`; refuses `0.0.0.0` without `ALLOW_REMOTE=true`.
- [x] A real question streams progress and draft text, then shows the final
      answer with banner, chips and Sources; links open the right pages.
- [x] The `answer-meta` block never appears in the UI (unit test + live).
- [x] Role choice survives a page reload.
- [x] "Show more detail" on a Product Owner answer returns a more technical
      answer for the same question.
- [x] Stop cancels a running question; the server log shows the session aborted.
- [ ] Not-found, clarify and out-of-scope results render correctly (live where
      possible, otherwise via a fake backend in tests).
      _Not met: not-found was seen live, and the evaluation produced `out_of_scope` live for general-knowledge and other-company questions (rounds 1 and 2). A clarifying question was never produced live in four runs: both clarify cases were answered with one reading. Clarify is covered by unit tests with a fake backend only (see `docs/EVAL_LOG.md`)._
- [x] Feedback writes to `data/feedback.jsonl` with no answer text or tokens.
- [x] `curl -X POST http://127.0.0.1:3000/api/ask -H "Origin: https://evil.example" -H "Content-Type: application/json" -d '{}'` → 403.
- [x] Keyboard-only walkthrough works (pick role, ask, stop, open a source).
      _The skip link did not show on the first Tab; fixed in Phase 6 and confirmed by the owner._
- [x] CI green; SonarQube quality gate passes with zero new issues (watch
      for security hotspots on the server and HTML rendering).
- [x] README: `npm start`, `npm run dev`, the local-only security model,
      `HOST`/`ALLOW_REMOTE`, feedback file, screenshots of the UI.

## Git rules for this phase

Claude Code never commits or pushes and never adds `Co-Authored-By:` or
"Generated with Claude Code" lines (CODING_PRINCIPLES §8). After each step it
runs `npm run verify`, stops, summarises and suggests a Conventional Commit
message.

## Manual steps for the repo owner

1. Pull `main`; let Claude Code create `phase-5-web-ui`.
2. Run `npm start` at the steps Claude Code asks, try each role, and send
   screenshots or notes on anything that looks or reads wrong.
3. Run the `curl` check and the keyboard walkthrough for the PR.

## Hand-off to Phase 6

Phase 6 builds the eval set and runner, reads `data/feedback.jsonl`, measures
answer quality, citation precision, confidence calibration, not-found and
out-of-scope behaviour (the Phase 4 release-date miss), and tunes prompts.
