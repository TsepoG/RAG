# Phase 1 — Foundation and Quality Gates

## Goal

Set up the project skeleton and every quality gate before any product code is
written: ESLint, Prettier, JSDoc type checking, Vitest with a 90% coverage
gate, SonarQube analysis, and GitHub Actions that run all of it on every pull
request. The only product code in this phase is the shared foundation that every
later phase uses: a validated config loader, error classes and a logger.

When this phase is done, a PR that breaks lint, types, tests, coverage or the
SonarQube quality gate cannot be merged green.

## Out of scope

Anything that talks to Copilot, Confluence or GitHub content (Phase 2+), role
profiles, citations, the web UI. Do not install `@github/copilot-sdk` yet.

## Inputs to read first

- `CLAUDE.md` and `docs/CODING_PRINCIPLES.md` (rules for all code).
- `docs/ROADMAP.md` (where this phase sits).
- `docs/SYSTEM_DESIGN.md`, sections "Components" and "Security, permissions and
  compliance", only to understand which settings the config loader must hold.

## Decisions already made

| Area | Decision |
| --- | --- |
| Runtime | Node.js 24 LTS in `.nvmrc`; `"engines": { "node": ">=22.12" }` (the Copilot SDK needs ^20.19 or >=22.12) |
| Modules | ESM only, `"type": "module"`, named exports |
| Types | JSDoc + `// @ts-check`, checked with `tsc --noEmit` (`allowJs`, `checkJs`, `strict`, `module`/`moduleResolution` `nodenext`) |
| Lint | ESLint 9+ flat config: `@eslint/js` recommended, `eslint-plugin-jsdoc` (flat recommended-error, plus `require-jsdoc` for exported functions/classes), `eslint-plugin-sonarjs` recommended, `eslint-plugin-n` recommended-module, `@vitest/eslint-plugin` for `test/`, `eslint-config-prettier` last; `no-console: error` in `src/` |
| Format | Prettier, single quotes, semicolons, 100 print width |
| Tests | Vitest with `@vitest/coverage-v8`; reporters `text`, `lcov` (for SonarQube) and `html`; thresholds 90 for lines, branches, functions, statements; `coverage.include: ['src/**/*.js']` so untested files count |
| Validation | Zod for environment and all later boundary validation |
| Logging | `pino` with JSON output; a `createLogger` factory; secrets redacted via pino `redact` |
| Git hooks | Husky + lint-staged: pre-commit runs ESLint `--fix` and Prettier on staged files; pre-push runs `npm run typecheck` and `npm test` |
| Static analysis | SonarQube Cloud via `SonarSource/sonarqube-scan-action` in CI; project key and organization supplied from GitHub repository variables |
| CI | GitHub Actions on `pull_request` to `main` and `push` to `main` |
| Claude Code tooling | Project `.mcp.json` registering the SonarQube MCP server so Claude Code can read Sonar issues |

Install the latest stable versions of every package and read each tool's current
docs for config syntax (Vitest and ESLint config options change between majors).
Do not pin to versions from memory.

## Repository layout to create

```
.
├── .claude/settings.json        # Claude Code permissions for npm/git/gh commands
├── .editorconfig
├── .env.example
├── .github/
│   ├── dependabot.yml           # weekly npm + github-actions updates
│   ├── pull_request_template.md
│   └── workflows/ci.yml
├── .gitignore                   # node_modules, coverage, .env, .scannerwork, reports
├── .husky/                      # pre-commit, pre-push
├── .mcp.json                    # sonarqube MCP server (env vars only, no secrets)
├── .nvmrc
├── .prettierrc.json / .prettierignore   # ignore coverage/, docs/ and CLAUDE.md (context files stay as written)
├── CLAUDE.md                    # already present
├── README.md
├── docs/                        # already present
├── eslint.config.js
├── jsconfig.json                # or tsconfig.json; used by `tsc --noEmit`
├── package.json
├── sonar-project.properties
├── src/
│   ├── config/  (index.js, schema.js)
│   ├── errors/  (index.js)
│   ├── logger/  (index.js)
│   └── index.js                 # entry point: loads config, logs a startup line
├── test/
│   ├── config/  errors/  logger/
│   └── helpers/                 # shared test utilities, if any
└── vitest.config.js
```

## package.json scripts (exact names, used by CI and CLAUDE.md)

