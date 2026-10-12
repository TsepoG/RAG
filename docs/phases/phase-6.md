# Phase 6 — Evaluation and Polish

## Goal

Measure how well the assistant actually answers, fix the biggest weaknesses,
and finish the MVP:

1. A small, deliberate **eval set** of real questions with expected outcomes.
2. An **eval runner** that asks every question through the real pipeline and
   scores what can be scored automatically.
3. A **manual correctness pass** by the owner, merged into a final report with
   confidence calibration.
4. One or two **tuning rounds** on prompts, role profiles or caps, each
   measured before and after.
5. **Polish**: skip-link fix, final README, demo script, changelog.

When this phase is done, the owner can say with numbers how often the
assistant is right, how often its confidence is justified, and how it behaves
on questions it can't or shouldn't answer.

## Out of scope

New features, conversation memory, production items from the system design
(SSO, gateway, database, deployment), running evals in CI (they need real
credentials and cost Copilot requests). Scoring logic is unit-tested in CI;
eval runs happen locally.

## What Phases 1–5 left in place

- `askQuestion({ question, role, detailLevel, signal, onDelta, onActivity })`
  returns the full result: `status`, `confidence`, `confidenceReason`,
  `capsApplied`, `answer`, `sources`, `alsoConsulted`, `invalidKeys`,
  `inferredKeys`, `uncitedSentences`, `gaps`, `conflicts`,
  `styleViolations`, `rewritten`, `rewriteRejected`, `toolCalls`, `model`,
  `durationMs`, …
- `renderFinalAnswer(result, role)`; roles in `roles/*.yaml`; the web UI;
  `data/feedback.jsonl` (git-ignored) with rated questions.
- Known open items: the live model answered an out-of-scope release-date
  question instead of returning `out_of_scope`; clarify and out-of-scope were
  never produced live; the skip link doesn't appear on keyboard focus.

## Inputs to read first

- `CLAUDE.md`, `docs/CODING_PRINCIPLES.md`, this file.
- `docs/SYSTEM_DESIGN.md`: "Quality, evaluation and operations" (metrics and
  targets) and "Honesty and confidence".
- The Phase 4 and Phase 5 PR descriptions (open items).

## Decisions already made

