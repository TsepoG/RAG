# Phase 7 — Conversations

## Goal

Turn the single-question page into a **chat**: the user asks a question, then
follow-ups ("what about QA?", "who owns that?", "show me the second rule")
that build on what was already said and fetched — without weakening any of
the grounding and honesty guarantees from Phases 3–4.

Each answer in the chat still has its banner, confidence, inline citation
chips and its own collapsible **Sources (n)** panel. Sources can be
**re-checked** manually, and are re-checked **automatically** when they are
old or reused, so a later answer never silently relies on a page or file that
has changed.

## Out of scope

Saving conversations across server restarts, more than one active
conversation at a time, a conversation sidebar/history, React or a chat
library (decided: build the chat shell in the existing plain HTML/CSS/JS UI —
see `docs/phase-7-conversation-decisions.md`), sign-in
and anything else from the production design.

## What Phases 1–6 left in place

- `askQuestion({ question, role, detailLevel, signal, onDelta, onActivity })`
  — one Copilot session per question; the full honesty pipeline: answer-meta
  parsing (lenient reason for non-answered statuses), citation validation
  (incl. `[G1*]`, combined brackets, short-paragraph rule), folder-only
  marking, nine confidence caps, style check with one tools-locked rewrite,
  meta repair as a safety net, who-to-ask, `renderFinalAnswer`.
- Citation Registry (per question), extractors, wrapping, space/repo scope
  enforcement in hooks, call budget, cloudId injection, page HTML → text with
  a cut-headings notice, `list_releases` citable.
- Web UI (Phase 5): Fastify server on 127.0.0.1, guards, CSP, server-side
  markdown sanitising with chips, SSE (`progress`, `token`, `done`, `error`),
  meta stream filter, draft-then-final rendering, Stop, feedback by
  `answerId`, role picker, "Show more detail".
- Eval (Phase 6): `eval/questions.yaml` (git-ignored), runner, scoring,
  review CSV, report with calibration, run metadata, `EVAL_LOG.md`.
- The SDK supports further `session.send` calls on the same session after
  `session.idle` (the style rewrite already uses this).

## Inputs to read first

- `CLAUDE.md`, `docs/CODING_PRINCIPLES.md`, this file.
- `docs/phase-7-conversation-decisions.md`: the reasoning behind this brief
  (why one Copilot session per conversation, the per-message Sources button,
  the re-check triggers, and why no chat library). It explains the decisions;
  this file specifies them. If the two disagree, this file wins — list any
  disagreement in the plan instead of resolving it silently.
- `docs/SYSTEM_DESIGN.md`: "Citations and source links", "Honesty and
  confidence", "End-to-end request flow".
- `docs/EVAL_LOG.md` (final Phase 6 numbers — the regression baseline).
- The installed `@github/copilot-sdk` types for multi-turn use: `send` after
  `idle`, `abort` mid-turn and whether the session stays usable afterwards,
  session lifetime and idle limits, and how history grows (infinite sessions
  stay disabled).

## Decisions already made

