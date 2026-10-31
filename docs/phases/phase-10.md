# Phase 10: GitHub through your GitHub CLI login

## Goal

Let the app read GitHub with **the person's own GitHub CLI login** (`gh auth login`)
instead of a personal access token in `GITHUB_TOKEN`. This is the opt-in setting
`GITHUB_AUTH_MODE=gh-cli`. In that mode:

1. The GitHub MCP server, and the app's own GitHub calls (commit links,
   CODEOWNERS, re-check), use the token `gh` already holds for the person.
2. The person sees which GitHub account is in use, and gets a clear message
   when the CLI isn't logged in.
3. A new command, `npm run github:check`, tells them **before switching modes**
   whether their account and organisation allow this. It is meant for the work
   computer.
4. **Token mode stays the default and doesn't change.**

The approach was proven in a time-boxed spike (see
`docs/phase-10-github-cli-decisions.md`). This phase builds it to the project's
usual standard.

## Out of scope

- A GitHub App, or GitHub OAuth through the web app. Both need an
  organisation owner to approve, and that was ruled out.
- Copilot's own sign-in, which is separate and stays as it is.
- Hosting or multi-user support.
- Narrowing the CLI token's scopes. The CLI can't do it.
- Running `gh auth login` from the app. The login happens in a terminal.

## What Phases 1–9 left in place

- **GitHub MCP config.** `src/mcp/servers.js` builds the `github_repos` server
  with `Authorization: Bearer <GITHUB_TOKEN>`, `X-MCP-Readonly: true` and
  `X-MCP-Toolsets: repos`. It accepts an optional `atlassianToken`, which was
  added in Phase 9.
- **The app's own GitHub calls.** `src/github/api.js` (`createGithubApi({ token, fetch })`)
  is used by `src/github/commits.js`, `src/github/codeowners.js` and
  `src/recheck/github.js`.
- **Read-only protection, in layers:**
  - the read-only MCP header;
  - the allow-list of six read tools;
  - the permission handler;
  - the pre-tool hook, with `GITHUB_REPOS` scope and the code-search cap;
  - GET-only REST calls.
- **Phase 9 patterns to reuse:**
  - the auth-mode switch in config (Atlassian `oauth`);
  - the token provider shape (`src/atlassian/tokens.js`);
  - swapping the header between turns with `restartServer`
    (`sessionToken.js`), which is proven to keep the session's history;
  - `/api/auth/status`;
  - the signed-in panel, the expired banner and the sign-in screen;
  - `*_signin_required` 401s that keep the conversation going;
  - the logger's redaction list.

## Inputs to read first

- `CLAUDE.md`, `docs/CODING_PRINCIPLES.md`, this file.
- `docs/phase-10-github-cli-decisions.md` explains the reasoning; this file
  specifies the work. If they disagree, this file wins; list the disagreement
  in your plan.
- `docs/HOW_IT_WORKS.md`, sections 2, 3 and 6, plus the auth section added in
  Phase 9.
- `docs/phases/phase-9.md` and the Phase 9 code these patterns come from.

## What the spike proved (2026-10-31, personal account, repo `TsepoG/RAG`)

| Check | Result |
| --- | --- |
| CLI login | The token came from the gh login in the system keyring (not an environment variable). Prefix `gho_`. No SSO warnings |
| Scopes | `gist`, `read:org`, `repo`, `workflow` |
| GitHub MCP server, CLI token and read-only headers | Connected. Only read tools offered; all six allow-listed tools found; **no write tools exposed** |
| MCP read | `get_file_contents` on `/` succeeded (28 entries) |
| The app's REST calls, using its own client and headers | Repo 200; head commit 200 with SHA; CODEOWNERS 404 ×3 (no file, which is fine); re-check contents 200 |
| Copilot session, CLI token as a static header | `github_repos` connected; all six read tools found; no prompt sent |

Not tested, because it needs the organisation's repos on the work computer:
SAML SSO authorisation, an organisation policy that blocks the GitHub CLI, and
an organisation Copilot or MCP policy. `npm run github:check` covers these.

## Decisions already made

