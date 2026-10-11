# Role-Aware Knowledge Assistant

A local, role-aware RAG assistant. A user picks a role (Developer, BA, QA, Product Owner,
Project Manager), asks a question, and the app answers from Confluence and GitHub through MCP
servers, using GitHub Copilot as the reasoning layer. Every answer cites the pages and files it
used and states how confident it is.

The project is built in phases (see [docs/ROADMAP.md](docs/ROADMAP.md)). **Phase 1** set up the
quality gates, CI, and the shared config loader, error classes and logger. **Phase 2** connects
GitHub Copilot to the Confluence and GitHub MCP servers, read-only, and answers a question from the
command line. Roles, citations with confidence levels and a UI come in later phases.

## Requirements

- Node.js `^22.22.2 || >=24.15.0`. `.nvmrc` pins Node 24, so `nvm use` picks the right one.
- npm (ships with Node).
- Docker, only if you want the SonarQube MCP server for Claude Code (see below).

## Setup

```bash
npm ci
cp .env.example .env   # then fill in real values
npm start
```

`npm start` loads `.env` if it exists, validates the settings and logs one startup line with the
secrets masked. If a variable is missing or invalid, it prints which one and exits with code 1.
Values already exported in your shell win over `.env`.

## Scripts

| Script                                                     | What it does                                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `npm start`                                                | Run `src/index.js`                                                                                             |
| `npm run lint`                                             | ESLint with JSDoc and SonarJS rules; zero warnings allowed                                                     |
| `npm run lint:fix`                                         | ESLint with auto-fix                                                                                           |
| `npm run format`                                           | Prettier, write                                                                                                |
| `npm run format:check`                                     | Prettier, check only                                                                                           |
| `npm run typecheck`                                        | `tsc --noEmit` over the JSDoc types (`jsconfig.json`)                                                          |
| `npm test`                                                 | Vitest, once                                                                                                   |
| `npm run test:watch`                                       | Vitest in watch mode                                                                                           |
| `npm run test:coverage`                                    | Vitest with coverage; fails below 90% for lines, branches, functions and statements                            |
| `npm run ask -- [--role <id>] [--json] "<question>"`       | Ask a question as a role; prints the answer with its confidence, sources and tools used, or the result as JSON |
| `npm run roles`                                            | List the role profiles in `roles/`                                                                             |
| `npm run models`                                           | List the models your Copilot account can use                                                                   |
| `npm run mcp:tools`                                        | List both MCP servers' tools and write `docs/mcp-tools.md`                                                     |
| `npm run mcp:sample -- <tool> '<json args>' [--as <name>]` | Call one allow-listed tool and save its raw result to `test/fixtures/raw/` (git-ignored)                       |
| `npm run fixtures:sanitise`                                | Turn the raw samples into `test/fixtures/mcp/*.json` with no real names or content                             |
| `npm run test:live`                                        | Live tests against real Copilot, Confluence and GitHub (needs a filled-in `.env`)                              |
| `npm run verify`                                           | lint, format check, typecheck and coverage in sequence; stops at the first failure                             |

Run `npm run verify` before every commit and PR.

## Environment variables

Only `src/config` reads the environment. Everything else receives the validated config object.
Invalid values are reported by variable name, never by value.

| Variable                | Required | Default       | Rule                                                                      |
| ----------------------- | -------- | ------------- | ------------------------------------------------------------------------- |
| `NODE_ENV`              | no       | `development` | `development`, `test` or `production`                                     |
| `LOG_LEVEL`             | no       | `info`        | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`              |
| `PORT`                  | no       | `3000`        | Integer from 1 to 65535                                                   |
| `GITHUB_TOKEN`          | yes      |               | Fine-grained PAT with read-only Contents and Metadata on the listed repos |
| `GITHUB_REPOS`          | yes      |               | Comma-separated `owner/repo` list, at least one                           |
| `ATLASSIAN_SITE_URL`    | yes      |               | `https://<site>.atlassian.net`; a trailing slash is removed               |
| `ATLASSIAN_CLOUD_ID`    | no       |               | Site cloudId (UUID); when set it is used on every Confluence call         |
| `ATLASSIAN_AUTH_MODE`   | no       | `basic`       | `basic` (personal API token) or `bearer` (service-account API key)        |
| `ATLASSIAN_EMAIL`       | basic    |               | Email of the account that owns the API token; not used in `bearer` mode   |
| `ATLASSIAN_API_TOKEN`   | yes      |               | Atlassian API token or service-account API key (see Atlassian access)     |
| `CONFLUENCE_SPACE_KEYS` | yes      |               | Comma-separated space keys, at least one                                  |
| `COPILOT_MODEL`         | no       | none          | Non-empty model name when set; unset uses your account's default          |
| `COPILOT_GITHUB_TOKEN`  | no       | none          | Credential for Copilot only; unset uses your logged-in user (see below)   |
| `ASK_TIMEOUT_MS`        | no       | `120000`      | Integer from 5000 to 600000; a slower question is aborted (exit code 2)   |
| `MAX_TOOL_CALLS`        | no       | `12`          | Integer from 1 to 50; further tool calls in one question are denied       |
| `MCP_TIMEOUT_MS`        | no       | `30000`       | Integer from 1000 to 120000; limit for one call to an MCP server          |

