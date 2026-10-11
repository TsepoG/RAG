# Phase 4 — Honesty and Answer Quality

## Goal

Every answer states **how sure it is and why**, separates what a source says
from what the assistant inferred, names what it could not find, and is checked
against the role's style before it is shown. The app — not the model — has the
final say on confidence, through hard caps the model cannot override.

```
npm run ask -- --role product_owner "Do we support multi-currency today?"
```

→ starts with a plain-language banner ("I'm not sure. Here's what I found and
what's missing."), marks inferred statements, ends with a "What I couldn't
confirm" list, and never claims more certainty than its sources support.

## Out of scope

The web UI and "show more detail" (Phase 5), the eval set and calibration
measurements (Phase 6), streaming the trailer-free answer to a UI (Phase 5 —
the CLI already prints the validated answer at the end).

## What Phases 1–3 left in place

Build on these; do not restructure them.

- `askQuestion({ question, role, onDelta })` returns `{ answer, role, sources,
  alsoConsulted, invalidKeys, uncitedSourceKeys, toolCalls, model, durationMs }`.
- Citation Registry with `C#`/`G#` keys; GitHub source kinds `file`,
  `directory`, `commit`, `release`; Confluence sources carry `lastUpdated` and
  `stale`; `validateCitations` strips invented keys and normalises `[C1, G2]`.
- Role profiles in `roles/*.yaml` (`depth` 1–3, `bannedTerms`, `answerShape`,
  `version`), shared base system message + role block (base identical across
  roles, tested).
- Hooks: fail-closed pre-hook (scope checks, call budget, `search_code` cap,
  `cloudId` injection via `modifiedArgs`); post-hook registers and wraps
  sources, adds `additionalContext` hints, fails closed for Confluence content;
  large results capped for the model.
- Known gap from the Phase 3 PR: a claim about a file's contents can be cited
  to a directory listing or a README that doesn't state it. This phase closes
  the part of that gap that can be checked mechanically.

## Inputs to read first

- `CLAUDE.md`, `docs/CODING_PRINCIPLES.md`, this file.
- `docs/SYSTEM_DESIGN.md`: "Honesty and confidence" (the source of the rules
  below), and the `done` event under "API contract and data model".
- The Phase 3 PR description (known gaps and live-run notes).

## Decisions already made

| Area | Decision |
| --- | --- |
| Statuses | Every result has `status`: `answered`, `not_found`, `clarify` or `out_of_scope`. |
| Confidence levels | `high`, `medium`, `low` for `answered`; `not_found` has none. |
| How the model reports | The base system message requires the answer to end with one fenced block tagged `answer-meta` containing JSON: `{ "status", "confidence", "confidenceReason", "gaps": [], "conflicts": [{ "topic", "docSays", "docKeys", "codeSays", "codeKeys" }], "clarifyingQuestion"? }`. `parseAnswerMeta(text)` (pure) extracts and Zod-validates it and returns the answer with the block removed. Missing or invalid block → `confidence: low`, reason "The assistant did not report its confidence", and the parse failure is logged. The block never appears in the displayed answer. |
| Inferred statements | The base prompt tells the model to mark interpretations (usually of code) with an asterisk inside the citation, `[G1*]`, and to phrase them as "Based on the code, it looks like…". `validateCitations` accepts `*`, keeps it in the displayed answer, and reports `inferredKeys`. A source cited only with `*` gets `inferred: true` in `sources`. |
| Hard caps | `applyConfidenceCaps({ meta, validation, sources, answer })` is a pure function returning `{ status, confidence, reasons[] }`. The model's level is the starting point; each rule can only lower it. Rules below. Every applied cap adds a human-readable reason; the final `confidenceReason` combines the model's reason with the cap reasons. |
| Cap rules | 1. Zero valid citations and status `answered` → `not_found`. 2. Any invented key stripped → at most `medium`. 3. Any substantive sentence without a citation → at most `medium` (see "Uncited sentences"). 4. Any cited Confluence source with `stale: true` → at most `medium`. 5. Any inferred citation (`*`) → at most `medium`. 6. Any sentence whose only citations are `directory` sources → treated as inferred (rule 5). 7. Non-empty `gaps` → at most `medium`. 8. Non-empty `conflicts` → at most `low`. 9. Meta block missing or invalid → at most `low`. |
| Uncited sentences | `findUncitedSentences(answer)` (pure): split into sentences, skipping headings, the gaps and conflicts sections, list lead-ins ending in `:`, and sentences under 6 words. A remaining sentence with no `[key]` counts as uncited. Heuristic by design; table-tested with real-looking answers. Returned in the result as `uncitedSentences` (max 5, truncated) for Phase 6 to measure. |
| Not found | When `status` is `not_found` (from the model or a cap), the displayed answer is replaced by the role's not-found text, followed by "Closest pages I checked" (up to 5 from `alsoConsulted`, title + link) and "Who might know" (below). The model's text is discarded, not shown. |
| Clarify | When the model returns `status: clarify` with a `clarifyingQuestion`, the result carries it and the CLI prints only the question (no sources). One question, never more. The base prompt allows clarify only when the question genuinely fits two or more different things in the sources (e.g. two services both called "refunds"). |
| Out of scope | `status: out_of_scope` (question not answerable from Confluence or code at all, e.g. future dates, opinions, other systems) → the role's out-of-scope text; no sources. |
| Gaps and conflicts display | Answers with `medium` or `low` confidence end with a "What I couldn't confirm" list (from `gaps`). Conflicts are shown as "The documentation says X [C1]; the code does Y [G2]. The code reflects current behaviour." — rendered by the app from the structured `conflicts`, not left to the model's prose. |
| Banners | Shared defaults in the base (from the design table), overridable per role in YAML under `phrases: { high, medium, low, notFound, outOfScope }`. PO and PM get plainer wording; developers may get more specific wording. Role schema gains optional `phrases`; bump each changed role's `version`. |
| Who to ask | Best-effort, no extra model calls: for Confluence sources, the page's last editor or owner when the extractor can read it from the result (display name only; never logged); for GitHub sources, matching entries from the repo's `CODEOWNERS` (`.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS`), fetched once per repo per question through the existing read-only REST helper, allowed repos only. Shown only for `not_found`, `low` and `medium`. Missing data → section omitted. |
| Style check | `checkStyle(answer, role)` (pure) returns violations: depth 1 → no fenced code blocks, no inline code, no file paths (`/` with a file extension or known source folder names), no banned terms; depth 2 → no fenced code blocks, no banned terms; depth 3 → banned terms only. Citations and the meta block are ignored by the check. |
| Rewrite once | If `checkStyle` finds violations, `askQuestion` sends **one** follow-up in the same session: "Rewrite your previous answer for a <role displayName>: <violations>. Keep every fact and every citation key exactly. Do not call any tools." Tools are denied during the rewrite (pre-hook flag), with a test. The rewrite goes through `parseAnswerMeta`, `validateCitations` and the caps again. If violations remain, keep the rewrite and record `styleViolations`. Never more than one rewrite. If the rewrite drops or invents citations, keep the original answer and record `rewriteRejected: true`. |
| Honesty in role voice | The base prompt states that uncertainty must be expressed in the role's language but never dropped; a PO answer can say "I'm not sure this is built yet" but cannot omit that it is unsure. |
| Result shape | Adds `status`, `confidence`, `confidenceReason`, `capsApplied[]`, `gaps[]`, `conflicts[]`, `clarifyingQuestion?`, `inferredKeys[]`, `uncitedSentences[]`, `styleViolations[]`, `rewritten`, `rewriteRejected`, `whoToAsk[]`; each source gains `inferred`. Aligned with the design's `done` event (Phase 5 streams it). |
| CLI | Prints the banner first (with the level in brackets, e.g. `[medium]`), then the answer, conflicts, "What I couldn't confirm", Sources, Also consulted, Who might know, Tools used. `--json` flag prints the full result object instead (for Phase 6 and debugging). Exit code 0 for every status (a "not found" is a correct outcome, not an error). |

## Modules to create or change

```
src/
├── honesty/
│   ├── index.js
│   ├── meta.js            # parseAnswerMeta(text) → { answer, meta, metaError? }
│   ├── caps.js            # applyConfidenceCaps(...) → { status, confidence, reasons }
│   ├── sentences.js       # findUncitedSentences(answer), sentencesCitingOnly(answer, kinds)
│   ├── render.js          # renderFinalAnswer(result, role) — banner, conflicts, gaps, not-found/out-of-scope text
│   └── whoToAsk.js        # buildWhoToAsk(sources, codeowners)
├── style/
│   ├── index.js
│   └── check.js           # checkStyle(answer, role)
├── github/codeowners.js   # parseCodeowners(text), matchOwners(path, rules); fetch via existing REST helper
├── citations/validate.js  # accepts [G1*], reports inferredKeys
├── citations/extractors/  # Confluence extractor also reads last editor/owner display name when present
├── roles/schema.js        # optional phrases
├── copilot/systemMessage.js # base gains answer-meta, inferred-marker, clarify, out-of-scope and honesty rules
├── mcp/hooks.js           # rewrite-phase flag denies all tools
└── answer/askQuestion.js  # meta → validate → caps → style → (rewrite once) → render; new result shape
```

## Tests required

- `meta`: valid block parsed and removed; block in the middle or missing →
  `metaError`; invalid JSON, unknown status, out-of-range confidence →
  `metaError`; only the last `answer-meta` block counts; answer text unchanged
  otherwise.
- `caps`: a table test with one row per rule plus combinations (e.g. stale +
  conflicts → `low`, zero citations overrides everything → `not_found`); caps
  never raise confidence; every applied cap adds its reason.
- `sentences`: headings, list lead-ins, short sentences and the gaps section
  skipped; abbreviations ("e.g.", "v1.2") don't split sentences; sentences
  citing only `directory` sources detected.
- `validate`: `[G1*]` kept and reported; `[G1*, C2]` normalised; invented
  `[G9*]` stripped.
- `style`: one test per depth and violation type; citations and meta ignored;
  banned terms matched case-insensitively on word boundaries.
- `askQuestion` (fake session): rewrite happens once on violations and tools
  are denied during it; rewrite that drops a citation is rejected; not-found
  replaces the text and lists closest pages; clarify returns only the
  question; out-of-scope returns the role text; missing meta → `low` with
  reason.
- `render`: banners per level and role override; conflicts rendered from
  structured data with both keys; gaps only for medium/low.
- `codeowners` / `whoToAsk`: pattern matching (last match wins, directory and
  glob patterns); allowed repos only; missing file → empty; Confluence editor
  name included when present; nothing logged.
- `roles`: optional `phrases` validated; existing files still load.
- `systemMessage`: base still identical across roles and contains the meta,
  inferred-marker, clarify, out-of-scope and "uncertainty never dropped" rules.

## Acceptance criteria

- [ ] `npm run verify` passes; coverage ≥ 90% on all four measures.
- [ ] Every live answer shows a banner and a confidence level; `--json` shows
      `confidenceReason` and `capsApplied`.
- [ ] An unanswerable question about the configured project (e.g. "What is the
      SLA for the payments API?" if no such page exists) returns `not_found`
      with closest pages, not a guess. Paste the output in the PR.
- [ ] An out-of-scope question ("What will the release date be next year?")
      returns the out-of-scope text.
- [ ] An ambiguous question (if the sources allow one) returns a single
      clarifying question; otherwise the unit tests cover it and the PR says so.
- [ ] A PO answer containing code or paths is rewritten once; the result has
      `rewritten: true` and no violations (live if it happens naturally,
      otherwise unit-tested).
- [ ] An answer citing a stale page is capped at `medium` with the reason shown.
- [ ] The Phase 3 gap is closed mechanically: a sentence supported only by a
      directory listing is treated as inferred and caps confidence (unit test).
- [ ] The same uncertain question asked as `developer` and `product_owner`
      gives the same confidence level, worded for each role. Paste both.
- [ ] CI green; SonarQube quality gate passes with zero new issues.
- [ ] README: statuses, confidence levels and caps, inferred markers, gaps,
      conflicts, the rewrite, `--json`, and how to edit role `phrases`.

## Git rules for this phase

Claude Code never commits or pushes and never adds `Co-Authored-By:` or
"Generated with Claude Code" lines (CODING_PRINCIPLES §8). After each step it
runs `npm run verify`, stops, summarises and suggests a Conventional Commit
message.

## Manual steps for the repo owner

1. Pull `main`; let Claude Code create `phase-4-honesty`.
2. Review the base-prompt wording and each role's `phrases` — they are what
   users read when the assistant is unsure.
3. Run the live questions in the acceptance criteria and paste the outputs.

## Hand-off to Phase 5

Phase 5 streams the answer to a web UI. The `answer-meta` block arrives at the
end of the stream, so the UI must hold back or filter it while streaming and
render the banner, conflicts and gaps from the final result object. Keep
`renderFinalAnswer` usable by both the CLI and the server.