| Area | Decision |
| --- | --- |
| Conversation model | **One Copilot session per conversation** (Option B). A server-side `Conversation` holds: id (`crypto.randomUUID()`), role, the open session, a **conversation-wide Citation Registry**, per-source fetch metadata, turns (question, final result, rendered HTML), created/last-activity times. One active conversation per server (local PoC). Starting a new one disconnects the old session. |
| Single-question path stays | `askQuestion` and `/api/ask` stay for the CLI and the eval's single-turn cases. The new `askInConversation(conversation, { question, detailLevel, … })` reuses the same pipeline stages; shared logic is extracted, not duplicated. |
| Turn cap | `CONVERSATION_MAX_TURNS` (default 5, 1–10). At the cap the input is disabled with "This conversation is full — start a new one to keep going." Rewrite and meta-repair follow-ups don't count as turns. |
| Context budget | Track the characters of source content given to the model in this conversation; above `CONVERSATION_MAX_SOURCE_CHARS` (default 250,000) the next turn is refused with the same "start a new conversation" message. Infinite sessions / history compaction stay disabled, so cited source text is never summarised away. |
| Idle and lifetime | Close a conversation after `CONVERSATION_IDLE_MINUTES` (default 30) without activity: disconnect the session, drop state. A message to a closed or unknown conversation → 404 `{ code: "conversation_ended" }`; the UI offers a new conversation. |
| Citations across turns | Keys continue across turns (`C1…`, `G1…` never reset). Any key registered earlier in the conversation is citable in a later turn. Each source records `fetchedInTurn`, `fetchedAt`, and a change fingerprint (Confluence page version; GitHub blob SHA for files, tree SHA for directories, latest release tag for releases; commits are immutable). |
| Per-turn honesty | Every turn runs the full pipeline: answer-meta required, validation against the conversation registry, all nine caps, style check with one tools-locked rewrite, meta repair. The call budget (`MAX_TOOL_CALLS`) resets per turn. Each turn's `sources` are the keys cited **in that turn**. |
| New cap rule 10 | A cited source whose re-check shows it **changed since it was fetched** → that answer at most `medium`, reason "A source has changed since this answer was written." |
| Turn instructions | The system message (base + role block) is fixed for the session. Later turns send the user's question plus a short turn note: "Follow-up in the same conversation. You may cite sources already fetched by their keys; fetch again if you need content you haven't seen. End with the answer-meta block." Earlier turns' text is history, treated as data. |
| Show more detail | In a chat it becomes a **follow-up turn** ("Explain your previous answer in more technical detail.") with a per-turn depth note (role depth + 1, max 3) in the turn message and the style check using that depth. Counts as a turn. |
| Role change | Locks while a conversation is active; changing it asks "Start a new conversation as <role>?" and, if yes, starts one. |
| Stop | Aborts the current turn only (`session.abort`); the turn is recorded as cancelled and the conversation continues. If the session is not usable after abort, end the conversation with a clear message. |
| Errors and timeouts | A turn timeout or tool error ends that turn with an `error` event; the conversation continues. A session-level error ends the conversation. |
| Re-check (app-side, no Copilot requests) | `recheckSources(sources)` compares each source's fingerprint with the live one through read-only calls the app makes directly: GitHub REST (contents API blob/tree SHA on the default branch; latest release) for allowed repos only; Confluence page version via the cheapest read-only route available with the current token and scopes (prefer the Confluence REST v2 page endpoint through `api.atlassian.com` with the cloudId; fall back to an MCP `getConfluenceContent` call through the MCP client, which then moves from dev to runtime dependency). Claude Code confirms which route works before building it. Outcomes per source: `unchanged`, `changed`, `unavailable` (no cap; shown as "couldn't check"). |
| Auto re-check triggers | After each turn, re-check the turn's cited sources that were **fetched in an earlier turn** or are **older than `RECHECK_AFTER_MINUTES`** (default 15) and not checked within that window. When the conversation reaches its last allowed turn, re-check every source cited anywhere in it. |
| Manual re-check | `POST /api/conversations/:id/recheck { answerId }` re-checks that answer's cited sources now. Results update that answer's stored result (badges, rule 10 cap, banner) and are returned so the UI updates in place. |
| Changed sources | Badge "changed since this answer" on the source; the answer's banner and confidence update (rule 10); a **"Re-ask with the latest version"** button sends a follow-up turn: "Fetch the current version of [C3] and answer again: <original question>". Never rewrite an answer silently. |
| API | `POST /api/conversations { role }` → `{ conversationId, maxTurns }`. `POST /api/conversations/:id/messages { question, detailLevel }` → SSE: `progress`, `token`, `done { answerId, turn, result, rendered, html, recheck }`, `error`; one turn at a time (429 if busy). `GET /api/conversations/:id` → transcript of rendered turns for reload. `DELETE /api/conversations/:id`. `POST /api/conversations/:id/recheck`. Existing guards, CSP, body limit and schemas apply; ids validated as UUIDs. |
| Reload | The page keeps the `conversationId` in `sessionStorage` (try/catch) and restores the transcript with `GET`; if it returns 404 the page starts fresh with a notice. |
| UI | Scrolling message list: user bubble, then an answer card (banner, server-rendered answer with chips, conflicts, gaps, "Sources (n) ▾" collapsed by default, Re-check button, Show more detail, feedback). Input pinned at the bottom (Enter sends, Shift+Enter new line, Esc stops). Header: role (locked during a conversation), "Turn 2 of 5", New conversation. Chips scroll to and open that answer's Sources panel. Each source shows its key, title/label, link, version/commit, "fetched in turn N", and check status ("✓ checked 2 min ago", "changed since this answer", "couldn't check"). Progress line under the newest message. `aria-live` announces each new answer; focus returns to the input after an answer. |
| Feedback | Unchanged, per answer (`answerId`); records also store `turn` and `conversationTurns`. |
| Eval | Case schema gains optional `turns: [{ question, expect }]` for multi-turn cases (single-turn cases unchanged). The runner plays each multi-turn case as one conversation and scores each turn. Add 4–5 multi-turn cases (follow-ups that only make sense after the first answer, one that should reuse an earlier source by key, one that should trigger "not found" mid-conversation). Regression: run the full existing set through the **conversation path** as one-turn conversations and compare with the Phase 6 final run in `EVAL_LOG.md`. |

## Modules to create or change

