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

## Tuning round 1 (2026-10-12)

Run `20261012-163319`, commit `208de073cf89`, base prompt hash `81ddc08c88b9` (baseline
`7acf4fe854aa`). It ran 20 cases: the 8 smoke cases and the 12 other cases the three changes
target. It used 20 requests.

What changed:

1. Confluence pages reach the model as plain text with their headings, and the cap is 60,000
   characters instead of 24,000. When a page is still cut, the notice names the sections that
   were cut. The design page goes from about 80,500 characters to about 49,900 and is now read
   whole.
2. The base prompt asks for the answer-meta block on every reply, including declines and
   clarifying questions.
3. The base prompt separates `out_of_scope` (not about the project) from `not_found` (about the
   project, not answered by the sources), and forbids answering from something merely similar.

### Result on the same 20 cases

| | Baseline (`20261011-200058`) | Round 1 |
| --- | --- | --- |
| Passed every check that applies | 11 of 20 | 10 of 20 |
| Status exactly as expected | 11 of 20 | 10 of 20 |
| Smoke cases that passed | 5 of 8 | 4 of 8 |
| Meta block missing | 5 | 4 |
| Expected sources missed (sum over the 7 long-page cases) | 7 | 3 |

Two cases changed outcome: `nf-dev-grade-thresholds` (`not_found` to `answered`) and
`oos-pm-next-year-releases` (`answered` to `not_found`, still a miss). `nf-dev-grade-thresholds`
is the same case that changed outcome between the baseline smoke run and the baseline full run, so
it is part of the measured variation. **The smoke result went from 5 to 4 passed, a change of one
case, which is not larger than the baseline variation of 1 case of 8. Round 1 shows no
improvement on the smoke set and, by the rule in this log, none is claimed.**

### Effect per change

1. **Page text and the larger cap.** The only change that shows an effect, on the cases it
   targets: expected sources missed fell from 7 to 3 (`ba-sector-membership-built` 2 to 0,
   `ba-survivor-universe` 1 to 0, `ba-trailing-high-basis` 2 to 1, `pm-open-decision-dip` 1 to 0;
   `pm-phase-status` went from 0 to 1, `po-backtest-trust` stayed at 1). `pm-open-decision-dip`,
   the baseline's wrong answer, now says the trailing-high basis is not recorded as settled and
   lists the options. Whether that is correct is for the review to say. Cost: 20 requests for 20
   cases, the same as one request per case; credits per case were not measured separately.
2. **Answer-meta on every reply.** Three of the five cases that lacked the block now have it
   (`qa-backfill-clarify`, `nf-qa-load-tests`, `oos-pm-next-year-releases`), and two others lost
   it (`nf-dev-grade-thresholds`, `oos-qa-python-gc`). Net 5 to 4, within the variation. The
   replies that still lack it are one-call declines with no tool use (`oos-po-weather`,
   `oos-qa-python-gc`): the model answers "I couldn't find this" and stops, ignoring the rule.
   A rule in the prompt is not enough for these.
3. **`out_of_scope`, `not_found`, and "merely similar".** No effect that can be seen. The two
   `out_of_scope` cases that came back `not_found` are the ones with no block, so their status is
   guessed from the lack of citations and the new wording never applies. `nf-ba-fx-rates` was
   still answered from something similar, at `medium` confidence, and `dev-rate-limit-clarify`
   still answered one reading of a two-way question.

### Which model answered

Every case was answered start to finish by one model: 12 by `gpt-6-luna`, 8 by
`mai-code-1.1-flash`, none by both. No call carried routing details and no model change was
reported. The eight `mai-code-1.1-flash` cases are the same eight, among these 20, as in the
baseline, so the model is chosen for the whole question, from the question, before the first
call. It is not a switch during a question and it is not random. The cause is still unknown; what
decides it is outside what the SDK reports. Because each case keeps its model from run to run,
comparing a case with itself is fair.

### Correctness on the seven long-page cases

The verdicts for these seven were drafted by Claude Code, as were the baseline's, so both sets
have the same author and are not an independent judgement. Seven cases is also too few to
conclude from.

