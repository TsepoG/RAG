# Role-Aware Knowledge Assistant

A local, role-aware RAG assistant. A user picks a role (Developer, BA, QA,
Product Owner, Project Manager), asks a question, and the app answers from
Confluence and GitHub through MCP servers, using GitHub Copilot (via the
`@github/copilot-sdk`) as the reasoning layer. Every answer cites the
Confluence pages and code files it used and states how confident it is.

## How to work in this repo

- The work is split into phases. Read `docs/ROADMAP.md` for the order, and the
  active phase file in `docs/phases/` (the highest-numbered one) for scope,
  decisions and acceptance criteria. Do not build anything from a later phase.
- `docs/SYSTEM_DESIGN.md` is the full production design. Read the sections a
  phase file points you to; the MVP deliberately leaves out SSO, the MCP
  Gateway service, Postgres and deployment.
- Follow `docs/CODING_PRINCIPLES.md` for every change. It is imported below.
- When a library's behaviour is uncertain (especially `@github/copilot-sdk`
  and the MCP servers), read its type definitions in `node_modules` or its
  official docs before writing code. Never guess an API shape.
- If a phase file and the principles conflict, stop and ask.
- Never commit or push. Never run `git commit`, `git push`, `git merge`,
  `git rebase`, `git reset` or `git tag`. The repo owner makes every commit.
  When a piece of work is ready, stop, summarise the changes and suggest a
  Conventional Commit message.
- Never add `Co-Authored-By:` trailers, "Generated with Claude Code" lines or
  any other AI attribution to suggested commit messages, PR titles or PR
  descriptions.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run lint` | ESLint (includes JSDoc and SonarJS rules) |
| `npm run format:check` | Prettier check |
| `npm run typecheck` | `tsc --noEmit` type-checking the JSDoc types |
| `npm test` | Vitest once |
| `npm run test:coverage` | Vitest with coverage; fails under 90% |
| `npm run verify` | All of the above; must pass before you hand work back for committing |

## Definition of done for any change

1. `npm run verify` passes locally.
2. New or changed code has JSDoc and tests; coverage stays at or above 90%.
3. No new SonarQube issues (check with the `sonarqube` MCP server when it is
   configured, or the PR's SonarQube check).
4. The phase file's acceptance criteria for that piece are met.

@docs/CODING_PRINCIPLES.md