### Atlassian access

Which mode to use depends on the kind of credential:

| Credential              | `ATLASSIAN_AUTH_MODE` | `ATLASSIAN_EMAIL` | Header sent                 |
| ----------------------- | --------------------- | ----------------- | --------------------------- |
| Personal API token      | `basic` (default)     | required          | `Basic base64(email:token)` |
| Service-account API key | `bearer`              | not used          | `Bearer <key>`              |

- A service account needs Confluence product access and **view** permission on every space listed
  in `CONFLUENCE_SPACE_KEYS`, or its searches return nothing.
- The organization setting "Allow API token authentication" must be on for the Rovo MCP server.
- The token needs the scopes the Rovo MCP server asks for: `read:me` and `read:account` (to find
  the site), `search:confluence:agent-interface` and `read:confluence:agent-interface`.
- When a tool call fails, the first 300 characters of the error are logged with secrets masked, so
  a scope or permission problem shows up in the log.

### Copilot login

Copilot is the reasoning layer and needs its own credential, separate from the read-only tokens
above. Any one of these works:

- `gh auth login`, if you already use the GitHub CLI (the runtime falls back to `gh auth token`);
- `copilot login`, which stores the login in your system keychain;
- `COPILOT_GITHUB_TOKEN` in `.env`: a fine-grained personal access token with the "Copilot
  Requests" account permission. Classic `ghp_` tokens are not supported by Copilot.

**Never reuse `GITHUB_TOKEN` for Copilot.** The app removes it, `GH_TOKEN` and every other app
setting from the Copilot runtime's environment, so the MCP token cannot become the Copilot
credential by accident. A login stored in plaintext in `~/.copilot/config.json` is not found,
because the runtime runs against a throwaway data directory; use one of the three options above.

`npm run models` is a quick check that you are signed in. Some plans, such as Copilot Free, report
no models; leave `COPILOT_MODEL` unset to use the default.

### Asking a question

```bash
npm run ask -- "How does the checkout flow work in the shop-api repo?"
npm run ask -- --role product_owner "What does the refund feature do?"
```