| Case | Baseline | Round 1 |
| --- | --- | --- |
| `pm-open-decision-dip` | wrong | correct |
| `ba-trailing-high-basis` | partial | correct |
| `ba-sector-membership-built` | partial | correct |
| `ba-survivor-universe` | correct | correct |
| `po-backtest-trust` | correct | partial |
| `pm-phase-status` | partial | partial |
| `po-short-term-picks` | partial | correct |
| Share correct (partial counts half) | 57% | 86% |

The four improvements are in cases whose answers depend on sections of the design page that used
to be cut. `po-backtest-trust` went down: the answer is right that the backtest cannot be trusted
yet but no longer says why results would look better than reality.

## Tuning round 2 (2026-10-12), before its live run

Three changes, none run live yet:

1. **A short paragraph that ends with a citation counts as cited.** A paragraph or list item of up
   to three sentences whose last sentence carries a citation is not asked for citations on its
   other sentences. A longer paragraph is judged sentence by sentence as before.
2. **The list of releases is a citable source** (kind `releases`, titled "Releases", linked to the
   repository's releases page, pinned to the head commit when it can be found, like a folder
   listing). `pm-release-history` expected a source matching `v0.2.0`, which a list cannot give, so
   its expectation in the eval set now matches `Releases`. That is a change to the case made
   after seeing it fail, because the source it asked for can no longer exist as such; it is
   noted here so it is not mistaken for tuning to the result.
3. **A missing or unusable answer-meta block is asked for once more.** Only when it is missing or
   invalid and the reply has an answer; at most once per question; tools locked; the request
   asks for the block alone for the previous reply; the answer text is the first reply's and is
   never replaced; the repaired report goes through all the confidence rules. The result records
   `metaRepaired`, the run summary shows how many reports were got this way, and the request
   guard counts the extra request. It was applied because round 1 left the missing-report rate at
   4 of 20 (20%), above the 10% bar.

### The uncited-sentence rule, re-scored offline

The stored answers of the baseline and of round 1 were run through the new rule. No requests were
made. The model's own reported confidence is not stored, so the effect on confidence has two
bounds: a floor, where no answer moves, and a ceiling, where every answer that is freed of its only
cap goes from `medium` to `high`, as if the model had said `high`. The ceiling probably overstates.

| | Baseline (31 answered) | Round 1 (16 answered) |
| --- | --- | --- |
| Answers with an uncited sentence, before | 16 | 10 |
| Answers with an uncited sentence, after | 4 | 3 |
| Answers freed of the uncited cap | 12 | 7 |
| Of those, answers with no other cap | 6 | 2 |

Calibration of the baseline (verdicts for all 31), with partial counting half:

| Level | Before: judged, share correct | After, floor | After, ceiling |
| --- | --- | --- | --- |
| high | 3, 100% (small sample) | 3, 100% | 9, 89% (7 correct, 2 partial) |
| medium | 20, 73% (11 / 7 / 2) | 20, 73% | 14, 68% (7 / 5 / 2) |
| low | 8, 94% | 8, 94% | 8, 94% |

The six answers that could become `high`: `dev-alias-chain-order`, `dev-point-in-time-guard`,
`ba-derived-values`, `pm-biggest-risk` (all correct), `dev-rate-limit-clarify` and
`ba-trailing-high-basis` (partial). For round 1 only 7 of 16 answers have a verdict: at the ceiling
`high` would hold one correct answer and `medium` four (75%). That is too few to say anything.

What it shows: the rule removes most of the uncited flags (16 to 4 of 31), as intended. It does not
fix the inverted calibration. Even at the ceiling `medium` is correct 68% of the time against 94%
for `low`, and `high` (89%) would sit just under the 90% target. The inversion comes mostly from
what each level holds: `low` answers are the ones that hedge, and are right; `medium` holds the
partial and wrong answers. The live run will show the real effect, since the model's reported
level will then be seen after the rule.

### Round 2, first live run (`20261012-173807`)

Commit `a435dfa7f359`, base prompt hash `81ddc08c88b9`, the same 20 cases as round 1, 22 requests
counted for 20 cases. **This run cannot be used to judge round 2.** Four questions ran out of time
(120 s) and the repair of the confidence report did not work and left no record of why.