| Area | Decision |
| --- | --- |
| Mode | `GITHUB_AUTH_MODE=token\|gh-cli`, default `token`. Use the same dispatch pattern as Phase 9, so token mode's schema, errors and tests stay byte-for-byte the same. Add one regression test that token-mode config deep-equals today's. In `gh-cli` mode `GITHUB_TOKEN` isn't required. If it is set anyway, it is ignored, with a one-line startup warning. |
| Getting the token | `src/github/cliToken.js`, modelled on `src/atlassian/tokens.js`. It calls `execFile('gh', ['auth', 'token', '--hostname', 'github.com'])` with no shell, an injected `execFile`, and a 5-second timeout. The child process gets an environment **without `GH_TOKEN` and `GITHUB_TOKEN`**, so the token always comes from the gh login. It never uses `--show-token`. |
| Caching | The token is cached in memory for about 5 minutes, single-flight. `invalidate()` after a 401 from GitHub, then retry once. CLI tokens don't expire, so there is no renewal timer. The token is never written to disk by the app. |
| When it's fetched | When each Copilot session is created (conversation or `askQuestion`), and at the start of each REST batch (commit lookup, CODEOWNERS, re-check). Before each turn, the conversation compares the provider's token with the one its session holds. If it changed, for example after `gh auth login` or switching accounts, swap the header with `restartServer`, using the Phase 9 helper. The replacement config must keep the same allow-list and timeout. |
| Wiring | `buildMcpServers` gains a `githubToken` option, like `atlassianToken`. `createGithubApi` takes `getToken` (async) instead of a fixed token. The token-mode call sites pass a `getToken` that returns `GITHUB_TOKEN`, with unchanged behaviour. Commits, CODEOWNERS and re-check get the provider through injection. |
| Logged out or revoked | Covers three cases: `gh` is missing, `gh auth token` fails, or there is still a 401 after the retry. They raise `GithubSignInRequiredError`, and the routes answer 401 `github_signin_required` before a turn starts, so it doesn't count toward the cap and the conversation is kept. A 403 whose message mentions SSO maps to the reason `sso`, with "Run `gh auth refresh -h github.com` and authorise your organisation". |
| Status API | `GET /api/auth/status` gains `github: { mode, signedIn, login?, reason? }`. `login` comes from `gh api user --jq .login`, run with the same filtered environment and cached until restart. In token mode: `{ mode: 'token', signedIn: true }`. It never includes the token. |
| Page | The signed-in panel adds the line "GitHub: <login> (GitHub CLI)", shown only in gh-cli mode. When signed out, reuse the Phase 9 sign-in screen and expired banner with GitHub wording: "GitHub CLI isn't logged in. Run `gh auth login` in a terminal, then press **Check again**." For `sso`: "Run `gh auth refresh -h github.com` to authorise your organisation, then press **Check again**." There is no sign-in link, because the login happens in a terminal. **Check again** re-reads the status (and invalidates the cache). If Atlassian and GitHub both need attention, show both lines. |
| Secrets | `githubToken` is added to the logger's `SECRET_KEYS`. gh stderr and every error message pass through a scrubber that removes the token itself and anything shaped like a GitHub token (`gh[opsu]_…`, `github_pat_…`) before logging or responding. Tests prove that a fake token never reaches the log, an API response or the page. |
| Read-only | In gh-cli mode, the token itself can write (`repo`, `workflow`, `gist`), so read-only depends entirely on the app's layers listed above. No layer changes. The README and HOW_IT_WORKS say this plainly. |
| `npm run github:check` | `src/cli/githubCheck.js`. Run it on any machine before switching modes. It prints only the token's 4-character prefix, never the token. Exit 0 only when everything passes. Details below. |

## `npm run github:check`

1. **Login.** Run `gh auth status`.
   - Logged out → FAIL with "Log in with `gh auth login`".
   - Print the scopes and any SSO or authorisation lines.
   - **Warn** if the token's source is `GH_TOKEN` or `GITHUB_TOKEN` rather than the gh login: "the CLI token comes from an environment variable, not your gh login; unset it, or the app may use a different account". The app itself ignores those variables, but the warning still helps.
