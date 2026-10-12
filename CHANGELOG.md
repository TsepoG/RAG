# Changelog

One entry per phase. Dates are those of the merge or, for Phase 6, of the last change on its
branch. The version is `0.1.0` for the whole MVP, to be tagged after Phase 6 is merged.

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