| | Baseline | Round 1 | Round 2, first run |
| --- | --- | --- | --- |
| Passed every check that applies | 11 of 20 | 10 of 20 | 11 of 20 |
| Status exactly as expected | 11 of 20 | 10 of 20 | 11 of 20 |
| Questions that failed | 0 | 0 | 4 |
| Answers with an uncited sentence | 10 of 20 | 10 of 20 | 1 of 20 |
| Meta block missing | 5 | 4 | 4 |
| Meta block got by asking again | n/a | n/a | 0 |
| Citation recall | 75% | 73% | 64% |
| Median time to an answer | n/a | 48.8 s | 70.8 s |

What the run does show:

- **The paragraph rule works as an instrument.** Answers with an uncited sentence went from 10 of
  20 to 1 of 20 (the offline re-score predicted 3 of 16 answered). `dev-alias-chain-order` is
  reported `high`; no answer that was reported `high` was judged here, so calibration is not
  re-measured.
- **The release list works.** `pm-release-history` was `not_found` in all three earlier runs. It is
  now `answered`, cites the release list (`G1`, pinned) and gives the three releases with their
  dates. It was answered by `gpt-6-luna` this time, where it was `mai-code-1.1-flash` in every earlier
  run, so which model answers a question is not fixed from run to run.
- **`oos-po-weather` was answered `out_of_scope`** with a report, for the first time.

What it does not allow a conclusion on:

- **Four timeouts, all on questions the earlier runs gave to `mai-code-1.1-flash`**
  (`ba-sector-membership-built`, `nf-ba-fx-rates`, `nf-qa-load-tests`, `oos-pm-next-year-releases`).
  No question given to `gpt-6-luna` timed out, but those were slower too (median 65 s on 13
  questions, against 48.8 s in round 1 for the whole set). Whether the service was slow or the
  larger pages and the extra call are the cause is not known. Four of the 20 cases have no result.
- **The repair did not produce a report in any of the four cases that still lack one**
  (`nf-dev-grade-thresholds`, `oos-dev-bloomberg-scores`, `qa-backfill-clarify`,
  `oos-qa-python-gc`). The result did not record whether the extra request was sent or how it
  ended, and the request count only included repairs that worked, so the 22 requests understate
  what was used. Both are fixed in the next commit: a repair that was tried and not used now
  records why (`missing`, `invalid-json`, `invalid-shape`, `error` or `timeout`), counts as a
  request, and has its own line in the summary.

### Round 2, why the repair fails (`20261012-181404`)

The four cases that still lacked a report were run again (7 requests for 4 cases; one timed out at
120 s again, `qa-backfill-clarify`). In the other three the extra request was sent and the model
replied with a block, but it was rejected as the wrong shape: `nf-dev-grade-thresholds`,
`oos-dev-bloomberg-scores` and `oos-qa-python-gc` all have `metaRepairRejectedReason`
`invalid-shape`. So the model is not ignoring the instruction; the block it writes fails the
schema, and probably did the first time too (a bad block is removed from the answer exactly like a
missing one, so the earlier "missing" counts include these). The names of the wrong fields are now
recorded (`metaRepairRejectedFields`, names only) so the next run says which ones.

### Round 2, the field that fails, and the change (`20261012-182555`)

The three cases were run again with the names of the wrong fields recorded (6 requests for 3
cases). All three repairs were rejected as `invalid-shape`, and the only field named in each is
`confidenceReason`: `nf-dev-grade-thresholds`, `oos-dev-bloomberg-scores` and `oos-qa-python-gc`.
No other field is wrong. The model leaves the reason out, writes it empty, or writes it over 300
characters when it declines; which of the three is not known, because values are not recorded.
The prompt says the confidence is only for an answered reply, and the model seems to drop the
reason with it.

