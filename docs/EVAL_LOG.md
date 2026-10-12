# Eval log

What was measured, what changed, and the numbers before and after. The eval set and the results
are not in the repository (they describe the owner's own project); this file keeps case ids and
numbers only.

## How to read it

- A run asks every case of `eval/questions.yaml` through the real pipeline (`npm run eval`). Each
  run records the commit, the model asked for, the models that actually answered, each role's
  version and a hash of the shared base prompt, so two runs can be compared knowing what differs.
- **Status exactly as expected** is strict. **Declined when it should** counts `not_found` and
  `out_of_scope` as interchangeable. Both are reported on purpose.
- **Correctness** comes from the owner's review sheet: `correct` counts 1, `partial` 0.5, `wrong`
  0, over the cases the assistant answered. **Calibration** is the same figure for each
  confidence level, and a level with fewer than 5 judged answers is called a small sample.
- **Noise.** Asking the same question twice does not always give the same answer, so a tuning
  change counts as an improvement only if its gain on the smoke set is larger than the variation
  measured at baseline, and it is confirmed on the final full run.
- The MVP targets are in `docs/phases/phase-6.md`. Missing one is a finding, not a failure, as long
  as it is explained.

## Baseline (2026-10-11)

| Run | Folder | Cases |
| --- | --- | --- |
| Smoke, first | `20261011-194351` | 8 |
| Smoke, second | `20261011-195122` | 8 |
| Full | `20261011-200058` | 38 |

All three ran on commit `459509e6e89f` with a clean tree, role versions business_analyst 1,
developer 2, product_owner 2, project_manager 2, qa 1, base prompt hash `7acf4fe854aa`, and the
model asked for set to `gpt-6-luna`. The full run used 40 requests for 38 cases (two answers were
rewritten) and cost roughly 0.4 to 0.6 AI credits per case on the Free plan.

### Against the MVP targets (full run)

| Target | Should be | Was | Result |
| --- | --- | --- | --- |
| Status exactly as expected | at least 85% | 76% (29 of 38) | not met |
| Citation recall | at least 70% | 75% (26 cases) | met |
| Answered cases that are correct | at least 80% | 81% (21 correct, 8 partial, 2 wrong of 31) | met, narrowly |
| `high` answers that are correct | at least 90% | 3 of 3, only 3 judged | not enough data |
| Cases to decline handled honestly | at least 80% | 90% (9 of 10) | met |
| Style problems left for a depth 1 role | none | 0 | met |
| Answers with no confidence report | at most 10% | 13% (5 of 38) | not met |

Other numbers: 28 of 38 cases passed every check that applies (74%). Declined when it should:
60% (6 of 10). Kept to the highest confidence allowed: 8 of 9. Invalid citation keys: 1 of 38.
Sentences without a citation: 16 of 38 (42%). Questions that used every tool call: 11. Questions
that failed: 0. Time to an answer: median 43.8 s, 95th percentile 88.0 s.

Status, expected against got:

| Expected / got | answered | not_found | out_of_scope |
| --- | --- | --- | --- |
| answered | 25 | 1 | 0 |
| not_found | 2 | 3 | 0 |
| clarify | 2 | 0 | 0 |
| out_of_scope | 2 | 2 | 1 |

### Calibration

| Confidence claimed | Judged | Correct / partial / wrong | Share correct |
| --- | --- | --- | --- |
| high | 3 | 3 / 0 / 0 | 100% (small sample) |
| medium | 20 | 11 / 7 / 2 | 73% |
| low | 8 | 7 / 1 / 0 | 94% |

The levels are the wrong way round: answers that claimed `low` were right more often than answers
that claimed `medium`. Most answers are capped at `medium` by the uncited-sentence rule, which
flags correct sentences whose citation sits at the end of the paragraph.

### Noise at baseline

- Smoke second run against first: 8 cases in both, 0 changed outcome (status, or whether the case
  passed), 3 changed confidence.
- Smoke first run against the full run, on the same 8 cases: 1 changed outcome
  (`nf-dev-grade-thresholds`), and confidence differed on 4.
- **Baseline variation used for the improvement rule: 1 case out of 8.**

### Two things that affect how to read the results

1. **The model reported on the answer was not always the one asked for.** For 13 of 38
   full-run answers the last model the runtime reported was `mai-code-1.1-flash`, though
   `gpt-6-luna` was pinned. Those 13 are not a random sample: 5 expected a decline or a clarifying question (12 of all
   38 cases do), and 8 were product owner or project manager cases (14 of 38 are), so the split by
   model below is confounded by case type and role. It does not show that the second model is
   weaker, and it is not used to explain any result.
   **Cause: under investigation.** A smoke rerun (`20261012-154802`) recorded no
   `session.model_change` event in any case, so this is not a session-level switch. Two of its 8
   cases still ended on `mai-code-1.1-flash`, and `pm-release-history`, which did in all three
   baseline runs, did not. Every model call is now recorded per case (model, class of call,
   routing details, and which call wrote the answer); the round 1 rerun will show whether another
   model makes some calls inside a question.

   | Last model reported | Cases | Status as expected | Correctness | Answers with no confidence report |
   | --- | --- | --- | --- | --- |
   | gpt-6-luna | 25 | 88% | 88% | 2 |
   | mai-code-1.1-flash | 13 | 54% | 68% | 3 |

2. **The review verdicts were drafted by Claude Code at the owner's request**, after checking each
   answer against the pages and files (the code claims in the jump, coverage and split answers were
   checked against the repository). They are not an independent judgement. At 21 correct, 8 partial
   and 2 wrong, correctness is 80.6%: two `partial` verdicts changed to `wrong` would put it at
   78.2%, below the target. The owner should spot-check the borderline `partial` rows.

### What went wrong, in order of how many cases it explains

1. **Long pages are cut at 24,000 characters, so the model never sees their later sections.**
   `MAX_SOURCE_CHARS` cuts a fetched page before it is shown. The Design page is about 80,000
   characters, so only its first 30% is visible: the sections on the trailing-high decision (4.4),
   the build phases (7), the settled decisions (7a) and the risk table (8) are never read. Other long
   pages are cut too (Nomination Rule 37% visible, Price Provider Evaluation 34%, Phase 3 notes 15%).
   Affected: `pm-open-decision-dip` (wrong: says the basis is settled when the Design page says it is
   pending), `ba-trailing-high-basis`, `po-short-term-picks`, `ba-sector-membership-built` (partial),
   and missed sources in `ba-survivor-universe`, `po-backtest-trust`, `pm-phase-status`. Five of the
   eight cases that missed an expected source are missing the Design page.
2. **The answer-meta block is missing from replies that decline or ask a question.** All 5 cases
   with no confidence report are among the 12 cases that expect `not_found`, `out_of_scope` or
   `clarify`; none of the 26 answerable cases lacks it. Without it the status is guessed from the
   citations, so a correct "I can't establish that" came out as `answered` at low confidence, or as
   `not_found`. Affected: `oos-dev-bloomberg-scores`, `qa-backfill-clarify`, `nf-qa-load-tests`,
   `oos-po-weather`, `oos-pm-next-year-releases`. This explains 5 of the 9 wrong statuses.
3. **Questions the sources do not answer are mis-sorted, or answered from something similar.**
   `nf-ba-fx-rates` was answered (wrong: it named the price provider as the source of exchange
   rates) and is the one dishonest case. `oos-qa-python-gc` and `oos-po-weather` came back
   `not_found` where `out_of_scope` was expected. `dev-rate-limit-clarify` answered one reading of a
   question with two.

Not tuned in this phase, but recorded:

- `pm-release-history` always ends `not_found`: `list_releases` returns candidates, which cannot be
  cited, so a question about release history has no citable source (a Phase 3 decision, not a bug).
- Median time to an answer is 43.8 s against the design's 8 s target; 11 of 38 questions used every
  tool call they were allowed.
- The release-date question (`oos-pm-next-year-releases`) was measured: it did not make up dates,
  answering in substance that there is no schedule at low confidence, but its status was `answered`
  because of finding 2.
