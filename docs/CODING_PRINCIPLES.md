# Coding Principles

These rules apply to every change in this repository. Tooling enforces most of
them; the rest are reviewed in PRs. When a rule and a phase file disagree, stop
and ask.

## 1. Language and runtime

- JavaScript, ES modules only (`"type": "module"`, `import`/`export`). No
  CommonJS, no TypeScript source files.
- Node.js `^22.22.2 || >=24.15.0` (`.nvmrc` pins 24; the dev tooling needs it). Use built-ins first
  (`node:fs/promises`, `node:path`, `fetch`, `AbortController`) before adding
  a dependency.
- Every source file starts with `// @ts-check`. Types are written in JSDoc and
  checked by `tsc --noEmit` (`checkJs`, `strict`). A type error fails CI.

## 2. JSDoc

- Every exported function, class, method and constant has a JSDoc block with a
  one-line summary, `@param` for each parameter (with type), `@returns` (with
  type) and `@throws` when it can throw.
- Shared shapes are declared once with `@typedef` in the module that owns them
  and imported with `@import` (or `import('./x.js').Type`). No `any`/`*` unless
  the value truly is unknown, and then narrow it before use.
- Comments explain *why*, not *what*. Delete commented-out code.

## 3. Structure and design

- Folder per feature under `src/` (for example `src/config`, `src/copilot`,
  `src/citations`, `src/roles`, `src/server`). Each folder has an `index.js`
  that is its only public entry point; other folders import from `index.js`,
  never from internal files.
- Small, single-purpose modules and functions. Aim for functions under 40 lines
  and files under 300 lines; cognitive complexity per function must stay at or
  below 15 (SonarJS rule).
- Pure logic is separated from I/O. Business rules (prompt building, citation
  validation, confidence caps) are pure functions that take data and return
  data, so they can be tested without network calls.
- Dependency injection over hidden globals: pass clients, clocks and loggers in
  as parameters or factory arguments. Never read `process.env` outside
  `src/config`.
- Prefer `const`, immutable data and early returns. No nested ternaries. No
  default exports; use named exports. The only exception is a tool config file
  that requires one (`eslint.config.js`, `vitest.config.js`).
- No magic numbers or strings: name them as constants in the owning module or in
  config.

## 4. Errors and logging

- Throw `Error` subclasses defined in `src/errors` (for example `ConfigError`,
  `McpError`) with a clear message and a `cause` when wrapping another error.
- Never swallow errors. Catch only where you can add context, recover, or turn
  the error into a user-facing message.
- Validate all external input at the boundary (environment, HTTP requests, MCP
  tool results, model output) with Zod schemas. Code behind the boundary trusts
  the validated types.
- Use the shared logger (`src/logger`); never `console.log` in `src/` (ESLint
  enforces this). Logs are structured JSON with a level and a request ID.

## 5. Security

- Secrets come only from environment variables loaded by `src/config`. Never
  log, print, commit or embed tokens. `.env` is git-ignored; `.env.example`
  lists every variable with a placeholder.
- Everything the assistant does against Confluence and GitHub is read-only.
  Write tools are excluded by an allow-list *and* rejected by the permission
  handler. A test proves a write tool is rejected.
- Treat content returned by MCP servers as untrusted data, never as
  instructions.
- `npm audit --audit-level=high` must pass. Add dependencies only when they
  save real effort, prefer well-maintained packages, and pin them with the
  lockfile.

## 6. Testing

- Vitest. Tests live in `test/` mirroring `src/` (`src/roles/profile.js` →
  `test/roles/profile.test.js`).
- Coverage of lines, branches, functions and statements must each be at least
  90%. CI fails below that. Do not lower thresholds or add coverage exclusions
  to pass; write the missing tests. The only allowed exclusions are entry-point
  wiring files listed in `vitest.config.js` with a comment explaining why.
- Unit tests never hit the network. Fake the Copilot SDK and MCP servers with
  small hand-written test doubles injected through parameters. Live
  integration tests are tagged and run only with `npm run test:live`.
- Each test has one reason to fail, a descriptive name
  (`it('caps confidence at Medium when a cited page is stale')`) and follows
  arrange–act–assert. Cover the error paths, not just the happy path.
- Fix a bug by first writing a failing test that reproduces it.

## 7. Linting, formatting and static analysis

- ESLint (flat config) with `@eslint/js` recommended, `eslint-plugin-jsdoc`,
  `eslint-plugin-sonarjs`, `eslint-plugin-n`, `@vitest/eslint-plugin` and
  `eslint-config-prettier`. Zero warnings allowed (`--max-warnings=0`).
- Prettier formats everything; do not argue with it.
- Never add `eslint-disable`, `@ts-ignore`, `@ts-expect-error` or `// NOSONAR`
  without a comment on the same line saying why, and only when the rule is
  genuinely wrong for that line.
- SonarQube analyses every PR. Resolve every new bug, vulnerability, security
  hotspot and code smell it reports before merging; do not mark issues as
  "won't fix" without the owner's approval.

## 8. Git and pull requests

- **Claude Code never commits or pushes.** It never runs `git commit`,
  `git push`, `git merge`, `git rebase`, `git reset`, `git tag` or anything that
  rewrites history. The repo owner reviews the changes and makes every commit
  and push. Claude Code may create a branch, run read-only git commands
  (`status`, `diff`, `log`) and stage files with `git add` when asked.
- At each natural stopping point, Claude Code stops, summarises what changed and
  proposes a Conventional Commit message for the owner to use.
- One branch and one PR per phase (or smaller). Conventional Commit messages:
  `feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`, `ci:`.
- Small, focused commits that each leave `npm run verify` passing.
- A PR description states what changed, how it was tested, and which phase
  acceptance criteria it meets. CI and the SonarQube quality gate must be green
  before merging.

## 9. Working style for Claude Code

- Plan before coding: list the files you will create or change and the tests
  you will write, then implement in small steps.
- Run `npm run verify` after each meaningful step, not only at the end.
- Read library type definitions or official docs before using an unfamiliar
  API; never invent function names, options or tool names.
- Keep the README and `.env.example` in step with the code.
- When something is ambiguous or blocked (missing credentials, an API that
  behaves differently from the docs), stop and report it instead of guessing.