2. **Each repo in `GITHUB_REPOS`.** Using the app's own client (with the CLI token), do a contents read, a commit lookup and a CODEOWNERS lookup (404 is fine). Give PASS or FAIL per repo, with the likely fix:
   - 401 → `gh auth login`;
   - 403 mentioning SSO → `gh auth refresh -h github.com` and authorise the organisation;
   - 403 or 404 that indicates an organisation restriction on the app → "your organisation blocks the GitHub CLI — keep `GITHUB_AUTH_MODE=token`";
   - other 404 → check the repo name and your access.
3. **MCP.** One tool listing with the read-only headers. All six allow-listed tools must be present, and no write tool (by the app's `isWriteToolName`).
4. **Summary.** One line per check, then an overall PASS or FAIL.

The pure parts (parsing `gh auth status`, classifying failures, the summary)
are tested without a network or a real `gh`.

## Modules to create or change

```
src/github/cliToken.js       # provider: execFile, filtered env, cache, single-flight, invalidate
src/github/cliStatus.js      # parse gh auth status / gh api user; classify failures (sso, logged-out, blocked)
src/github/scrub.js          # token scrubber (or reuse a shared one if Phase 9 has it)
src/github/api.js            # getToken instead of token; 401 → invalidate + one retry
src/mcp/servers.js           # githubToken option
src/conversation/turn.js     # fetch at session creation; pre-turn compare + restartServer
src/answer/askQuestion.js    # token before session creation
src/server/routes/…          # status API github block; 401 github_signin_required
src/config/schema.js, .env.example
src/cli/githubCheck.js       # wiring only (logic in cliStatus.js)
public/js/ui/…               # panel line, banner and sign-in text variants
```

## Tests required

- **Config:**
  - gh-cli mode doesn't require `GITHUB_TOKEN`;
  - a set `GITHUB_TOKEN` is ignored, with a warning;
  - token mode deep-equals today's config;
  - existing config tests are unchanged, except any that list `gh-cli` as invalid.
- **Provider:**
  - `gh` is called with the exact arguments and no shell;
  - the child environment has no `GH_TOKEN` or `GITHUB_TOKEN`;
  - cache hit and expiry;
  - single-flight;
  - `invalidate` plus one retry;
  - `gh` missing (ENOENT), non-zero exit or empty output each raise `GithubSignInRequiredError`;
  - timeout.
- **Status parsing:**
  - logged in or out;
  - scopes;
  - token source (keyring or environment variable);
  - SSO lines;
  - the `gh api user` login;
  - classification of 401, 403 SSO, a 403/404 restriction and a plain 404.
- **API client:**
  - `getToken` is used per request;
  - a 401 invalidates and retries once, then raises sign-in required;
  - token mode behaves the same as before.
- **MCP config:**
  - gh-cli mode gives `Bearer <cli token>`;
  - token-mode output is unchanged;
  - the replacement config used for a header swap keeps the allow-list and timeout.
- **Session:**
  - the token is fetched at creation;
  - when the token changes between turns, `restartServer` is called with the new header;
  - when it is unchanged, there is no restart;
  - a provider failure gives 401 `github_signin_required` without counting the turn, and the conversation is kept.
- **Re-check, commits, CODEOWNERS:** they use the provider in gh-cli mode, and token-mode tests are unchanged.
- **Status API:**
  - the github block in each mode and state;
  - the token never appears in it.
- **Secrets:** a fake `gho_…` token never appears in log output, error responses, the status API or the rendered page.
- **UI (happy-dom) and axe (jsdom):**
  - the panel line;
  - signed-out and SSO texts;
  - **Check again**;
  - both Atlassian and GitHub needing attention at once;
  - zero axe violations.
- **`github:check` logic:**
  - an all-pass summary;
  - each failure class with its fix text;
  - the environment-variable warning;
  - write-tool detection;
  - exit codes;
  - the token prefix only.

## Acceptance criteria

- [x] `npm run verify` passes; coverage ≥ 90% on all four measures.
      *100% on all four measures at the end of Step 9.*
- [x] On this machine, in gh-cli mode, with `GITHUB_TOKEN` removed from `.env`:
      a question about the RAG repo is answered with GitHub citations, and the
      panel shows "GitHub: TsepoG (GitHub CLI)".
      *L1 (`npm run ask`, G citations to `TsepoG/RAG` pinned to `6479dc0`) and
      L2 (the panel). `GITHUB_TOKEN` was commented out rather than deleted.*
- [x] `gh auth logout` makes the next turn show the GitHub banner; then
      `gh auth login` and **Check again** recover without losing the
      conversation.
      *L2. The pre-turn check asks `gh` afresh (approved in planning), so the
      logout showed on the very next turn; the refused turn was not counted.*
- [x] Re-check of a GitHub source works in gh-cli mode, including one
      "changed" result after the owner pushes a small change to a cited file.
      *L3: `docs/mcp-tools.md` (one word changed on `main`, `41b1366`) was marked
      "Changed since this answer".*
- [x] `npm run github:check` passes on this machine for the configured repos,
      and its output contains only the token prefix.
      *L4, after a fix: the first run failed MCP because the check built the
      Atlassian entry too, which needs an Atlassian sign-in in oauth mode.*
- [x] Token mode behaves exactly as before: tests unchanged (plus the
      regression test), and one token-mode smoke conversation.
      *L5: the owner's token-mode conversation, with a follow-up, worked as
      before. No existing test was changed for token-mode behaviour; two
      export-list tests (`test/github/index.test.js`, `test/mcp/index.test.js`)
      gained the new exports (listed in the PR).*
- [x] A fake token never appears in logs, responses or the page (tests), and
      the owner greps the log and the repo for `gho_` fragments before the PR.
      *L5: `git grep gho_` found only the prefix in docs and fake test tokens;
      across all history, every `gho_` string is a known fake (checked without
      printing them); the gh-cli eval log had none.*
- [x] Smoke eval subset (about 8 cases) in gh-cli mode shows no regression
      against the latest token-mode smoke, within the Phase 7 noise rule.
      *Run `20261031-132731` against `20261028-155909`: passed 6 → 8, every
      measure inside the rule. See `docs/EVAL_LOG.md`, "Smoke in gh-cli mode".*
- [x] README: modes; the read-only caveat for gh-cli; the work-computer steps
      (`gh auth login`, `gh auth refresh` for SSO, `npm run github:check`,
      then switch); and troubleshooting. `.env.example`, `docs/HOW_IT_WORKS.md`
      (auth section), CHANGELOG and ROADMAP are updated too.
      *Step 9 (`.env.example` in Step 2, the ROADMAP row in Step 1;
      HOW_IT_WORKS has a new section 12).*
- [x] Phase 9 acceptance boxes are ticked to reflect reality, and this file plus
      `docs/phase-10-github-cli-decisions.md` are committed in the first commit
      of the branch.
      *Step 1 (`126f73d`).*
- [ ] CI is green; the SonarQube quality gate passes with zero new issues
      (including any hotspot on `execFile`).

## Copilot request budget

About 3–4 for browser checks, 8–10 for the gh-cli smoke subset, and 1–2 for
the token-mode smoke conversation. Roughly 12–16 in total.

## Git rules for this phase

Claude Code never commits or pushes, and never adds `Co-Authored-By:` or
"Generated with Claude Code" lines (CODING_PRINCIPLES §8). After each step it
runs `npm run verify`, stops, summarises, and suggests a Conventional Commit
message. The owner tags the release (`v0.5.0`).

## Manual steps for the repo owner

1. Pull `main`.
2. Save this file as `docs/phases/phase-10.md` and the decisions note as
   `docs/phase-10-github-cli-decisions.md`, both uncommitted.
3. Let Claude Code create `phase-10-github-cli`.
4. Run the live checks when asked: answer in gh-cli mode, log out and in,
   re-check after a small push, `github:check`, the smoke evals, and the log
   and repo grep.
5. After merging: `git tag v0.5.0 && git push origin v0.5.0`.
6. **On the work computer, later:**
   1. pull;
   2. `gh auth login` (plus `gh auth refresh -h github.com` if your
      organisation uses single sign-on);
   3. `npm run github:check`;
   4. switch to `GITHUB_AUTH_MODE=gh-cli` only if every repo passes.
