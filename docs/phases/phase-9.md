# Phase 9: Sign in with Atlassian

## Goal

Let the person using the app sign in to Atlassian with **their own account**
from a sign-in page in the web app, instead of relying on the admin's service
account key. With the new `ATLASSIAN_AUTH_MODE=oauth` setting:

1. The app shows a **"Sign in with Atlassian"** screen when nobody is signed
   in. Signing in opens Atlassian's consent page and comes back to the app.
2. Copilot's Confluence connection uses that person's sign-in, so answers only
   draw on pages **they** are allowed to see.
3. The sign-in is **kept on the machine, renewed automatically**, and can be
   ended with **Sign out**.
4. The **service account modes stay exactly as they are**, and the default
   doesn't change. OAuth is opt-in.

The approach was proven in a time-boxed spike (see
`docs/phase-9-atlassian-signin-decisions.md`). This phase builds it to the
project's usual standard.

## Out of scope

- Hosting, multi-user support, or a login to the app itself.
- Per-user GitHub or Copilot sign-in. GitHub and Copilot keep their current
  set-up.
- A command-line login (`npm run atlassian:login`), which was considered and
  dropped.
- Using the operating system's keychain.
- Changing the default auth mode.
- The Copilot SDK's `onMcpAuthRequest` hook: the spike showed it doesn't fire.
- Write scopes of any kind.

## What Phases 1–8 left in place

- **Atlassian MCP config.** `src/mcp/servers.js` builds the Atlassian MCP
  server config with a static `Authorization` header: `basic`
  (email:token, the default) or `bearer` (service account key). The URL is
  `https://mcp.atlassian.com/v2/mcp`.
- **Allow-list and checks.** Three Confluence tools are allow-listed. A
  pre-tool hook checks scope, CQL and space, injects the cloudId, and enforces
  the budget. The read-only layers are the allow-lists, the permission handler
  and the hook.
- **Conversations.** One Copilot session per conversation; the session is
  created in `ensureSession` (`src/conversation/turn.js`). `askQuestion` creates
  one session per question (CLI and eval).
- **Re-check.** Confluence is checked through REST v2
  (`src/recheck/confluence.js`), via `api.atlassian.com` with the cloudId in
  bearer mode.
- **Server.** Fastify on 127.0.0.1 with guards (Host, Origin, Sec-Fetch-Site,
  Content-Type), a strict CSP, and the logger with redaction.
- **Web UI.** Design A · Clarity, plain JS render modules in `public/js/ui/`,
  and tokens in `public/css/tokens.css`.
- **MCP client.** `src/cli/mcpConnect.js` already uses
  `@modelcontextprotocol/sdk` as an MCP client. Check whether it's a dependency
  or a devDependency.

## Inputs to read first

- `CLAUDE.md`, `docs/CODING_PRINCIPLES.md`, this file.
- `docs/phase-9-atlassian-signin-decisions.md`: the spike results and why each
  decision was made. This file specifies; the decisions note explains. If they
  disagree, this file wins; list the disagreement in the plan.
- `docs/HOW_IT_WORKS.md`, sections 1 (request path), 2 (tool choice and hooks)
  and 6 (re-check).
- The installed `@github/copilot-sdk` types for `session.rpc.mcp.restartServer`.
- `docs/design/phase-8/*.html` and `public/css/tokens.css`, for the look of the
  new screens.

## What the spike proved (2026-10-27)