Change, approved by the owner: the report's `confidenceReason` is required, and checked as before,
only when the status is `answered`. For `not_found`, `out_of_scope` and `clarify`, a missing,
empty or non-text reason is replaced by a fixed sentence for that status ("Nothing relevant was
found in the sources.", "The question is outside what the sources cover.", "The question needs
clarifying first."), and a reason over 300 characters is cut to 300. Every other field is as
strict as before, and the repair request stays as a safety net. This affects the first reply as
well as the repair, so the missing-report rate in the next run is the thing to look at.

### Round 2 result (`20261012-183901`)

Commit `d51f8cd076f4`, the same 20 cases as rounds 1 and 2's first run, 24 requests counted for 20
cases. Four questions ran out of time at 120 s and have no answer (`ba-sector-rule`,
`ba-survivor-universe`, `pm-phase-status`, `pm-release-history`), so the comparison below is on
the 16 that finished. Each of the four passed or was a known miss before, so leaving them out does
not favour this run.

| On the 16 cases that finished | Baseline | Round 1 | Round 2 |
| --- | --- | --- | --- |
| Passed every check | 8 | 7 | 12 |
| Status exactly as expected | 8 | 7 | 12 |

| On all 20 | Baseline | Round 1 | Round 2 |
| --- | --- | --- | --- |
| Meta block missing | 5 | 4 | **0** |
| Meta block got by asking again | n/a | n/a | 3 |
| Declined when it should (of 7) | 3 | 3 | 6 |
| Answers with an uncited sentence | 10 | 10 | 3 |
| Questions that failed | 0 | 0 | 4 |

- **Gain beyond the baseline variation.** On the cases that finished, 12 passed against 7 in round
  1 and 8 in the baseline, a gain of 4 to 5 cases, where the variation measured at baseline was 1
  case of 8. The smoke set itself cannot be compared: 2 of its 8 cases are among the four that
  timed out. The final full run has to confirm it.
- **What produced it.** The answer-meta block is no longer missing in any case (0 of 20), so the
  statuses of declines are now reported: `oos-dev-bloomberg-scores`, `oos-po-weather` and
  `oos-qa-python-gc` are `out_of_scope`, and `nf-dev-grade-thresholds` and `nf-qa-load-tests` are
  `not_found`. Three of the 20 reports (`oos-dev-bloomberg-scores`, `qa-backfill-clarify`,
  `oos-qa-python-gc`) still needed the second request, so the first reply lacked a usable report
  in 3 of 20 (15%), above the 10% bar; the repair covers it at the price of one request each.
- **What it did not fix.** `nf-ba-fx-rates` is still answered at `medium` from the price provider
  (the "nothing merely similar" rule has not changed it in three runs). The two clarify cases are
  still answered: `dev-rate-limit-clarify` picks one reading, and `qa-backfill-clarify`, which does
  ask a question, was reported `answered` by its repaired report. `oos-pm-next-year-releases` is
  `not_found` where `out_of_scope` was expected.
- **Timeouts.** The four that failed are not the same as last time (these include two
  `gpt-6-luna` questions). The median time to an answer for the finished questions has risen from
  44 s to 53, 65 and 76 s over the four runs of the day, while a question such as
  `dev-alias-chain-order` took 42 to 64 s on the same sequence of tool calls. That points at the
  service slowing during the day more than at the changes, but it is not proved. Citation recall
  (55%) is lowered by the four timed-out cases, which score as having cited nothing.
- **Latency.** Far above the design's 8 s target in every run.

## Closing summary (2026-10-12)

**The final full run was not done.** It would have taken 45 to 55 requests and about 45 minutes,
and the owner decided it would use up the Copilot allowance. The brief asks for a final full run
reported against the MVP targets; this section reports the targets with what was measured, and
says where it was not. The last measurements are the baseline over 38 cases and the second round
over 20 of them (16 finished). The tuning changes were not confirmed on all 38.

| Target | Should be | Baseline (38 cases) | Latest: round 2 (20-case subset) | Standing |
| --- | --- | --- | --- | --- |
| Status exactly as expected | at least 85% | 76% (29 of 38) | 60% (12 of 20); 75% (12 of 16) of those that finished | not met; not re-measured on the full set |
| Citation recall | at least 70% | 75% | 86% over the 7 finished cases that expect sources (55% counting the 4 timeouts as zero) | met in both |
| Answered cases that are correct | at least 80% | 81% (21 correct, 8 partial, 2 wrong of 31) | 7 verdicts only (round 1): 86% | borderline at baseline; verdicts are not independent |
| `high` answers that are correct | at least 90% | 3 of 3, too few | no verdicts | not enough data |
| Cases to decline handled honestly | at least 80% | 90% (9 of 10) | 86% (6 of 7) | met in both |
| Style problems left for a depth 1 role | none | 0 | 0 | met |
| Answers with no confidence report | at most 10% | 13% (5 of 38) | 0% (0 of 20) after asking again; 15% (3 of 20) without | met only with the repair request |

**Each miss, and why**

- **Status exactly as expected (76%).** Of the 9 wrong statuses at baseline, 5 were declines that
  came back without the answer-meta block, so their status was guessed; round 2 fixed that
  (three `out_of_scope` and two `not_found` cases now have their status). What remains is the
  model's behaviour, which the changes did not move: `nf-ba-fx-rates` is answered from something
  similar in three runs; the two clarify cases are answered rather than clarified; and
  `oos-pm-next-year-releases` is `not_found` where `out_of_scope` was expected (it is a decline
  either way, and it never made up a date). The 20-case subset is also heavy with these cases, so
  60% understates the full set; the full-set figure after tuning was not measured.
- **Correctness (81%).** Met at baseline by a margin of one case, with verdicts drafted by Claude
  Code and not independent; two `partial` changed to `wrong` would put it at 78%. After tuning, the
  seven long-page cases went from 57% to 86% correct (Claude's drafts both times), which is too few
  cases to conclude from.
- **`high` correctness.** Only 3 answers claimed `high` at baseline, so the target cannot be
  judged. Calibration was inverted at baseline (`low` 94% correct, `medium` 73%), and the
  uncited-sentence change does not fix it (offline, even at the ceiling `medium` stays at 68%):
  `low` answers hedge and are right, and `medium` holds the partial and wrong ones.
- **Missing report (13%).** 0 after the second request, but 3 of 20 first replies still lacked a
  usable block (15%); the repair costs one request each.

**The release-date question** (`oos-pm-next-year-releases`). Baseline: answered at `low`
confidence with no usable report, saying there is no published schedule and citing the project
version. Round 1 and round 2: `not_found`, "I couldn't find anything about this", with a report.
It never gave a date in any run. It is treated as a decline, which is honest behaviour, but its
status is `not_found` and not `out_of_scope`, and the changes to the prompt did not change that.

**Other findings, not tuned**

- **Latency.** The median time to an answer was 44 to 76 s across the day's runs, against the
  design's 8 s target, and rose through the day; 4 of 20 questions exceeded the 120 s limit in each
  of the last two runs. A question reads several sources through up to a dozen tool calls.
- **Which model answers.** Every question was answered by one model, `gpt-6-luna` or
  `mai-code-1.1-flash`, not mixed, with no model-change event and no routing details. Which model
  a question gets changed between runs for at least one question, so results are not tied to one
  model. The cause is unknown; Copilot decides.
- **Clarifying questions.** The assistant almost never asks; a question that fits two things is
  answered with one reading. This is the clearest remaining weakness.
- **Request cost.** About 0.4 to 0.6 AI credits a question on the Free plan, measured at the start.

# Phase 7

## Baseline for the conversation work (2026-10-13)

The regression of Phase 7 (the full set through the conversation path) is compared with this run,
not with the Phase 6 baseline above: Phase 6 never had a final full run, and this one is on a
different account with one pinned model.

| | |
| --- | --- |
| Run | `20261013-163928` |
| Path | single question (`askQuestion`), the 38 cases of the eval set |
| Account | Copilot Pro+ |
| Model asked for | `gpt-6-luna`; the only model that answered |
| Timeout | `ASK_TIMEOUT_MS=240000` |
| Commit | `f42ddca0cc85`, base prompt hash `81ddc08c88b9` (unchanged since Phase 6) |
| Requests | 44 for 38 cases (limit 70) |
| Verdicts | drafted by Claude Code for the 27 answered cases (22 correct, 5 partial, 0 wrong); the owner reviewed each one and agreed with all of them, so they are the owner's verdicts, written by Claude Code |

### Against the MVP targets

| Target | Should be | Phase 6 baseline (Free plan, two models) | Phase 7 baseline (Pro+, `gpt-6-luna`) | Result |
| --- | --- | --- | --- | --- |
| Status exactly as expected | at least 85% | 76% | 82% (31 of 38) | not met |
| Citation recall | at least 70% | 75% | 83% | met |
| Answered cases that are correct | at least 80% | 81% | 91% (22 correct, 5 partial of 27) | met |
| `high` answers that are correct | at least 90% | 3 of 3 | 92% (6 judged: 5 correct, 1 partial) | met |
| Declines handled honestly | at least 80% | 90% | 100% (9 of 9) | met |
| Style problems at depth 1 | none | 0 | 1 (`pm-ci-checks`, inline code left after the rewrite) | not met |
| Answers with no confidence report | at most 10% | 13% | 3% (1 of 38) after asking again; 11% (4 of 38) in the first reply | met with the repair |

Other numbers: 30 of 38 cases passed every check that applies (79%); declined when it should 9 of
10; sentences without a citation 3 of 38; questions that used every tool call 10; 2 questions timed
out at 240 s (`po-built-vs-planned`, `nf-pm-hosting-cost`); median time to an answer 57.2 s, 95th
percentile 241.5 s.

The two runs differ in account, model routing, the tuning of Phase 6 and the timeout, so the
difference between them cannot be put down to any one of those.

### What still misses

- **Status (7 cases).** The two clarify cases are answered (`dev-rate-limit-clarify`,
  `qa-backfill-clarify`); `oos-dev-bloomberg-scores` and `oos-pm-next-year-releases` are
  `not_found` where `out_of_scope` was expected; `oos-qa-python-gc` is `not_found` and its report
  was asked for and still not usable; the two timeouts have no status.
- **Calibration.** `high` 92%, `medium` 88%, `low` 100% on 4 answers (too few to read). The
  inversion seen at baseline is gone, but one `high` answer is a partial (`dev-rate-limit-clarify`).
- **Release list.** `pm-release-history` is answered and correct; it was `not_found` in Phase 6.
- **Source cut notice.** Several questions use all their tool calls (10 of 38) and a long page
  can still be cut; `ba-derived-values`, `ba-trailing-high-basis`, `po-what-it-does`,
  `po-built-vs-planned`, `po-advice` and `pm-ci-checks` each miss an expected source.
- **Tool catalog message.** A first manual question on this account logged `MCP tool catalog
  changed before tool "…" could be invoked` for its first two tool calls, which then worked on
  the retry. It was seen once in a single question and was not counted in this run.

## Multi-turn cases (2026-10-14)

Five conversation cases (14 turns), drafted by Claude Code from facts already checked in the
single-question cases, reviewed by the owner, and run through the conversation path with the
pinned model `gpt-6-luna`. They sit in the git-ignored `eval/questions.yaml` and are not part of
the 38 cases of the regression.

| Run | What | Result |
| --- | --- | --- |
| `20261014-182728` | all five, default `ASK_TIMEOUT_MS` (120 s) | 6 of 14 turns passed. Three conversations timed out on their first turn (`conv-dev-ticker-conflict`, `conv-ba-survivors`, `conv-po-built-then-plain`), so their later turns were not asked. A setup error: the baseline used 240 s. |
| `20261014-183804` | those three again with `ASK_TIMEOUT_MS=240000` | 7 of 8 turns passed; no failed question. |

Verdicts (drafted by Claude Code, accepted by the owner): 11 of the 14 turns pass, counting the two
completed conversations of the first run and the rerun; all four turns that expected a source from an
earlier turn reused one without fetching it again (`conv-dev-edgar-limits-t2`,
`conv-dev-ticker-conflict-t2`, `conv-qa-tests-then-gap-t2`, `conv-ba-survivors-t3`).

- **Real finding:** `conv-po-built-then-plain-t2` ("Can we trust the backtest results yet?") claims
  `high` with no caps, where the case allows `medium`. The same question asked alone in the baseline
  read the code and got `medium`; in the conversation the model answered from pages it already had and
  checked no code. The answer is correct and the confidence is not earned. The case was left failing.
- **Accepted miss:** `conv-po-built-then-plain-t3` misses the expected page `262425` and cites the
  Design page, as `po-advice` did in the baseline. The answer is right.
- **Questionable:** `conv-po-built-then-plain` (turn 1) says the product can build a time-aware
  semiconductor universe, which the docs claim and the repository does not contain.
- **Changed after the run:** the question of `conv-dev-ticker-conflict` turn 2 was reworded from
  "Does the design document say the same?" to "Does the design document describe the same behaviour as
  the code?" (the old answer opened with a confusing "Yes"). The reference clause "the backtest is not
  built yet either" was removed from `conv-ba-survivors` turn 3, which the question does not need. The
  reworded question was not run again (owner's decision); its verdict rests on the old wording.

## Regression through the conversation path (2026-10-14)

The 38 single-question cases, each asked as a conversation of one turn, compared with the baseline
`20261013-163928`. The five multi-turn cases were left out with `--ids`.

| | |
| --- | --- |
| Run | `20261014-190623` |
| Path | conversation (`createConversationRunner`), the 38 cases |
| Model asked for | `gpt-6-luna`; the only model that answered |
| Timeout | `ASK_TIMEOUT_MS=240000` |
| Commit | `9af552abe162`, base prompt hash `81ddc08c88b9` (same as the baseline) |
| Requests | 45 for 38 cases; no question failed |
| Verdicts | drafted by Claude Code for the cases whose status, confidence or expected source changed; the owner reviewed and accepted them. Unchanged cases keep their baseline verdict. |

### Against the noise rule

| Measure | Baseline | Conversation path | Rule | Result |
| --- | --- | --- | --- | --- |
| Cases that lost a pass | | 1 (`dev-append-only-trigger`) | net loss of more than 5 is a regression | none |
| Cases that gained a pass | | 7 | | net +6 |
| Status exactly as expected | 82% (31 of 38) | 95% (36 of 38) | no drop of more than 13 points | met |
| Declined when it should | 9 of 10 | 10 of 10 | no drop of more than 13 points | met |
| Answered cases that are correct | 91% (22 correct, 5 partial of 27) | 88% (20 correct, 6 partial of 26) | no drop of more than 13 points | met (down 2.5) |
| Questions that timed out | 2 | 0 | | |

**No regression beyond noise.** Gained passes: `oos-dev-bloomberg-scores`, `oos-qa-python-gc` and
`oos-pm-next-year-releases` (now `out_of_scope`), `qa-backfill-clarify` (now `clarify`),
`pm-ci-checks`, `nf-pm-hosting-cost` and `po-built-vs-planned` (the last two timed out in the baseline).

### Cases with a new verdict

| Case | Change | Verdict |
| --- | --- | --- |
| `dev-append-only-trigger` | answered `high` → `not_found`, no sources | wrong: declines a question the baseline answered correctly |
| `pm-phase-status` | `medium` → `low` | partial (was correct): does not say scoring is next |
| `po-built-vs-planned` | timeout → `medium` | partial: lists sector membership as built from the docs and does not note it is missing from the repository |
| `qa-jump-threshold` | `medium` → `low` | partial, as in the baseline |
| `pm-ci-checks` | now passes | partial, as in the baseline; Postgres 16 and strict types are now given, the PR-title rule is not |
| `dev-edgar-client-limits`, `ba-derived-values`, `ba-trailing-high-basis`, `ba-survivor-universe`, `po-backtest-trust`, `pm-release-history` | confidence changed | correct |
| `qa-backfill-clarify` | answered → `clarify` | correct on status |

Cases whose cited sources changed but whose status and confidence did not (29 cases showed some
difference in sources) kept their baseline verdict.

### Other differences

- Median time to an answer 79.8 s (baseline 57.2 s); 95th percentile 229.3 s (baseline 241.5 s).
- 12 questions used every tool call (baseline 10).
- The confidence report was got by asking again on 5 cases (baseline 1).
- 2 answers were rewritten for style; no style problems were left at depth 1.
- `dev-append-only-trigger` is the one real loss. It was not run again; it may be search noise.

## Smoke in oauth mode (2026-10-28)

The 8 smoke cases asked with `ATLASSIAN_AUTH_MODE=oauth` (the owner's own Atlassian sign-in),
compared with the same 8 cases in the latest bearer-mode run, `20261014-190623`.

| | |
| --- | --- |
| Run | `20261028-155909` |
| Path | conversation, the 8 smoke cases |
| Model asked for | `gpt-6-luna`; the only model that answered |
| Timeout | `ASK_TIMEOUT_MS=240000` |
| Commit | `193656d98ccb`, base prompt hash `81ddc08c88b9` (same as the comparison run) |
| Requests | 10 for 8 cases; no question failed |
| Verdicts | drafted by Claude Code, reviewed and accepted by the owner. The comparison run keeps the baseline verdicts. |

### Against the noise rule

| Measure | Bearer (`20261014-190623`) | Oauth | Rule | Result |
| --- | --- | --- | --- | --- |
| Cases passed | 7 of 8 | 6 of 8 | net loss of more than 5 (over 38) is a regression | none (net −1) |
| Status exactly as expected | 88% (7 of 8) | 75% (6 of 8) | no drop of more than 13 points | met (down 12.5) |
| Declined when it should | 2 of 2 | 2 of 2 | no drop of more than 13 points | met |
| Answered cases that are correct | 92% (5 correct, 1 partial of 6) | 83% (4 correct, 2 partial of 6) | no drop of more than 13 points | met (down 8.3) |

**No regression beyond noise**, on a small sample. Every answered case cited Confluence through the
signed-in token.

- `oos-pm-next-year-releases`: `out_of_scope` → `not_found`. It still declines without describing
  how releases work. The same case moved the other way in the Phase 7 regression, so it is part of
  the measured variation.
- `qa-split-tests`: correct at `medium` → partial at `high`. It lists Apple, both Nvidia splits and
  a GE reverse split but leaves out both Tesla splits, citing the code's fixtures rather than the
  Testing page. One run cannot say whether this is search noise or a difference in what the
  signed-in account sees.
- `dev-rate-limit-clarify` still answers instead of asking which limit is meant, as in bearer mode.
- Median time to an answer 67.1 s (the same cases in bearer mode: 77.2 s); 95th percentile 81.1 s.

## Smoke in gh-cli mode (2026-10-31)

The 8 smoke cases with `GITHUB_AUTH_MODE=gh-cli` (GitHub read with the owner's GitHub CLI login),
compared with the same 8 cases in `20261028-155909`, which used token mode with the same Atlassian
oauth sign-in. Only how GitHub is read differs between the two runs.

| | |
| --- | --- |
| Run | `20261031-132731` |
| Path | conversation, the 8 smoke cases |
| Model asked for | `gpt-6-luna`; the only model that answered |
| Timeout | `ASK_TIMEOUT_MS=240000` |
| Commit | `8838f5197a33`, base prompt hash unchanged |
| Requests | 10 for 8 cases; no question failed |
| Verdicts | drafted by Claude Code, reviewed and accepted by the owner |

### Against the noise rule

| Measure | Token mode (`20261028-155909`) | gh-cli | Rule | Result |
| --- | --- | --- | --- | --- |
| Cases passed | 6 of 8 | 8 of 8 | net loss of more than 5 (over 38) is a regression | none (net +2) |
| Status exactly as expected | 75% (6 of 8) | 100% (8 of 8) | no drop of more than 13 points | met |
| Declined when it should | 2 of 2 | 2 of 2 | no drop of more than 13 points | met |
| Answered cases that are correct | 83% (4 correct, 2 partial of 6) | 90% (4 correct, 1 partial of 5) | no drop of more than 13 points | met |

**No regression beyond noise.** The gains are not claimed as an effect of gh-cli mode: one run of 8
cases cannot separate them from the measured variation.

- `dev-rate-limit-clarify`: answered → `clarify`, as the case expects, for the first time.
- `oos-pm-next-year-releases`: `not_found` → `out_of_scope` again; it has flipped between the
  two before.
- `qa-split-tests` still leaves out both Tesla splits (partial), now at `medium`.
- Confidence changed on 5 cases, within the usual variation.
- Median time to an answer 41.4 s (the same cases in token mode: 67.1 s); 95th percentile 71.3 s.