| Script | Command (adapt flags to current tool versions) |
| --- | --- |
| `start` | `node src/index.js` |
| `lint` | `eslint . --max-warnings=0` |
| `lint:fix` | `eslint . --fix` |
| `format` | `prettier . --write` |
| `format:check` | `prettier . --check` |
| `typecheck` | `tsc --noEmit -p jsconfig.json` |
| `test` | `vitest run` |
| `test:watch` | `vitest` |
| `test:coverage` | `vitest run --coverage` |
| `verify` | lint, format:check, typecheck, test:coverage in sequence; fails on the first error |
| `prepare` | `husky` |

## Product code in this phase

### `src/config`

- `loadConfig(env = process.env)` returns a frozen, validated config object or
  throws `ConfigError` listing every invalid or missing variable by name (never
  printing values).
- Schema (Zod) for the whole MVP, so later phases only read from it:

| Variable | Type / rule | Required |
| --- | --- | --- |
| `NODE_ENV` | `development` \| `test` \| `production`, default `development` | no |
| `LOG_LEVEL` | pino level, default `info` | no |
| `PORT` | integer 1–65535, default `3000` | no |
| `GITHUB_TOKEN` | non-empty string (read-only fine-grained PAT) | yes |
| `GITHUB_REPOS` | comma-separated `owner/repo` list, at least one, each validated | yes |
| `ATLASSIAN_SITE_URL` | `https://<site>.atlassian.net` URL | yes |
| `ATLASSIAN_EMAIL` | email | yes |
| `ATLASSIAN_API_TOKEN` | non-empty string | yes |
| `CONFLUENCE_SPACE_KEYS` | comma-separated list of space keys, at least one | yes |
| `COPILOT_MODEL` | optional non-empty string; no default yet (Phase 2 sets one) | no |

- Lists are parsed into arrays; URLs are normalised (no trailing slash).
- A `redactConfig(config)` helper returns a copy safe to log (tokens replaced
  with `"***"`).
- Only `src/config` may read `process.env` (add an ESLint `no-restricted-properties`
  rule for `process.env` outside `src/config` and `src/index.js`).

### `src/errors`

- `AppError` base class (extends `Error`, sets `name`, accepts `{ cause }`),
  plus `ConfigError` (holds the list of field issues). Later phases add more.

### `src/logger`

- `createLogger({ level, name })` returning a pino logger with `redact` paths
  for any key named `token`, `apiToken`, `authorization`, `password`.

### `src/index.js`

- Loads `.env` with Node's built-in `process.loadEnvFile()` when the file
  exists, calls `loadConfig`, logs one startup line with `redactConfig`, and
  exits with code 1 and a readable message on `ConfigError`. This is wiring
  only; it is the one file allowed in the coverage exclude list, with a comment
  saying why.

### `.env.example`

Every variable above, with placeholder values and a one-line comment each
(including where to create the token and the minimum scopes: GitHub
fine-grained PAT with read-only Contents and Metadata on the listed repos;
Atlassian API token with read scopes for Confluence).

## SonarQube

- `sonar-project.properties`:
  - `sonar.sources=src`, `sonar.tests=test`
  - `sonar.javascript.lcov.reportPaths=coverage/lcov.info`
  - `sonar.sourceEncoding=UTF-8`
  - `sonar.exclusions` for `coverage/**`, `node_modules/**`
  - No project key or organization in the file; CI passes them as
    `-Dsonar.projectKey=${{ vars.SONAR_PROJECT_KEY }}` and
    `-Dsonar.organization=${{ vars.SONAR_ORGANIZATION }}`.
- The scan step waits for the quality gate (`-Dsonar.qualitygate.wait=true`) so
  a failed gate fails the PR check.
- Note for the README: SonarQube Cloud's Free plan uses the built-in "Sonar
  way" gate (80% coverage on new code) and does not allow custom gates, so the
  90% rule is enforced by Vitest thresholds in CI, not by SonarQube.
- `.mcp.json` registers the SonarQube MCP server for Claude Code using the
  Docker image `sonarsource/sonarqube-mcp`, passing `SONARQUBE_TOKEN` and
  `SONARQUBE_ORG` from the developer's shell environment via `${VAR}`
  expansion. No secret values in the file. Document in the README that this
  needs Docker and the two variables exported. Check the server's README for
  the current config shape before writing it.

## GitHub Actions — `.github/workflows/ci.yml`

- Triggers: `pull_request` (opened, synchronize, reopened) targeting `main`, and
  `push` to `main`.
- `permissions: contents: read` at workflow level; add only what a job needs.
- `concurrency` group per ref with `cancel-in-progress: true`.
- Every third-party action pinned to a full commit SHA with a version comment
  (look up the latest release of each with `gh api` before pinning):
  `actions/checkout`, `actions/setup-node` (with `node-version-file: .nvmrc`
  and `cache: npm`), `actions/upload-artifact`, `actions/download-artifact`,
  `SonarSource/sonarqube-scan-action`.