`--role` picks who the answer is written for (default `developer`). The command prints a progress
line to stderr, then, once the answer has been checked: a banner with the confidence level (for
example `[medium] Mostly confirmed…`), the answer, where the documentation and code disagree, **What
I couldn't confirm**, a numbered **Sources** list, **Also consulted**, **Who might know**, a "Tools
used" list (server, tool, a short argument summary and duration; never secrets or page content)
and the role, model and time taken. See [Honesty and confidence](#honesty-and-confidence) for what
each part means. Logs go to stderr as JSON.

`--json` prints the whole result as JSON instead (status, confidence, `confidenceReason`,
`capsApplied`, sources and the rest), which is what the later web UI and the evaluation work use.

Exit codes: `0` for every status, because "not found" and "out of scope" are correct outcomes, not
errors; `1` for a missing question, an unknown role, bad config, no Copilot login or a Copilot
error (one line on stderr); `2` when the question exceeds `ASK_TIMEOUT_MS`.

### Roles

`npm run roles` lists the profiles in [roles/](roles). There are five: `developer`,
`business_analyst`, `qa`, `product_owner` and `project_manager`. Each is a YAML file checked at
startup (a bad file names the file and field). A profile sets the audience, a depth from 1 to 3,
the vocabulary to use and the words to avoid, which source to search first, the shape of the answer
and examples. All roles are grounded the same way: the part of the system message about grounding,
safety and citations is identical for every role, and only the role block changes how the answer
is written. Depth 1 roles (product owner, project manager) get plain business language, with no
code or file paths in the answer or the Sources list.

A role can also reword the banners the application shows when it is unsure, under `phrases` in its
YAML file. Any of `high`, `medium`, `low`, `notFound` and `outOfScope` can be set; one left out uses
the default. Each is a single line of at most 200 characters, and an unknown name is refused.
Raise the role's `version` by one when you change it.

```yaml
phrases:
  low: "I'm not sure. Here's what I found and what's still unclear."
  notFound: "I couldn't find anything about this in our documentation or the product."
```

Wording changes how uncertainty is said, never whether it is said: the banner, level and lists are
added by the application, not written by the model.

### How citations work

- Every page or file the model reads is given a key: `C1`, `C2`… for Confluence pages, `G1`, `G2`…
  for GitHub files, folders, commits and releases. The tool result is wrapped in a
  `<source key="…">` tag, and any `<source` text inside the content is defused so content cannot
  claim a key.
- The model cites with `[C1]` or `[C1][G2]` after a sentence. After the answer, the app checks
  every key. A key that was never given out is removed from the text and reported, not shown as a
  citation.
- The **Sources** list is built by the app, never by the model. A Confluence entry links to the
  page and records its version (and notes a page not updated in over a year). A GitHub entry is
  pinned to a 40-character commit SHA, so the link keeps showing what the model saw. The commit
  comes from the result itself or from the repository's head commit; if neither is found the link
  is to the default branch and says it is not pinned.
- Search hits and lists (`searchConfluence`, `search_code`, `list_commits`, `list_releases`) are
  not sources: they appear under **Also consulted** and cannot be cited.
- A folder listing is a source for which files and folders exist, not for what is inside a file.
  The check that a claim about a file's contents was backed by reading that file is not done yet
  (planned for Phase 4).
- Confluence content that is not in `CONFLUENCE_SPACE_KEYS`, or whose space cannot be determined,
  is replaced by a notice before the model sees it. If the check itself fails, the content is
  replaced too.
- Each question gets two `search_code` calls. An empty code search tells the model to browse
  folders instead.
- Large results: the Copilot runtime's own "large output" handling is turned off, because it hides
  a long page behind a file pointer the model cannot read. Instead each source is cut at 24,000
  characters and the model is told when that happens.
- Set `ATLASSIAN_CLOUD_ID` to save the model two calls: it is then used for every Confluence call.

### Honesty and confidence

Every answer says how sure it is and why. The model reports a status and a level at the end of its
reply, in a fenced block tagged `answer-meta`; the application checks the block, removes it (it is
never shown) and has the final say, through caps the model cannot override. A reply with no valid
block counts as low confidence ("The assistant did not report its confidence"). Text after the
block is kept and a warning is logged.

**Statuses.** Every result has one:

| Status         | Meaning                              | What is shown                                                |
| -------------- | ------------------------------------ | ------------------------------------------------------------ |
| `answered`     | The sources answer the question      | Banner with level, answer, sources, and the lists below      |
| `not_found`    | Nothing in the sources answers it    | The role's not-found text, the closest pages, who might know |
| `clarify`      | The question fits two or more things | One short question, nothing else                             |
| `out_of_scope` | The sources can never answer it      | The role's out-of-scope text, no sources                     |

The model's own text is discarded for `not_found` and `out_of_scope`. An `answered` reply with no
valid citation at all becomes `not_found`, whatever the model said.

**Confidence levels and caps.** The model proposes `high`, `medium` or `low` with a reason. The
application can only lower it, and each rule that holds adds a sentence to `confidenceReason` and an
entry to `capsApplied` in the JSON:

| Code                | When                                                      | Limit     |
| ------------------- | --------------------------------------------------------- | --------- |
| `no-citations`      | No citation in the answer is a real, fetched source       | not found |
| `invalid-keys`      | The model used a citation key it was never given          | medium    |
| `uncited-sentences` | A sentence makes a claim without a citation (a heuristic) | medium    |
| `stale-page`        | A cited Confluence page was last updated over a year ago  | medium    |
| `inferred`          | A citation carries an asterisk (see below)                | medium    |
| `folder-only`       | A sentence rests only on a folder listing                 | medium    |
| `gaps`              | The model listed things it could not confirm              | medium    |
| `conflicts`         | The documentation and the code disagree                   | low       |
| `no-meta`           | The model's report is missing or invalid                  | low       |

**Stated and inferred.** A sentence that repeats a source gets a normal citation, `[C1]`. A sentence
that is the model's interpretation, usually of code, starts "Based on the code, it looks like…" and
marks its citation with an asterisk, `[G1*]`. The asterisk stays in the answer, the source gets
`inferred: true` when every citation of it has one, and the sources list says "my reading of it". A
folder listing shows what exists, not what the files do, so a sentence supported only by one gets
the asterisk added by the application. This closes the gap where a claim about a file's contents
could be cited to a directory listing.

**Gaps and conflicts.** At medium and low confidence the answer ends with **What I couldn't
confirm**. When the documentation and the code disagree, the application writes both sides itself
("The documentation says X [C1]; the code does Y [G2]. The code reflects current behaviour."),
so the model cannot soften or settle it. The keys in a conflict are checked like any other.

**Who might know.** For `not_found` and for medium and low answers, the application suggests, with
no extra model call: the owners of the files and folders the model read, from the repository's
`CODEOWNERS` (`.github/CODEOWNERS`, `CODEOWNERS` or `docs/CODEOWNERS`, read once per repository,
allowed repositories only), and whoever last saved a Confluence page when the page result names
them. The Atlassian server used so far returns only an account id, so page editors rarely appear.
Names are never logged.

**Style check and one rewrite.** After the answer is checked, `checkStyle` compares it with the
role: depth 1 allows no code blocks, inline code, file paths or banned words; depth 2 no code
blocks or banned words; depth 3 only banned words. If it fails, the model is asked once, in the
same session, to rewrite the answer, with every tool locked. The rewrite is used only if it still
cites exactly the same sources, keeps every asterisk and is still an answer, and it can never make
the answer more confident. Otherwise the first answer is kept and the result says why
(`rewriteRejectedReason`: `citations`, `markers`, `status`, `timeout` or `error`). `ask` prints a
short note on stderr when a rewrite happened or was refused.

**Known limits.**

- The status is the model's call. In live runs the model sometimes answers a question the sources
  cannot (such as "What will the release date be next year?") instead of reporting `out_of_scope`;
  the caps then limit it to medium and say why, but they cannot turn it into out of scope.
- The uncited-sentence check is strict by design. A sentence whose citation sits on the next
  sentence counts as uncited.
- Confidence is not yet calibrated; Phase 6 measures it.

### Test fixtures

The extractors that read MCP results are built on real tool results with the content removed.
`npm run mcp:sample` calls one allow-listed tool (through the same scope check as the assistant) and
saves the raw result under `test/fixtures/raw/`, which is git-ignored. `npm run fixtures:sanitise`
rewrites those into `test/fixtures/mcp/*.json`: names, sites, spaces and URLs are mapped to
placeholders, text and code are replaced, and the command fails, naming the file and the kind of
leak, if any real name, email or account id is left. Review the sanitised files before committing
them. `search_code.synthetic.json` is hand-written, because the real search returned no hits for
the repository used; it is marked as synthetic.

### How read-only is enforced

Everything the assistant does against Confluence and GitHub is read-only, by several independent
layers; each one alone would stop a write.

1. **Allow-list.** [src/mcp/allowlist.js](src/mcp/allowlist.js) names the only tools Copilot may
   use: Confluence `searchConfluence`, `getConfluenceContent` and
   `getAccessibleAtlassianResources`, and GitHub `search_code`, `get_file_contents`,
   `get_commit`, `list_commits`, `list_releases` and `get_latest_release`. The list is sent to
   each server and as the session's exact tool list; every built-in tool (shell, files, URLs) is
   excluded. The GitHub server is also asked for read-only mode and the `repos` toolset only.
2. **Scope hooks.** Before each call a hook denies it unless the repository is in `GITHUB_REPOS`
   (and `search_code` has a `repo:` qualifier for one), and the Confluence query or page URL stays
   within `CONFLUENCE_SPACE_KEYS` and the configured site. It also enforces `MAX_TOOL_CALLS`. Hooks
   fail closed: a hook that throws, or cannot check a call, denies it.
3. **Permission handler.** Deny by default: it approves only an MCP call to an allow-listed tool and
   rejects every other kind of request (shell, write, read, url, memory and the rest).
4. **Sandbox.** The Copilot runtime starts in an empty temporary directory with a filtered
   environment, removed afterwards.

Tool results are treated as data, never as instructions. Tests cover each layer; `npm run test:live`
checks the allow-list against the real servers and that a request to change a repository makes no
write call.

**Jira:** the Atlassian allow-list is Confluence-only, with no Jira tools even read-only. Rovo's
generic `search` tool is left out on purpose because it can surface Jira results and cannot be
limited to a space.

### Pinned Copilot SDK

`@github/copilot-sdk` is pinned to exactly **1.0.19** (no `^` range). It releases almost daily and
the safety checks above depend on its behaviour (tool filtering, hooks, permission requests). To
upgrade, change the version on purpose, re-read its type definitions and run `npm run verify` and
`npm run test:live`.

`.env` is git-ignored. `.env.example` lists every variable with a placeholder and says where to
create each token.

## Project layout

```
src/
  answer/    askQuestion: runs one question through Copilot; validated result, report, argument parsing
  citations/ source registry, wrapping, labels, citation checking, extractors for each tool result
  cli/       ask, roles, models, mcp:tools, mcp:sample and fixtures:sanitise commands (wiring only)
  config/    validated config loader (loadConfig, redactConfig, buildRuntimeEnv)
  copilot/   Copilot client, session config and system message (shared base plus role block)
  errors/    AppError and its subclasses
  fixtures/  the fixture sanitiser and its leak check
  github/    read-only GitHub REST client; head-commit lookup to pin links; CODEOWNERS reader
  honesty/   answer-meta parsing, confidence caps, uncited-sentence check, who to ask, final rendering
  logger/    pino logger factory with secret redaction
  mcp/       server config, tool allow-list, scope and post-tool hooks, permission handler, discovery
  roles/     role schema and loader (profiles are in the top-level roles/ folder)
  style/     checks an answer against what its role allows
  index.js   entry point: loads .env, loads config, logs a startup line
test/        mirrors src/; test/helpers holds shared test utilities; test/live runs on demand
docs/        roadmap, system design, coding principles and one file per phase
```

Each folder under `src/` has an `index.js` that is its only public entry point. The rules for
writing code here are in [docs/CODING_PRINCIPLES.md](docs/CODING_PRINCIPLES.md).

## Quality gates

- **Types:** every source file starts with `// @ts-check`; types are JSDoc, checked by `tsc`.
  TypeScript is on 6.x because the lint plugins depend on `@typescript-eslint`, whose peer range
  is `typescript <6.1.0`.
- **Coverage:** Vitest enforces 90% for lines, branches, functions and statements. Files in `src/`
  that no test imports count as uncovered. `src/index.js` and `src/cli/` are the only exclusions
  (entry-point wiring). Live tests (`test/live/`) run only with `npm run test:live`, never in CI.
- **Git hooks (Husky):** `pre-commit` runs ESLint `--fix` and Prettier on staged files;
  `pre-push` runs `npm run typecheck` and `npm test`. They install automatically with
  `npm ci`.
- **Dependencies:** `npm audit --audit-level=high` must pass. Dependabot opens weekly grouped
  updates for npm and GitHub Actions.

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests to `main` and on pushes to `main`. It has five
jobs, and their names are the status checks to require:

| Check       | What it runs                                                                     |
| ----------- | -------------------------------------------------------------------------------- |
| `lint`      | `npm run lint` and `npm run format:check`                                        |
| `typecheck` | `npm run typecheck`                                                              |
| `test`      | `npm run test:coverage`; uploads `coverage/` and adds a table to the job summary |
| `audit`     | `npm audit --audit-level=high`                                                   |
| `sonarqube` | SonarQube Cloud scan using the coverage from `test`; waits for the quality gate  |

Every third-party action is pinned to a full commit SHA with a version comment.

### Required status checks

In the repository settings, protect `main`:

1. Require a pull request before merging.
2. Require the status checks `lint`, `typecheck`, `test`, `audit` and `sonarqube` to pass.
3. Require branches to be up to date before merging.

The `sonarqube` job is skipped for pull requests from forks, because they cannot read secrets.

## SonarQube Cloud

1. In SonarQube Cloud, import this GitHub repository.
2. Switch the project's analysis method to **GitHub Actions** and turn **Automatic Analysis
   off**. CI analysis fails while Automatic Analysis is on.
3. Create a SonarQube Cloud token and add it as the repository secret `SONAR_TOKEN`.
4. Add the repository variables `SONAR_PROJECT_KEY` and `SONAR_ORGANIZATION`.

The project key and organization are deliberately not in `sonar-project.properties`; CI passes
them from those variables.

**On the 90% coverage rule:** the Free plan of SonarQube Cloud uses the built-in "Sonar way"
quality gate (80% coverage on new code) and does not allow custom gates. The 90% requirement is
therefore enforced by the Vitest thresholds in CI, not by SonarQube.

## SonarQube MCP server (for Claude Code)

`.mcp.json` registers the SonarQube MCP server so Claude Code can read Sonar issues. It runs the
`sonarsource/sonarqube-mcp` Docker image, so you need:

- Docker installed and running.
- `SONARQUBE_TOKEN` (a SonarQube Cloud token) and `SONARQUBE_ORG` exported in your shell. The file
  holds no secret values.

## Working with Claude Code

[CLAUDE.md](CLAUDE.md) tells Claude Code how to work in this repo. `.claude/settings.json` lets it
run the npm, lint, test and read-only git and `gh` commands without prompting, and denies reading
`.env`. It also denies every git command that commits or rewrites history: you make every commit
and push yourself.