| Question | Result |
| --- | --- |
| Discovery | `https://mcp.atlassian.com/.well-known/oauth-protected-resource/v2/mcp` names the authorization server `https://auth.atlassian.com/<id>`; its metadata lists the authorize, token, revoke and dynamic-registration endpoints |
| Client | Dynamic client registration accepted a public client (`token_endpoint_auth_method: none`) with a `http://127.0.0.1:<port>/…` redirect |
| PKCE | S256 only |
| Device flow | Not offered. A browser and a local callback are required |
| Scopes granted | `offline_access read:me read:account read:confluence:agent-interface search:confluence:agent-interface`, with no admin approval |
| Tools with the token | `searchConfluence`, `getConfluenceContent` and `getAccessibleAtlassianResources` all present |
| Copilot session | A static `Authorization: Bearer <token>` header connected and all three tools loaded |
| `onMcpAuthRequest` | Not called. The runtime asked for `/mcp auth atlassian` instead |
| Lifetime | Access token 8 hours (`expires_in` 28800) |
| Refresh | Works. **The refresh token rotates on every refresh** |
| REST re-check with the token | `api.atlassian.com` gateway: 401. Re-check must use MCP in this mode |

## Decisions already made

| Area | Decision |
| --- | --- |
| Mode | New `ATLASSIAN_AUTH_MODE=oauth`, alongside `basic` and `bearer`. The default and the other modes are unchanged. In `oauth` mode, `ATLASSIAN_EMAIL` and `ATLASSIAN_API_TOKEN` are not required; `ATLASSIAN_SITE_URL`, `CONFLUENCE_SPACE_KEYS` and `ATLASSIAN_CLOUD_ID` are. |
| Discovery | Read the protected-resource metadata, then the authorization server metadata, at runtime (cached in memory for the process). Don't hard-code endpoints. Fail with a clear error if discovery fails. |
| Client registration | Dynamic registration, once, as a public client with grant types `authorization_code` and `refresh_token` and the redirect `http://127.0.0.1:<PORT>/auth/atlassian/callback` (the app's own port). Store the registration and reuse it. Register again only if Atlassian rejects the stored client, or `PORT` changes. |
| Scopes | Request exactly `offline_access read:me read:account read:confluence:agent-interface search:confluence:agent-interface`, with `resource=https://mcp.atlassian.com/v2/mcp`. After the token exchange, check that both Confluence scopes were granted; if not, show a clear error and don't save the sign-in. Never request a `write:` scope. |
| Site check | After sign-in, call the MCP tool `getAccessibleAtlassianResources` directly (app-side, not through Copilot) and confirm the account can reach `ATLASSIAN_CLOUD_ID` / `ATLASSIAN_SITE_URL`. If it can't, show "This Atlassian account can't reach <site>", and don't save the sign-in. |
| Who is signed in | Get the display name from the MCP tool `atlassianUserInfo`, called app-side. If that tool's result has no usable name, show "Signed in" without a name. Confirm the tool's output shape in planning. Never show or store an email address unless the result has one and it is needed; prefer the display name. |
| Storage | Outside the repo. The path comes from `ATLASSIAN_OAUTH_DIR` (default `~/.role-aware-assistant/`). Two files: `atlassian-client.json` (issuer, client id, redirect URI) and `atlassian-oauth.json` (access token, refresh token, `expires_at`, granted scopes, display name, cloud id). The directory is created with mode 0700 and files written with 0600, atomically (temp file, then rename). On Windows, mode bits don't apply, and the docs say so plainly. |
| Secrets | Tokens never appear in logs, errors, API responses or the page. Add every token field to the logger's redaction and to `redactConfig`. The status API returns only: signed in or not, display name, expiry time, and mode. |
| Renewal | One token provider, `getAtlassianToken({ minValidityMs })`. It is single-flight within the process, with a cross-process lock file in the storage directory (so the server, `npm run ask` and the eval can't rotate at the same moment). Use `open` with the `wx` flag and a stale-lock timeout; no new dependency. After taking the lock, it re-reads the file. It saves new tokens **before** returning them. On `invalid_grant`, it re-reads once more (in case another process rotated), then gives up. |
| When to renew | At session creation, if less than **3 hours** remain. Before each turn, if less than **5 minutes** remain: refresh, then swap the header on the live session with `session.rpc.mcp.restartServer({ serverName, config })`. If `restartServer` turns out not to work in planning or live checks, end the conversation with a new end reason `auth-expired` instead; propose this, don't decide it silently. |
| Expired or revoked sign-in | If a refresh fails, the turn is refused with HTTP 401 `atlassian_signin_required`. The page shows "Your Atlassian sign-in has expired" with **Sign in again**, and the conversation is not ended. A 401 from Atlassian in the middle of a turn reaches the model as an ordinary tool error; this is a documented limitation. |
| Session config | `buildMcpServers` becomes async in oauth mode (or takes an already-fetched token); the header is `Authorization: Bearer <token>`. Everything else (allow-lists, hooks, permission handler, cloudId injection) is unchanged. |
| Re-check in oauth mode | Confluence re-check calls `getConfluenceContent` through the app's own MCP client with the bearer token, as `mcpConnect.js` does, and compares the page version as today. Not a Copilot request. Space checks still apply. GitHub re-checks are unchanged. Move `@modelcontextprotocol/sdk` to `dependencies` if it isn't already. Open one MCP connection per re-check batch. |
| CLI and eval | `npm run ask` and the eval in oauth mode use the stored sign-in through the same provider. If there is none, they exit with "Sign in through the web app first (ATLASSIAN_AUTH_MODE=oauth)". Eval runs are normally done in `bearer` mode; the README says so. |
| Startup | In oauth mode the server starts even when nobody is signed in (the page shows the sign-in screen). Conversation and ask routes answer 401 `atlassian_signin_required` until sign-in. |

## Routes

| Route | What it does | Guards |
| --- | --- | --- |
| `GET /auth/atlassian/start` | Creates a PKCE pair and a one-time `state` (random, 32 bytes), keeps them in server memory for **10 minutes**, and redirects (302) to Atlassian's authorize URL. Only one sign-in can be pending; a new start replaces the old one. | Host check. Must be same-origin: `Sec-Fetch-Site` is `same-origin` or `none`, and refused when `cross-site`, so another site can't start a sign-in (login CSRF). GET only, no body. Only in oauth mode, 404 otherwise. |
| `GET /auth/atlassian/callback` | Checks `state` (it must match the pending one, be unexpired, and is used once), handles `error=`, exchanges the code with the verifier and `resource`, checks scopes and the site, saves the sign-in, then redirects to `/`. On failure it shows a small error page with the reason and **Try again**. | Host check. **Cross-site navigation is allowed on this route only** (it arrives from atlassian.com). Everything else is strict: GET only, no body, the `state` must match, `code` and `state` must have the expected shapes, and the `iss` parameter is checked if the authorization server metadata says it's supported. The error page is static, uses the same CSP, and never echoes raw query values except a known OAuth error code. |
| `GET /api/auth/status` | `{ mode, signedIn, displayName?, expiresAt? }`. In basic or bearer mode: `{ mode, signedIn: true }`. | Existing `/api` guards. |
| `POST /api/auth/atlassian/logout` | Revokes the refresh token and the access token at the revocation endpoint, then deletes `atlassian-oauth.json` (it keeps the client registration). If revocation fails, it still deletes the file and says so. It ends the active conversation with the existing `deleted` reason. | Existing `/api` guards (JSON, same-origin). |

The app should be opened at `http://127.0.0.1:<PORT>`. The redirect URI uses
127.0.0.1, so a sign-in started from `localhost` would come back on a
different origin. If the start route is reached on `localhost`, redirect to
the same path on 127.0.0.1 first.

## Screens (design A · Clarity, using the existing tokens)

- **Sign-in screen.** Shown instead of the welcome screen in oauth mode when
  signed out.
  - The brand mark, the heading "Sign in to get started", and one line: "Sign
    in with your Atlassian account. The assistant reads Confluence with your
    own access, read-only. Your sign-in stays on this computer."
  - A primary **Sign in with Atlassian** button. It is a real link to
    `/auth/atlassian/start`, not a script action.
  - The sidebar shows the brand only; the role list is hidden until sign-in.
- **Callback error page.** The same look, with "Sign-in didn't complete", the
  reason in plain words (cancelled, expired, missing permissions, wrong site,
  or something went wrong), and **Try again**.
- **Signed-in panel.** At the bottom of the sidebar: "Signed in as <name>"
  (or "Signed in"), with a **Sign out** button. In the phone drawer too. Sign
  out asks for no confirmation, but the toast says "Signed out".
- **Expired banner.** In place of the composer when a turn is refused with
  `atlassian_signin_required`: "Your Atlassian sign-in has expired." plus **Sign
  in again** (a link to the start route). After sign-in, the page restores the
  conversation as a reload would.
- **Accessibility.** Real buttons and links, focus states, and errors
  announced through the existing live region. The axe tests are extended to
  the sign-in screen and the expired banner.

## Modules to create or change

```
src/atlassian/
├── index.js
├── discovery.js        # fetch and validate metadata (Zod), cache
├── client.js           # dynamic registration, load/save client file
├── pkce.js             # verifier, challenge, state
├── authorize.js        # build authorize URL; exchange code; check scopes
├── store.js            # read/write token file atomically, 0600, dir 0700
├── lock.js             # cross-process lock file with stale timeout
├── tokens.js           # getAtlassianToken: single-flight, lock, refresh, rotation
├── revoke.js           # revoke access + refresh tokens
└── identity.js         # app-side MCP calls: getAccessibleAtlassianResources, atlassianUserInfo
src/server/routes/atlassianAuth.js   # start, callback, status, logout
src/mcp/servers.js                   # oauth mode: Bearer from the provider
src/conversation/turn.js             # renew at session creation; pre-turn check + restartServer
src/answer/askQuestion.js            # token before session creation
src/recheck/confluence.js            # oauth mode: version via MCP getConfluenceContent
src/config/schema.js, .env.example   # ATLASSIAN_AUTH_MODE=oauth, ATLASSIAN_OAUTH_DIR, conditional requirements
public/js/ui/signIn.js, public/js/ui/signedInPanel.js, public/js/ui/expiredBanner.js
public/css/components.css
```

Pure logic (PKCE, URL building, scope checks, expiry maths, metadata
validation, the parsing of `state` and the callback query) is kept separate
from I/O and tested without the network. Any HTTP calls go through an
injected `fetch`.

## Tests required

- **Discovery:** valid metadata parsed; missing endpoints, `S256` not supported
  and non-https URLs all rejected; cached per process.
- **Client:** registers once and reuses; registers again when the stored client
  is rejected or the redirect URI changed; the file is written 0600.
- **PKCE and state:** S256 challenge matches the verifier; state is random,
  single-use and expires after 10 minutes; a new start replaces the pending
  one.
- **Authorize URL:** the exact scopes, `resource`, `code_challenge_method=S256`
  and redirect; never a `write:` scope.
- **Callback:**
  - success saves and redirects;
  - refused for wrong, reused or expired state;
  - `error=access_denied` shows "cancelled";
  - missing Confluence scopes or the wrong site doesn't save;
  - `iss` mismatch refused when supported;
  - no token or query value echoed on the error page.
- **Guards:**
  - start is refused when `Sec-Fetch-Site: cross-site`;
  - callback accepts a cross-site navigation and nothing else;
  - start and callback return 404 outside oauth mode;
  - the start route redirects from `localhost` to 127.0.0.1;
  - status and logout use the usual `/api` guards.
- **Store:** atomic write (no partial file on a simulated crash), file 0600 and
  dir 0700 (skipped on Windows, with a comment); corrupt file treated as signed
  out.
- **Tokens:**
  - no refresh while plenty of time is left;
  - refresh when below the margin;
  - rotation saved before return;
  - single-flight (two callers, one refresh);
  - the lock held across processes (simulated with two providers sharing a
    directory);
  - stale lock broken;
  - `invalid_grant` re-reads once, then reports signed out.
- **Session:** oauth mode builds a Bearer header; basic and bearer configs
  unchanged byte for byte; renewal at session creation (3 hours) and before a
  turn (5 minutes), with `restartServer` called; a refresh failure refuses the
  turn with 401 `atlassian_signin_required` and keeps the conversation.
- **Re-check in oauth mode:** version through MCP (unchanged, changed,
  unavailable); a space outside the allowed list gives unavailable; the REST
  route is not called; one connection per batch.
- **Logout:** both tokens revoked; file deleted; revocation failure still
  deletes and reports it; the active conversation ends.
- **Status:** never includes tokens; correct shape per mode.
- **Logger and config:** token fields redacted; oauth mode doesn't require the
  email or the token.
- **UI (happy-dom), and axe (jsdom):**
  - sign-in screen;
  - callback error states;
  - the signed-in panel, including in the drawer;
  - the expired banner and Sign in again;
  - role list hidden while signed out;
  - zero axe violations.
- **Regression:** existing tests for basic and bearer modes pass unchanged.

## Acceptance criteria

- [ ] `npm run verify` passes; coverage ≥ 90% on all four measures.
- [ ] In oauth mode: a fresh start shows the sign-in screen; signing in with
      the owner's account returns to the app, shows "Signed in as …", and a
      question is answered with Confluence citations.
- [ ] Atlassian's consent page asks only for the read scopes listed above
      (owner confirms with a screenshot).
- [ ] Renewal: with `expires_at` edited to be near expiry, the next turn renews
      silently and the conversation carries on.
- [ ] Expired sign-in: with the refresh token revoked, the next turn shows the
      expired banner; **Sign in again** works and the conversation is restored.
- [ ] Sign out revokes the tokens, deletes the sign-in file, and returns to the
      sign-in screen.
- [ ] Re-check works in oauth mode through MCP, including one "changed" result
      after the owner edits a cited page.
- [ ] Tokens never appear in logs, API responses, the page or the repo
      (the owner greps the log and the repo; tests prove redaction).
- [ ] Basic and bearer modes behave exactly as before: tests unchanged, plus one
      bearer-mode smoke conversation.
- [ ] Smoke eval subset (about 8 cases) in oauth mode shows no regression
      against the latest bearer-mode smoke, within the Phase 7 noise rule.
- [ ] README (setup for each mode, sign-in, sign-out, where the sign-in is
      stored, Windows caveat, troubleshooting), `.env.example`, `docs/DEMO.md`
      (a sign-in moment), `docs/HOW_IT_WORKS.md` (auth section), CHANGELOG and
      ROADMAP are updated.
- [ ] Phase 8 acceptance boxes ticked to reflect reality, and this file plus
      `docs/phase-9-atlassian-signin-decisions.md`, committed in the first
      commit of the branch.
- [ ] CI is green; the SonarQube quality gate passes with zero new issues,
      including the security hotspots on the new routes.

## Copilot request budget

The sign-in work itself needs no Copilot requests. Live checks: about 4–6 for
the browser checks, about 8–10 for the oauth-mode smoke subset, and 1–2 for the
bearer-mode smoke. Roughly 15–20 in total.

## Git rules for this phase

Claude Code never commits or pushes, and never adds `Co-Authored-By:` or
"Generated with Claude Code" lines (CODING_PRINCIPLES §8). After each step it
runs `npm run verify`, stops, summarises, and suggests a Conventional Commit
message. The owner tags the release (`v0.4.0`).

## Manual steps for the repo owner

1. Pull `main`. Save this file as `docs/phases/phase-9.md` and the decisions
   note as `docs/phase-9-atlassian-signin-decisions.md`, both uncommitted. Let
   Claude Code create `phase-9-atlassian-signin`.
2. If you kept `docs/atlassian-oauth-spike.md` from the spike, delete it or
   leave it out: the decisions note replaces it.
3. Sign in live when asked, and screenshot Atlassian's consent page.
4. Run the expiry and revocation checks Claude Code describes.
5. Edit a cited Confluence page for the oauth-mode re-check.
6. Grep the log file and the repo for token fragments before the PR.
7. Run the smoke evals when asked.
8. After merging: `git tag v0.4.0 && git push origin v0.4.0`.