- Jobs (install with `npm ci` in each):

| Job | Steps | Needs |
| --- | --- | --- |
| `lint` | `npm run lint`, `npm run format:check` | — |
| `typecheck` | `npm run typecheck` | — |
| `test` | `npm run test:coverage`; upload `coverage/` as an artifact; add the coverage summary to `$GITHUB_STEP_SUMMARY` | — |
| `audit` | `npm audit --audit-level=high` | — |
| `sonarqube` | checkout with `fetch-depth: 0`; download the coverage artifact; run the scan action with `SONAR_TOKEN` from secrets and the two `-D` args above plus quality-gate wait; skip when the PR comes from a fork (secrets are unavailable) | `test` |

- Job names must be stable because they become required status checks.
- `.github/dependabot.yml`: weekly updates for `npm` and `github-actions`,
  grouped minor/patch updates.
- `.github/pull_request_template.md`: summary, phase and acceptance criteria
  covered, how it was tested, checklist (verify passes, JSDoc added, tests
  added, no new Sonar issues).

## Claude Code project settings — `.claude/settings.json`

Allow without prompting: `npm run *`, `npm test`, `npm ci`, `npm install`,
`npx eslint`, `npx prettier`, `npx vitest`, `npx tsc`, `git status`, `git diff`,
`git log`, `git add`, `git checkout -b`, `gh pr create`, `gh pr view`,
`gh pr checks`, `gh api`.

Deny: reading `.env`, and every git command that commits or changes history:
`git commit`, `git push`, `git merge`, `git rebase`, `git reset`, `git tag`,
`git cherry-pick`, `git revert`, `git stash`. The repo owner makes every commit
and push (see `docs/CODING_PRINCIPLES.md` §8). Check the current settings schema
in the Claude Code docs before writing it.

## Tests required in this phase

- `config`: valid env returns the parsed config; each required variable missing
  is reported by name; invalid `GITHUB_REPOS` entry, invalid URL, non-numeric
  `PORT` and empty list each fail with a clear message; defaults applied;
  returned object is frozen; `redactConfig` hides every secret and does not
  mutate its input; error message never contains a secret value.
- `errors`: names, `cause` propagation, `ConfigError` issue list.
- `logger`: level respected; secret keys redacted in output (capture output via
  a destination stream).

## Acceptance criteria

- [ ] `npm ci && npm run verify` passes on a clean clone.
- [ ] Coverage is at least 90% for lines, branches, functions and statements,
      and lowering a test makes `npm run test:coverage` fail.
- [ ] Every exported symbol in `src/` has JSDoc; removing one makes `npm run lint`
      fail.
- [ ] A deliberate type error in a JSDoc-typed function makes `npm run typecheck`
      fail.
- [ ] `npm start` with a valid `.env` logs one redacted startup line; with a
      missing variable it exits 1 and names the variable.
- [ ] `ci.yml` runs the five jobs on a PR; all pass on this phase's PR.
- [ ] The `sonarqube` job reports to SonarQube Cloud and the quality gate
      passes with zero new bugs, vulnerabilities, hotspots and code smells.
- [ ] README explains setup, scripts, environment variables, SonarQube Cloud
      setup, the SonarQube MCP server, and the required status checks.
- [ ] No secrets in the repo (`.env` git-ignored, `.env.example` placeholders only).

## Manual steps for the repo owner (Claude Code lists these in the PR, does not do them)

1. In SonarQube Cloud, import the GitHub repository, then switch the project's
   analysis method to "GitHub Actions" (turn Automatic Analysis off; CI
   analysis fails while it is on).
2. Create a SonarQube Cloud token. Add it as the repository secret
   `SONAR_TOKEN`. Add repository variables `SONAR_PROJECT_KEY` and
   `SONAR_ORGANIZATION`.
3. Protect `main`: require a PR, require the checks `lint`, `typecheck`,
   `test`, `audit` and `sonarqube` to pass, and require branches to be up to
   date.
4. For the SonarQube MCP server in Claude Code: install Docker and export
   `SONARQUBE_TOKEN` and `SONARQUBE_ORG` in your shell.
5. Copy `.env.example` to `.env` and fill in real values.

## Hand-off to Phase 2

Phase 2 adds `src/copilot` and `src/mcp` on top of this foundation and reads all
settings through `loadConfig`. Leave no `TODO` or `FIXME` comments in the code:
SonarQube reports them as code smells. Note open items in the PR description instead.