| Area | Decision |
| --- | --- |
| Eval set file | `eval/questions.yaml`, validated with Zod. One entry per case: `id`, `role`, `question`, `tags` (e.g. `smoke`, `not-found`, `out-of-scope`, `clarify`, `style-trap`, `stale`, `conflict`), and `expect`: `status`, optional `sources` (each `{ type: confluence\|github, match }` where `match` is a page id, title fragment or repo path that must be **cited**), optional `mustNotCite`, optional `maxConfidence`, and `reference` (a short expected answer for the human reviewer). |
| Committing the eval set | The questions describe the owner's real project. Default: `eval/questions.yaml` and `eval/results/` are **git-ignored**; a generic `eval/questions.example.yaml` (5 cases, invented project) is committed so the format and tests are documented. The owner may choose to commit the real set instead; ask before step 2. |
| Size and mix | 30–40 cases: 5–6 answerable per role (developer, business_analyst, qa, product_owner, project_manager); at least 4 `not_found` (plausible but undocumented); at least 4 `out_of_scope` (including the release-date question and one general-knowledge question); 2 `clarify` if the sources genuinely allow ambiguity, otherwise none and say so; at least 3 `style-trap` (PO/PM questions that tempt code or file paths). About 8 cases tagged `smoke`. |
| Who writes the cases | Claude Code **drafts** candidates by reading the local repo and a handful of Confluence pages through the existing read-only tooling (`mcp:sample`), and writes them with `reference` answers marked `draft: true`. The **owner** verifies every expected status, source and reference, edits or deletes, and removes `draft: true`. The runner refuses to run cases still marked draft. The owner is the source of truth. |
| Runner | `npm run eval -- [--subset smoke\|full] [--case <id>] [--role <id>] [--max-requests N] [--yes]`. Uses one Copilot client and the real `askQuestion`, sequentially. Before running it prints the case count and an estimated Copilot request count (one per case plus expected rewrites) and asks for confirmation unless `--yes`. `--max-requests` stops cleanly when reached. Writes `eval/results/<timestamp>/results.jsonl` (one line per case: inputs, the full result minus tool arguments, timings) and `summary.md`. Never writes tokens. |
| Automatic scoring | Pure `scoreCase(case, result)` and `summarise(scores)`: status match; citation recall (expected sources cited ÷ expected); `mustNotCite` violations; `maxConfidence` respected; depth-1 style violations after rewrite; meta-block errors; invalid keys; uncited sentences; inferred share; rewrite and rewrite-rejected rates; call-budget hits; latency p50/p95; confidence distribution; a status confusion matrix. |
| Manual correctness | `npm run eval:review -- <run>` writes `review.csv` (case id, role, question, reference, rendered answer text, sources, status, confidence, and empty `verdict` and `note` columns). The owner marks each answered case `correct`, `partial` or `wrong`. `npm run eval:report -- <run>` merges the CSV and writes `report.md` with correctness, calibration and everything automatic. No model-as-judge in the MVP (saves requests; more trustworthy). |
| Calibration | Report shows, per confidence level, the share of answers marked correct (partial = 0.5), with counts. Small samples are labelled as such; no conclusion from fewer than 5 answers at a level. |
| MVP targets | Status accuracy ≥ 85%; citation recall ≥ 70%; correctness ≥ 80% of answered cases; `high` answers ≥ 90% correct; `not_found` + `out_of_scope` cases handled honestly (no confident made-up answer) ≥ 80%; zero depth-1 style violations after rewrite; meta-block errors ≤ 10%. Targets are reported as met/not met; missing one is a finding, not a failed phase, as long as it is explained. |
| Feedback | `eval:report` also summarises `data/feedback.jsonl`: counts by rating, role and status, wrong-source keys. `npm run eval:from-feedback` turns thumbs-down records into new draft cases (`draft: true`) for the owner to verify. |
| Tuning | After the baseline run: list the top 3 failure categories with example case ids; propose one **general** change per category (base prompt, a role profile, a cap, a hook hint) — never a change written to make one specific question pass; implement, re-run `smoke`, then `full` at the end. The base prompt stays identical across roles (existing test). Every change and its before/after numbers go into `docs/EVAL_LOG.md`. At most 2 rounds in this phase. |
| Request budget | Expect roughly: baseline full run (≈40–50 requests) + 1–2 smoke reruns per change (≈10 each) + final full run. The owner checks Copilot usage before the first full run; if the allowance is tight, tune on `smoke` and run `full` only for baseline and final. |
| Skip link | Diagnose with a unit test of the DOM order and focus behaviour and the owner's DevTools `:focus-visible` check; fix so the first Tab shows it. |
| README and docs | Final README: what it is, a 5-step quickstart, the ASCII architecture, roles, how citations and confidence work, the security model, eval commands, limitations (single user, no memory, code search depends on GitHub indexing, Rovo search excluded, Copilot usage limits), troubleshooting (Atlassian 401/403 and scopes, bearer vs basic, Teamwork-Graph-only tools, empty code search, Copilot auth). `docs/DEMO.md`: a 10-minute demo script with 1–2 questions per role and what to point out. `CHANGELOG.md` with one entry per phase. |
| Release | The owner tags `v0.1.0` on `main` after merge (Claude Code only prints the command). |

## Modules to create or change

```
eval/
├── questions.example.yaml     # committed, invented project
├── questions.yaml             # owner's real set (git-ignored by default)
└── results/                   # git-ignored
src/eval/
├── index.js
├── schema.js                  # Zod schema for cases
├── load.js                    # loadCases({ file, readFile }), filters (subset, case, role), refuses drafts
├── score.js                   # scoreCase(case, result), summarise(scores)
├── review.js                  # toReviewCsv(rows), parseReviewCsv(text)
├── report.js                  # buildReport({ summary, review, feedback }) → markdown
├── feedback.js                # summariseFeedback(lines), feedbackToDraftCases(lines)
└── budget.js                  # estimateRequests(cases), createRequestGuard(max)
src/cli/eval.js, evalReview.js, evalReport.js, evalFromFeedback.js   # wiring only
public/…                       # skip-link fix
docs/EVAL_LOG.md, docs/DEMO.md, CHANGELOG.md, README.md
```

