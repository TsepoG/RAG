# Roadmap — Local MVP

The goal of the MVP is a role-aware assistant that runs on one developer machine
(`npm run dev`) and answers questions from Confluence and GitHub with linked
sources and an honest confidence level. The full production design lives in
`docs/SYSTEM_DESIGN.md`; this roadmap covers only the local MVP.

Each phase is one branch and one pull request. A phase is done when its
acceptance criteria are met, CI is green and the SonarQube quality gate passes.
Each phase has its own context file in `docs/phases/phase-N.md`, added to the
repo when that phase starts.

| # | Phase | Outcome | Est. effort |
| --- | --- | --- | --- |
| 1 | Foundation and quality gates | Project skeleton, linting, JSDoc type checks, tests with a 90% coverage gate, SonarQube, GitHub Actions on PRs, validated config loader | 0.5–1 day |
| 2 | Copilot + MCP connection | Copilot SDK session wired to the Atlassian Rovo and GitHub MCP servers, read-only tools only, CLI that answers a question | 1 day |
| 3 | Citations and roles | Citation Registry (`C1`, `G1` keys), source links pinned to version/commit, role profiles in YAML, role-aware prompt builder | 1 day |
| 4 | Honesty and answer quality | Confidence levels with hard caps, gaps and conflicts, inferred vs stated, style check with one rewrite, "not found" and clarify behaviour | 1 day |
| 5 | Local web UI | HTTP server with SSE streaming, role picker, chat, Sources panel, confidence banner, "show more detail" | 1 day |
| 6 | Evaluation and polish | 15–20 real questions per role in an eval set, eval runner and report, prompt tuning, README and demo script | 1 day |
| 7 | Conversations | A chat: follow-up questions in one Copilot session per conversation, citation keys that last the whole conversation, per-answer Sources panels, manual and automatic re-checks of cited sources, multi-turn eval cases and a regression run | 1–2 days |
| 8 | UI and UX redesign | The page rebuilt to the approved Clarity design: sidebar and chat layout, step-by-step progress, per-answer sources and re-check states, suggested questions per role, Copy this conversation, a typical answer time hint, self-hosted fonts, accessibility checks and a phone layout | 3–4 days |
| 9 | Sign in with Atlassian | Opt-in `ATLASSIAN_AUTH_MODE=oauth`: the person signs in with their own Atlassian account from the web app, the sign-in is kept on the machine and renewed automatically, Copilot's Confluence connection uses it, re-check reads page versions over MCP, and Sign out revokes it. Service-account modes unchanged | 4–5 days |
| 10 | GitHub through the GitHub CLI login | Opt-in `GITHUB_AUTH_MODE=gh-cli`: the GitHub MCP server and the app's own GitHub calls use the token from the person's `gh auth login`, the page shows which GitHub account is in use and what to do when the CLI isn't logged in, and `npm run github:check` says whether an account and organisation allow it before switching. Token mode unchanged | 2.5–3 days |

## Out of scope for the MVP

SSO, the MCP Gateway service, Postgres answer log, dashboards, deployment and
multi-user access. Credentials come from a local `.env` file. The one exception
is per-user Atlassian sign-in, added in Phase 9 as an opt-in mode, and the
person's own GitHub CLI login for GitHub, added in Phase 10 as an opt-in mode;
Copilot keeps its own login.

## Branch and PR flow (every phase)

1. `git checkout -b phase-N-<short-name>` from `main`.
2. Add `docs/phases/phase-N.md`, then start Claude Code with the phase kickoff prompt.
3. Plan in plan mode, review the plan, then let Claude Code implement it.
4. Claude Code runs `npm run verify` locally until it passes, then opens a PR.
5. CI runs lint, type check, tests with coverage, audit and SonarQube.
6. Fix anything CI or SonarQube reports, then merge.
