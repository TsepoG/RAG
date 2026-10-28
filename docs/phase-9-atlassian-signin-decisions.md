# Phase 9: Sign in with Atlassian (decisions and spike results)

Agreed between 2026-10-27 and 2026-10-28. The brief is `docs/phases/phase-9.md`;
it specifies the work, and this note explains why. If the two disagree, the
brief wins.

## Why this phase exists

- Today the app reaches Confluence with an admin-created **service account
  key**. Answers draw on whatever that account can see, not on what the person
  asking can see.
- Personal **API tokens** can't replace it. The v2 Confluence MCP tools
  (`searchConfluence`, `getConfluenceContent`) need the
  `search:confluence:agent-interface` and `read:confluence:agent-interface`
  scopes, which can't be selected when creating a personal API token.
- Atlassian's older v1 MCP tools use ordinary scopes, but adopting them was
  rejected. It would mean real app changes (tools, scope checks, citations).
  Atlassian is moving tools to v2. And a forum report shows `getConfluencePage`
  failing with "scope does not match" on fully scoped personal tokens.
- **Signing in with your own account (OAuth 2.1)** does grant the agent-interface
  scopes. A spike proved it end to end.

## Command line or sign-in page

A command-line login (`npm run atlassian:login`) was cheaper by about a day.
It was dropped because:

- the tool is meant for every role, and Product Owners, Project Managers and
  BAs shouldn't need a terminal;
- a hosted version would sign in through the web anyway, so a command-line
  step would be thrown away;
- "everyone signs in with their own Atlassian account" is the experience to
  show managers.

The core work (storage, renewal, locking, the header, re-check via MCP) is
the same either way; only the front door differs.

## Spike results (2026-10-27)

The spike ran on a throwaway branch. Scripts lived in a git-ignored `.spike/`
folder; the tokens were revoked and nothing was committed.

- **Discovery.** `/.well-known/oauth-protected-resource/v2/mcp` points to
  `auth.atlassian.com/<id>`.
  - That server supports dynamic client registration for a public client.
  - PKCE is S256 only.
  - It offers authorization code and refresh grants, but **no device flow**.
- **Scopes.** Signing in granted
  `offline_access read:me read:account read:confluence:agent-interface search:confluence:agent-interface`,
  with no admin approval needed.
- **Tools.** With the OAuth token, `searchConfluence`, `getConfluenceContent`
  and `getAccessibleAtlassianResources` all loaded.
  - The write and destructive gateway tools are listed too.
  - The app's allow-lists and permission handler block them, and the
    read-only scopes refuse them anyway.
- **Copilot session.** A static `Authorization: Bearer <token>` header
  connected, and all three tools appeared. No prompt was sent.
- **`onMcpAuthRequest`** (experimental SDK hook) was **not** called; the
  runtime asked for its own `/mcp auth atlassian` instead. It is not used.
- **Lifetime.** The access token lasts 8 hours. Refresh works, and **the
  refresh token rotates every time**.
- **REST re-check with the OAuth token** returned 401 at the `api.atlassian.com`
  gateway. In this mode, re-check reads the page version through MCP.

## Key design choices and why

- **Opt-in mode (`oauth`), default unchanged.** The service account stays the
  proven path for evals and for demos until this phase is merged.
- **Static Bearer header**, not the SDK hook. It's the same mechanism the app
  already uses, and it was proven in the spike.
- **Renew at session creation if less than 3 hours remain, and before each
  turn if less than 5 minutes remain.** Tokens last 8 hours and conversations
  are short (5 turns, 30-minute idle limit), so a mid-conversation swap is
  rare. `restartServer` is the planned swap, with ending the conversation as
  the fallback.
- **Save rotated tokens before using them, single-flight, with a cross-process
  lock.** Otherwise two processes refreshing at once would invalidate each
  other and sign the person out.
- **Store the sign-in outside the repo**, so it can never be committed. Files
  are 0600 and the directory 0700. Windows only gets user-profile protection;
  a keychain was judged not worth a dependency for a local MVP.
- **Callback route with a narrow cross-site exception.** Atlassian redirects
  the browser back, so that one route must accept a cross-site navigation. It
  is protected by a single-use state, PKCE and strict input checks. The start
  route stays same-origin only, to prevent login CSRF.
- **Check the site after sign-in**, so someone signed in to a different
  Atlassian site gets a clear error rather than empty answers.

## Open risks

- The refresh token's absolute or inactivity lifetime is unknown.
- `restartServer` hasn't been tested live.
- A dynamically registered client could be removed on Atlassian's side, so the
  app must register again.
- The redirect is tied to the app's port. If `PORT` changes, the app registers
  again.
- Windows file protection is weaker than a keychain.

## Later: hosted team version

The MVP stays a local, one-person app. Hosting it for a team is a separate
multi-user phase, estimated at 3–5 weeks. It would add single sign-on,
per-user GitHub and Copilot access, a database and deployment. Per-person
Atlassian sign-in, built here, is reused there.
