# Changelog

One entry per phase. Dates are those of the merge or, for Phase 6, of the last change on its
branch. The MVP is `0.1.0` (Phases 1 to 6); Phase 7 is `0.2.0`; Phase 8 is `0.3.0`, to be tagged
after it is merged.

## Phase 8: A redesigned page, "Clarity" (2026-10-16)

- The page is rebuilt to the approved design: a sidebar with the role list, a lock after the first
  question, the turn counter and **New conversation**; a centred chat column; and a question box
  pinned to the bottom. At 720 pixels and below the sidebar becomes a top bar with a menu button
  and a drawer that traps focus, closes with Esc and returns focus to the button.
- Every honesty feature is kept and easier to see: a confidence pill with an icon and words, the
  reason it was lowered, "What I'm not sure about", "Where sources disagree", a Sources list per
  answer, source badges (checked, changed, couldn't check), **Re-check sources**, **Re-ask with the
  latest version**, **Show more detail**, Stop, feedback, and a not-found card with "Where I
  looked" and "Who might know". An error is a card with **Try again**.
- A list of steps replaces the single progress line while an answer is made: ticks for finished
  steps, a spinner for the current one, and "Writing and checking the answer" last. It uses the
  events the server already sends; nothing was added to them.
- Three features: **Try asking** (up to four suggested questions per role, `suggestedQuestions` in
  `roles/*.yaml`, sent by `GET /api/roles` when a role has some; clicking one fills the box and
  does not send), **Copy this conversation** (the conversation as Markdown, a message on screen
  when it is copied, and a box to copy by hand when the browser refuses), and a typical time next to
  Stop ("Most answers take 1–3 minutes", the 25th to 75th percentile of run `20261014-190623`).
- Each end reason has its own end card (turn limit, source budget, memory dropped, lost session,
  an unconfirmed stop, expired) with the result of the final source check.
- Fonts: Geist and Geist Mono, served by the app from `public/fonts/` with the licence. The
  Content-Security-Policy is unchanged; the server now serves `.woff2`.
- The page has one light theme; the earlier dark mode was dropped. The stylesheet is split into
  `tokens.css`, `base.css`, `layout.css` and `components.css`, and the script into render
  modules in `public/js/ui/`. The old `app.css`, answer card and sources panel are gone.
- Accessibility: landmarks, one heading outline, `aria-pressed`, `aria-expanded`, `aria-busy`,
  a polite live region, `prefers-reduced-motion`, and axe-core checks in tests on the welcome,
  conversation, in-progress, not-found and ended states (zero violations). Lighthouse accessibility
  is 96 on desktop and on a phone; it lists one best practice, touch target size, which is left for
  now. The skip link was removed on request.
- New dev dependencies: `axe-core` and `jsdom` (for the accessibility tests only).
- Not changed: the answer pipeline, prompts, caps, re-check logic, SSE events, the conversation API
  and the command line.

## Phase 7: Conversations (2026-10-15)

- The page is now a chat. Follow-up questions go to one Copilot session per conversation, citation
  keys last the whole conversation, and every turn goes through the full honesty checks on its own.
  Each answer has its own Sources list with "fetched in turn N". One conversation is active at a
  time, for one role; a turn counter, a stop that keeps the conversation going, a full state, and a
  restore after a reload or a fresh start with a notice after a restart.
- Re-checks: a cited Confluence page (by version), GitHub file (by blob SHA at the commit that was
  read), folder and release list can be compared with the live source without the model, by hand
  (**Re-check sources**) or automatically (a reused source, an old source, every source after the
  last allowed turn). A changed source is shown on the source and the answer, caps that answer at
  `medium` (rule `source-changed`) and offers **Re-ask with the latest version**, which fetches it
  again under a new key.
- If the model's history is cut during a turn, that answer is capped at `medium` and the
  conversation ends (rule `memory-dropped`).
- New settings: `CONVERSATION_MAX_TURNS`, `CONVERSATION_MAX_SOURCE_CHARS`,
  `CONVERSATION_IDLE_MINUTES`, `RECHECK_AFTER_MINUTES`. New routes under `/api/conversations`
  (create, messages, transcript, recheck, delete); `POST /api/ask` is unchanged. Feedback lines
  record the turn.
- Evaluation: multi-turn cases (`turns`, `reusesEarlier`), `--path conversation`, per-turn scoring.
  Results are in [docs/EVAL_LOG.md](docs/EVAL_LOG.md): no regression beyond the noise when the 38
  cases are asked as conversations, and five multi-turn cases.
- Deviations from the brief, both agreed: the GitHub check compares the stored fingerprint at the
  ref the model read (two requests, or "couldn't check", when none was stored; never "changed"
  without a baseline), and the sweep after the last turn skips only sources checked in the last 2
  minutes, with badges that say when each was checked.
- Not changed: the single-question command line (`npm run ask`) and the eval default path.

## Phase 6: Evaluation and polish (2026-10-12)

- An evaluation: a case format (`eval/questions.yaml`, git-ignored; an example is committed),
  automatic scoring, a request budget, a runner, a review sheet for manual verdicts, a report with
  correctness, calibration and the MVP targets, and cases drafted from thumbs-down feedback
  (`npm run eval`, `eval:review`, `eval:report`, `eval:from-feedback`). `--ids` runs chosen cases.
- Every run records the commit, the model asked for, the models that answered, each model call,
  each role's version and a hash of the shared prompt. The results are in
  [docs/EVAL_LOG.md](docs/EVAL_LOG.md).
- Two tuning rounds, each measured before and after:
  - Confluence pages reach the model as plain text with their headings, the cap on one source is
    60,000 characters (was 24,000), and a cut page names the sections that were cut.
  - The base prompt asks for the answer-meta block on every reply and separates out of scope from
    not found.
  - A paragraph of up to three sentences that ends with a citation counts as cited.
  - The list of releases is a citable source.
  - A missing or unusable answer-meta block is asked for once more, with tools locked; a reply that
    is not an answer may leave the reason out and gets a fixed sentence.
- The skip link on the web page is always visible and stays first in the tab order.
- Final README, [docs/DEMO.md](docs/DEMO.md) and this changelog.
- Not done: the final full run against the MVP targets (it would have used up the Copilot
  allowance). See the log for what was measured instead.

## Phase 5: Local web UI (2026-10-11)

- A local web page served by Fastify: pick a role, ask, watch progress and the draft answer
  stream in, then get the checked answer with a confidence banner, a sources panel with citation
  chips, gaps and conflicts, "who might know", and a "show more detail" re-ask.
- Local-only by design: loopback host unless `ALLOW_REMOTE=true`, Host, Origin and
  Content-Type guards, a strict content security policy, answers rendered and sanitised on the
  server, and feedback stored without the answer text.
- Questions can be stopped; the answer-meta block never reaches the page.

## Phase 4: Honesty and answer quality (2026-10-11)

- Statuses `answered`, `not_found`, `clarify` and `out_of_scope`, and the answer-meta block the
  model ends its reply with.
- Confidence the model can propose but the application can only lower: caps for invented keys,
  uncited sentences, stale pages, interpretations, folder listings, gaps and conflicts.
- Stated and inferred citations (the asterisk), conflicts between documentation and code written
  by the application, and CODEOWNERS-based "who might know".
- A style check for each role, with one rewrite that may not change the facts or the citations.
- `--json` output and confidence shown by the command line.

## Phase 3: Citations and roles (2026-10-10)

- A citation registry: keys `C1`, `G1` for what the model actually read, tool results wrapped as
  sources, invented keys removed, and GitHub links pinned to a commit.
- Five role profiles in YAML (developer, business analyst, QA, product owner, project manager) and
  a system message with a part shared by every role and a part for the role.
- Sanitised fixtures built from real tool results, and a command to capture them.
- Limits on code search and a configured cloudId to save tool calls; folder listings as sources.

## Phase 2: Copilot and MCP connection (2026-10-10)

- A GitHub Copilot SDK session wired to the Atlassian Rovo and GitHub MCP servers, read-only by
  an allow-list, scope hooks, a deny-by-default permission handler and an empty sandbox directory.
- `npm run ask`, `npm run models`, and `npm run mcp:tools`, which writes `docs/mcp-tools.md`.
- Bearer and basic authentication for Atlassian; live integration tests.

## Phase 1: Foundation and quality gates (2026-10-10)

- Project skeleton in JavaScript with JSDoc type checking, ESLint with the SonarJS rules, Prettier
  and Husky hooks.
- Vitest with a 90% coverage gate, SonarQube Cloud, GitHub Actions on pull requests and
  Dependabot.
- A validated config loader, error classes and a logger that redacts secrets.
