# Role-Aware Knowledge Assistant

A local, role-aware RAG assistant. A user picks a role (Developer, BA, QA, Product Owner,
Project Manager), asks a question, and the app answers from Confluence and GitHub through MCP
servers, using GitHub Copilot as the reasoning layer. Every answer cites the pages and files it
used and states how confident it is.

The project is built in phases (see [docs/ROADMAP.md](docs/ROADMAP.md)). **Phase 1 is the
foundation:** the quality gates, CI, and the shared config loader, error classes and logger. There
is no assistant yet; that starts in Phase 2.

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

| Script                  | What it does                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `npm start`             | Run `src/index.js`                                                                  |
| `npm run lint`          | ESLint with JSDoc and SonarJS rules; zero warnings allowed                          |
| `npm run lint:fix`      | ESLint with auto-fix                                                                |
| `npm run format`        | Prettier, write                                                                     |
| `npm run format:check`  | Prettier, check only                                                                |
| `npm run typecheck`     | `tsc --noEmit` over the JSDoc types (`jsconfig.json`)                               |
| `npm test`              | Vitest, once                                                                        |
| `npm run test:watch`    | Vitest in watch mode                                                                |
| `npm run test:coverage` | Vitest with coverage; fails below 90% for lines, branches, functions and statements |
| `npm run verify`        | lint, format check, typecheck and coverage in sequence; stops at the first failure  |

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
| `ATLASSIAN_EMAIL`       | yes      |               | Email of the account that owns the API token                              |
| `ATLASSIAN_API_TOKEN`   | yes      |               | Atlassian API token with Confluence read scopes                           |
| `CONFLUENCE_SPACE_KEYS` | yes      |               | Comma-separated space keys, at least one                                  |
| `COPILOT_MODEL`         | no       | none          | Non-empty model name when set; Phase 2 chooses a default                  |

`.env` is git-ignored. `.env.example` lists every variable with a placeholder and says where to
create each token.

## Project layout

```
src/
  config/    validated config loader (loadConfig, redactConfig)
  errors/    AppError and ConfigError
  logger/    pino logger factory with secret redaction
  index.js   entry point: loads .env, loads config, logs a startup line
test/        mirrors src/; test/helpers holds shared test utilities
docs/        roadmap, system design, coding principles and one file per phase
```

Each folder under `src/` has an `index.js` that is its only public entry point. The rules for
writing code here are in [docs/CODING_PRINCIPLES.md](docs/CODING_PRINCIPLES.md).

## Quality gates

- **Types:** every source file starts with `// @ts-check`; types are JSDoc, checked by `tsc`.
  TypeScript is on 6.x because the lint plugins depend on `@typescript-eslint`, whose peer range
  is `typescript <6.1.0`.
- **Coverage:** Vitest enforces 90% for lines, branches, functions and statements. Files in `src/`
  that no test imports count as uncovered. `src/index.js` is the only exclusion (entry-point
  wiring).
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
