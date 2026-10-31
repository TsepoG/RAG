# Phase 10: GitHub through the GitHub CLI login (decisions and spike results)

Agreed 2026-10-31. The brief, `docs/phases/phase-10.md`, specifies the work;
this note explains why. If the two disagree, the brief wins.

## Why this phase exists

- The app reads GitHub through a fine-grained personal access token,
  `GITHUB_TOKEN`, which it uses both for the GitHub MCP server and for its own
  REST calls. The owner wants to use their own GitHub login instead of
  managing a token.
- Copilot's own sign-in is separate and is not part of this phase.

## Options considered

| Option | Why it was or wasn't chosen |
| --- | --- |
| **GitHub App with device-code sign-in** | The cleanest for permissions: read-only Contents and Metadata on chosen repos, with tokens that expire and renew. **Rejected**, because the repos belong to an organisation, so an organisation owner must install the app, and the owner wants to avoid that red tape. |
| **GitHub OAuth App** | Needs organisation approval too, and its `repo` scope is read and write. Rejected. |
| **GitHub CLI login (`gh auth token`)** | **Chosen.** It uses GitHub's own CLI app, which organisations usually already allow. There's nothing to register and no admin step. |
| **Keep the fine-grained token** | Stays the default (`token` mode). |

## Spike results (2026-10-31)

The spike ran on a personal machine against `TsepoG/RAG`. The scripts were
throwaway, nothing was committed, and the branch was deleted.

- **Token:** came from the gh login in the system keyring, prefix `gho_`. No
  SSO warnings, as expected on a personal account.
- **Scopes:** `gist`, `read:org`, `repo`, `workflow`.
- **GitHub MCP server** with the CLI token and `X-MCP-Readonly: true`:
  - it connected and offered only read tools;
  - all six allow-listed tools were present;
  - **no write tools** were exposed;
  - extra read tools (`search_commits`, `list_repository_collaborators` and
    others) appeared, but the app's allow-list already excludes them.
- **MCP read:** `get_file_contents` on the root succeeded (28 entries).
- **The app's REST calls** with its own client and headers:
  - repo: 200;
  - head commit: 200, with a SHA;
  - CODEOWNERS: 404 in all three places (there is no file, which is fine);
  - re-check contents: 200.
- **Copilot session** with the CLI token as a static header: `github_repos`
  connected and all six tools were found. No prompt was sent.

## Key choices and why

- **Opt-in mode, with token mode unchanged.** The token path is proven, and
  the work computer may turn out not to allow the CLI.
- **Remove `GH_TOKEN` and `GITHUB_TOKEN` from the environment `gh` runs in.**
  `gh auth token` returns those variables if they are set, and the app's own
  `GITHUB_TOKEN` in `.env` has the same name. Without this, the app could
  quietly use a different token or account.
- **Cache briefly, and retry once after a 401.** CLI tokens don't expire, so a
  short cache plus re-reading after a 401 picks up a new login without a
  renewal timer.
- **Swap the header between turns** if the token changed (after a re-login or
  account switch), using the Phase 9 helper. That helper is proven to keep the
  session's history.
- **Reuse the Phase 9 screens** with GitHub wording, and **Check again**
  instead of a sign-in link, because the login happens in a terminal.
- **`npm run github:check` before switching modes.** The organisation rules
  (SSO, a policy blocking the CLI, Copilot or MCP policy) can only be tested on
  the work computer. One command answers them clearly, and tells the owner to
  stay on token mode if the organisation blocks the CLI.

## The trade-off, stated plainly

- The CLI token can write. It has `repo`, `workflow` and `gist`, and the CLI
  can't narrow them.
- In gh-cli mode, read-only depends **entirely on the app's own layers**:
  - the read-only MCP header;
  - the allow-list;
  - the permission handler;
  - the pre-tool hook (with `GITHUB_REPOS` scope);
  - GET-only REST calls.
- All of these held in the spike. This was accepted for a local, one-person
  MVP. It would need revisiting for a hosted version.

## Open risks

- Organisation SSO, a policy blocking the CLI, and Copilot or MCP policy have
  not been tested yet; `github:check` covers them on the work computer.
- The CLI login's broad scope (above).
- `restartServer` is still marked experimental in the SDK, although it was
  proven in Phase 9.