```
src/
├── conversation/
│   ├── index.js
│   ├── store.js            # createConversationStore({ clock, idleMinutes, maxTurns, maxSourceChars, … }) — one active, idle sweep
│   ├── conversation.js     # Conversation state, turn bookkeeping, budget counters (pure where possible)
│   ├── turn.js             # askInConversation(...) — runs one turn through the shared pipeline
│   └── turnNote.js         # buildTurnNote({ turn, detailDepth }) (pure)
├── answer/                 # extract shared stages from askQuestion so both paths use them
├── citations/registry.js   # conversation-wide mode: fetchedInTurn, fetchedAt, fingerprint
├── citations/extractors/   # record fingerprints (page version, blob/tree SHA, release tag)
├── recheck/
│   ├── index.js
│   ├── recheck.js          # recheckSources(sources, { github, confluence, clock })
│   ├── github.js           # read-only fingerprint lookups (allowed repos only)
│   ├── confluence.js       # page version lookup (route confirmed in planning)
│   └── triggers.js         # selectForAutoRecheck(turnSources, { now, afterMinutes, isLastTurn }) (pure)
├── honesty/caps.js         # rule 10
├── server/routes/conversations.js
└── eval/                   # multi-turn case schema, conversation runner, per-turn scoring
public/js/                  # chat list, answer card, sources panel, re-check, turn counter, reload restore
```

## Tests required

- `store` / `conversation`: create, one active (new one disconnects old),
  idle expiry with an injected clock, turn cap, source-chars budget, unknown
  id → `conversation_ended`.
- `turn`: keys continue across turns; an earlier key is citable later;
  per-turn sources contain only that turn's cited keys; call budget resets;
  rewrite and meta repair don't count as turns; abort keeps the conversation
  usable; session error ends it.
- `turnNote`: follow-up wording; depth note for "more detail".
- `registry`: conversation mode numbering, `fetchedInTurn`, fingerprints,
  dedupe across turns (same page/version or same repo/path/blob → same key).
- `extractors`: fingerprints from fixtures.
- `recheck`: unchanged / changed / unavailable for each source kind; only
  allowed repos and spaces; no secrets in logs; commits skipped.
- `triggers`: reused-from-earlier-turn, older-than-threshold, recently
  checked skipped, last-turn sweep.
- `caps`: rule 10 caps at `medium` with its reason and never raises.
- `routes`: create, message SSE order, 429 when busy, 404 after expiry,
  GET transcript, DELETE, recheck updates the stored result, guards and
  schemas, UUID validation.
- `public/js`: message list rendering, Sources panel per answer, chip →
  panel, check badges, "Re-ask with the latest version" sends the right
  follow-up, role lock prompt, reload restore and fresh-start on 404, turn
  counter and full-conversation state.
- `eval`: multi-turn schema; runner plays turns in one conversation;
  per-turn scoring; one-turn conversation path matches single-question
  scoring on a fixed fake result.

## Acceptance criteria

- [ ] `npm run verify` passes; coverage ≥ 90% on all four measures.
- [ ] A real follow-up conversation of 3+ turns works in the browser; a
      follow-up cites a source fetched in an earlier turn by its key.
- [ ] Each answer has its own collapsible Sources (n) with "fetched in turn N".
- [ ] Manual re-check shows "✓ checked"; editing a cited Confluence page or
      pushing a change to a cited file, then re-checking, shows "changed
      since this answer", caps that answer at `medium`, and offers "Re-ask
      with the latest version" (owner does the edit; paste screenshots).
- [ ] Auto re-check runs for a reused source and for one older than the
      threshold (unit tests; live where practical).
- [ ] Turn cap and source budget end the conversation gracefully.
- [ ] Stop cancels a turn and the conversation continues.
- [ ] Reload restores the conversation; after a server restart the page starts
      fresh with a notice.
- [ ] Multi-turn eval cases added and verified by the owner; the full existing
      set run through the conversation path shows no regression beyond the
      Phase 6 noise level against the Phase 6 final run (logged in `EVAL_LOG.md`).
- [ ] CI green; SonarQube quality gate passes with zero new issues.
- [ ] README and `docs/DEMO.md` updated for conversations, re-checks and the
      new settings; `CHANGELOG.md` entry; `docs/ROADMAP.md` gains Phase 7.
- [ ] Phase 6 acceptance criteria ticked in `docs/phases/phase-6.md`, and
      this file plus `docs/phase-7-conversation-decisions.md` committed, in the
      first commit of the branch.

## Git rules for this phase

Claude Code never commits or pushes and never adds `Co-Authored-By:` or
"Generated with Claude Code" lines (CODING_PRINCIPLES §8). After each step it
runs `npm run verify`, stops, summarises and suggests a Conventional Commit
message. The owner tags the release (`v0.2.0`).

## Manual steps for the repo owner

1. Pull `main`; save this file as `docs/phases/phase-7.md` and the decisions
   note as `docs/phase-7-conversation-decisions.md` (both uncommitted); let
   Claude Code create `phase-7-conversations`.
2. Approve the Confluence re-check route Claude Code confirms in planning.
3. Try conversations in the browser at the steps Claude Code asks; send
   screenshots or notes.
4. For the re-check criterion: edit a cited Confluence page (or push a small
   change to a cited file) during a conversation, then re-check.
5. Verify the multi-turn eval cases; run the evals; fill in verdicts.
6. After merging: `git tag v0.2.0 && git push origin v0.2.0`.