## Tests required

- `schema` / `load`: valid file loads; missing fields, unknown role, unknown
  status, unknown tag rejected with the case id; drafts refused by the runner
  but loadable for review; subset, case and role filters.
- `score`: one test per metric, including partial citation recall, a
  `mustNotCite` hit, `maxConfidence` exceeded, a not-found case answered
  confidently (dishonest), a clarify case, and style violations on depth 1.
- `summarise`: percentages, p50/p95, confusion matrix, empty input.
- `review`: CSV round trip with commas, quotes and newlines in answers;
  unknown verdicts rejected; missing rows reported.
- `report`: calibration table, small-sample labels, targets met/not met,
  feedback section; deterministic output for a fixed input.
- `feedback`: summary counts; thumbs-down → draft cases with `draft: true`.
- `budget`: estimate; guard stops at the limit and reports how many ran.
- Skip link: focus order and visibility class on first Tab.

## Acceptance criteria

- [x] `npm run verify` passes; coverage ≥ 90% on all four measures.
      _2990 tests; 100% on all four._
- [x] `eval/questions.example.yaml` committed; the real set has 30–40 owner-verified cases with the agreed mix.
      _38 cases, git-ignored by the owner's choice._
- [x] A baseline full run, the owner's review CSV and `report.md` exist; key numbers pasted into the PR.
      _Run `20261011-200058`. The verdicts in the review CSV were drafted by Claude Code at the owner's request, not independent. Numbers go in the PR description._
- [x] Top failure categories identified; at most 2 tuning rounds, each logged in `docs/EVAL_LOG.md` with before/after numbers.
      _Two rounds, both logged. Round 2 is confirmed only on a 20-case subset (16 finished)._
- [ ] Final full run reported against the MVP targets, with each miss explained.
      _Not met: the full run was not done, because it would have used up the Copilot allowance (owner's decision). The log's closing summary reports the targets from the baseline and the 20-case subset and explains each miss._
- [x] The release-date (out-of-scope) behaviour is measured and either fixed or explained with evidence.
      _Measured in three runs: it never gave a date; it was answered at low confidence at baseline, then `not_found`. Not `out_of_scope`; explained in the log._
- [x] `eval:from-feedback` produces draft cases from `data/feedback.jsonl`.
      _Run on the owner's file: 1 draft case written to the git-ignored `eval/questions.from-feedback.yaml`._
- [x] Skip link appears on the first Tab (owner confirms).
      _Owner confirmed after the always-visible link replaced the hidden one._
- [x] README, `docs/DEMO.md` and `CHANGELOG.md` complete.
- [x] Phase 5 acceptance criteria ticked in `docs/phases/phase-5.md` (first commit of the branch), and all phases' boxes reflect reality.
      _Two boxes stay open on purpose, with notes: Phase 4 out-of-scope and Phase 5 live rendering of clarify and out-of-scope._
- [ ] CI green; SonarQube quality gate passes with zero new issues.

## Git rules for this phase

Claude Code never commits or pushes and never adds `Co-Authored-By:` or
"Generated with Claude Code" lines (CODING_PRINCIPLES §8). After each step it
runs `npm run verify`, stops, summarises and suggests a Conventional Commit
message. The owner tags the release.

## Manual steps for the repo owner

1. Pull `main`; let Claude Code create `phase-6-eval-polish`.
2. Check Copilot usage before the first full run.
3. Verify every drafted eval case (status, sources, reference) and remove `draft: true`.
4. Fill in the `verdict` column of `review.csv` after the baseline and final runs.
5. Approve each tuning change before it is implemented.
6. Do the skip-link DevTools check and the final demo run-through.
7. After merging, tag the release: `git tag v0.1.0 && git push origin v0.1.0`.
