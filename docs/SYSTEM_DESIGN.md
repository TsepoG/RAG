# Role-Aware Knowledge Assistant — System Design

> Full production design, last updated 2026-10-10. The local MVP builds only part of it: see `docs/ROADMAP.md` and the active phase file. Where this document and a phase file differ, the phase file wins for the MVP.

## Overview

We will build a chat assistant that answers project questions from Confluence and GitHub, pitched to the asker's role, with every answer showing linked sources. GitHub Copilot is the reasoning layer, embedded through the [Copilot SDK](https://github.blog/changelog/2026-06-02-copilot-sdk-is-now-generally-available/) (GA June 2026), and all content access goes through MCP servers — no separate vector database is required for v1.

**Problem.** Knowledge is split between Confluence (requirements, decisions, runbooks) and GitHub (the code that actually runs). Non-developers cannot read code, and developers waste time hunting for the page that explains why. People ask each other instead, which interrupts the few who know.

**Goals**

- Answer natural-language questions using only Confluence pages and GitHub code the asker is allowed to see.
- Adapt depth, vocabulary and format to the selected role (Developer, BA, QA, Product Owner, Project Manager, and more later).
- Show the exact Confluence pages and code files behind every answer, as clickable links, with code links pinned to a commit and line range.
- Say "I couldn't find this" rather than guess when sources are thin.

**Non-goals for v1**

- Writing back to Confluence or GitHub (read-only by design).
- Jira, Slack or other sources (the MCP design leaves room to add them later).
- Automatic role detection; the user picks their role and can switch at any time.

**Users and example questions**

| Role | Typical question | What a good answer looks like |
| --- | --- | --- |
| Developer | Where is the retry logic for payment webhooks? | File paths, function names, a short code excerpt, related design page |
| Business Analyst | What are the business rules for refund eligibility? | Rules in plain language, where they come from, gaps between spec and code |
| QA / Tester | What edge cases should I test for the new login flow? | Scenarios, inputs, expected outcomes, known validation rules in code |
| Product Owner | Does the app support multi-currency today? | Yes/no first, user-facing impact, what is planned vs built |
| Project Manager | Which teams own the onboarding feature and what depends on it? | Owners, dependencies, status signals, risks — no code |

## Architecture

The Orchestrator is the hub: it shapes the prompt by role, runs a Copilot SDK session, and records every page and file fetched so the answer can cite them.

```text
Web UI (role picker, chat, Sources panel)
        |  question + role          ^ answer + sources
        v                           |
API Gateway + Auth (SSO, per-user OAuth tokens)        Answer Log
        |                                                  ^
        v                                                  |
+------------------ Orchestrator (Answer Service) -------------------+
|  Role Profile Store  -->  Copilot SDK session  -->  Citation Registry |
+---------------------------------------------------------------------+
        |  read-only MCP tool calls
        v
MCP Gateway (allow-list, user tokens, audit log)
        |                                   |
        v                                   v
Atlassian Rovo MCP server            GitHub MCP server
        |                                   |
        v                                   v
Confluence Cloud spaces              GitHub repositories
```

Requests flow down to Confluence and GitHub through one MCP Gateway using the user's own tokens; answers and their sources flow back up to the UI, and every exchange is logged.

## Components

Seven components, each with one job; only the Orchestrator talks to Copilot, and only the MCP Gateway talks to Confluence and GitHub.

| Component | Responsibility | Suggested tech |
| --- | --- | --- |
| Web UI | Role picker, chat, streaming answer, Sources panel, feedback buttons | React / Next.js, SSE for streaming |
| API Gateway + Auth | SSO login, session, rate limits, maps the user to their Atlassian and GitHub identities | Company IdP (Entra ID / Okta) via OIDC; OAuth tokens for Atlassian and GitHub stored in a vault |
| Orchestrator (Answer Service) | Runs one question end to end: builds the role prompt, opens a Copilot SDK session, registers MCP servers and custom tools, enforces limits, assembles the cited answer | Node.js or Python service using the Copilot SDK |
| Role Profile Store | Versioned role definitions: tone, vocabulary, depth, source weighting, answer template | YAML in a repo, loaded at start-up; editable by admins without a deploy |
| MCP Gateway | One controlled entry point to the MCP servers; allow-lists read-only tools, injects the user's tokens, logs every call | Thin proxy in front of the Atlassian Rovo MCP server and the GitHub MCP server |
| Citation Registry | Records every page and file fetched during a session with a stable ID, URL, version and line range; validates the citations in the final answer | In-memory per request, persisted to the answer log |
| Answer Log + Telemetry | Stores question, role, tools called, sources, answer, latency, token cost and user feedback | Postgres + OpenTelemetry traces |

**Why the Copilot SDK and not a raw model API.** The SDK gives programmatic access to Copilot's agent runtime — planning, tool calls, streaming and multi-turn sessions — and can connect to MCP servers and custom tools directly, so we do not write our own agent loop. Its hooks let us intercept tool calls and permission requests, which is where the read-only and audit rules live.

**Why MCP-only retrieval in v1.** Both vendors ship official remote MCP servers that search and fetch live content with the user's own permissions, so answers are never stale and access control is inherited, not re-implemented. The cost is per-question latency and dependence on their search quality; a pre-built index is the phase-3 option if that proves too slow (see Risks).

## Role-aware answering

Role changes three things — which sources are searched first, how much technical detail survives, and the shape of the answer — while the facts stay the same for everyone.

| Role | Technical depth | Source weighting | Answer shape | Avoid |
| --- | --- | --- | --- | --- |
| Developer | High: names files, functions, configs; short code excerpts | Code first, design pages second | Direct answer → where in code → snippet → related docs | Over-explaining basics |
| Business Analyst | Medium: describes logic and rules, no code | Requirements and specs first, code to confirm behaviour | Rule list → source of each rule → spec-vs-code gaps | Code blocks, class names |
| QA / Tester | Medium: inputs, validations, error states | Acceptance criteria and test pages, then validation code | Scenarios table → expected results → edge cases | Implementation internals |
| Product Owner | Low: features and user impact | Product and roadmap pages; code only to confirm "is it built?" | One-line answer → user impact → built vs planned | Jargon, file paths in the body |
| Project Manager | Low: owners, status, dependencies, risk | Project, team and release pages; repo metadata (owners, recent activity) | Summary → owners → dependencies → risks | Code and technical detail |

**How it is applied**

1. **Role profile** — each role is a YAML file with `audience`, `depth` (1–3), `vocabulary_rules`, `banned_terms`, `source_priority`, `answer_template` and two or three example answers.
2. **System prompt** — built from a shared base (grounding and citation rules, identical for all roles) plus the role block. Keeping grounding rules shared means a non-technical role never gets a less accurate answer, only a simpler one.
3. **Retrieval hints** — `source_priority` tells the planner where to search first; a PO question still checks code when the question is "does it do X today?".
4. **Translate, don't hide** — for low-depth roles the model reads the code but explains it in business terms ("refunds over R5,000 need a manager's approval" instead of `if amount > 5000: require_approval()`). The code file still appears in Sources.
5. **Style check** — a cheap post-check flags banned terms or code blocks in a low-depth answer and asks the model to rewrite once.
6. **"Show me more detail"** — every answer offers a one-click re-ask at the next depth, so a BA can drill into code without switching role.

**Example: one question, two roles** — "How do we decide if a refund is allowed?"

- *Developer:* Eligibility is checked in `RefundPolicy.isEligible()` (refunds/policy.ts, lines 40–88): orders under 30 days, not already refunded, amounts over 5000 flagged for approval in `ApprovalService`. Matches the rules on "Refund Policy v3".
- *Product Owner:* A customer can get a refund within 30 days of ordering, once per order. Large refunds need a manager's sign-off. This matches the agreed Refund Policy v3; nothing extra is in progress.

Both answers list the same two sources underneath.

## Retrieval via MCP

Copilot plans the search itself, but only through a small allow-list of read-only tools, and every result passes through the Citation Registry before the model sees it.

**MCP servers and allowed tools** (confirm exact names against each server's live tool list at build time)

| Server | Endpoint | Allowed tools (read-only) | Blocked |
| --- | --- | --- | --- |
| [Atlassian Rovo MCP server](https://www.atlassian.com/platform/remote-mcp-server) | `https://mcp.atlassian.com/v2/mcp` | Rovo search, fetch page, CQL search, get page by ID, list spaces | All create/update tools; Jira tools in v1 |
| [GitHub MCP server](https://github.com/github/github-mcp-server) | `https://api.githubcopilot.com/mcp/` | search\_code, get\_file\_contents, list\_commits, search\_repositories | Issues/PR writes, pushes, workflow runs |

The Atlassian server only searches what the user can already see and does not cache content, so permission trimming comes for free. The GitHub server is given the user's own OAuth token for the same reason. The MCP Gateway restricts both to the configured Confluence spaces and GitHub repos.

**Custom tools the Orchestrator adds**

- `record_source(kind, id, url, version, lines)` — called automatically by a post-tool hook, not by the model; stores each fetched page or file and returns a short citation key such as `[C1]` or `[G2]`.
- `expand_code_context(repo, path, symbol)` — fetches the full function around a search hit, so the model is not reasoning from a three-line snippet.
- `resolve_page_links(page_id)` — follows one level of child or linked pages when a Confluence page is just an index.

**Search plan per question**

1. **Rewrite** the question into 2–4 search queries: business terms for Confluence, likely identifiers for code (`refund`, `RefundPolicy`, `isEligible`).
2. **Search** both sources in parallel, in the order given by the role's `source_priority`; cap at 10 results per call.
3. **Shortlist** the top 5 pages and top 5 code hits by relevance, recency and space/repo priority; drop archived pages and test fixtures unless the role is QA.
4. **Fetch** full content for the shortlist; trim long pages to the relevant sections and code to the enclosing function or class.
5. **Check coverage** — if a key term from the question has no supporting source, run one more targeted search; stop after 3 rounds or 12 tool calls.
6. **Assemble context** with each chunk tagged by its citation key, then answer.

**Context budget**: about 24k tokens of retrieved text per answer, split by role (a Developer gets roughly 60% code, a Product Owner roughly 80% Confluence). Anything cut is still listed as "also consulted" so the user can open it.

## Citations and source links

Every answer ends with a Sources panel listing each Confluence page and code file it used, as links the user can click; the model can only cite sources that were actually fetched in that session.

**How citations are produced**

1. A post-tool hook on every MCP fetch registers the source in the Citation Registry and gives it a key: `C1, C2…` for Confluence, `G1, G2…` for GitHub.
2. Retrieved text is passed to the model wrapped with its key, for example `<source key="G2">…</source>`.
3. The system prompt requires an inline key after every factual sentence (`…need manager approval [C1][G2].`).
4. After generation the Orchestrator validates: any key not in the registry is removed and the sentence is flagged; any answer with zero valid citations is replaced by "I couldn't find this in Confluence or the codebase" plus the closest pages it did find.
5. The UI turns keys into small numbered chips; hovering shows the title and the quoted span, clicking opens the source.

**What a link points to**

| Source | Link format | Pinned to | Shown to user |
| --- | --- | --- | --- |
| Confluence page | `https://<site>.atlassian.net/wiki/spaces/<KEY>/pages/<id>` + `#<heading-anchor>` when a section was used | Page version number at fetch time | Page title, space, last-updated date, section heading |
| GitHub file | `https://github.com/<org>/<repo>/blob/<commit-sha>/<path>#L40-L88` | Commit SHA, so the line numbers stay correct after later changes | Repo, file path, line range, branch, last commit date |
| GitHub file (latest) | Same path on the default branch | Moving target | Secondary "open latest" link next to the pinned one |

**Role-specific display.** Developers see file paths and line ranges inline. For Product Owners and Project Managers the body stays free of paths; sources sit in the panel below with friendly labels ("Refund rules — code (payments service)"), so they can still forward the link to a developer.

**Stale-source warning.** If a cited page has not been updated in over 12 months, or the code it describes changed after the page's last edit, the panel shows a small "may be out of date" marker. This is one of the most useful signals for BAs and POs.

## Honesty and confidence

The assistant always says how sure it is and why, separates what a source states from what it inferred, and names what it could not find — it never fills gaps from general model knowledge.

**Confidence levels shown on every answer**

| Level | When it applies | What the user sees (plain-language banner) |
| --- | --- | --- |
| High | Every claim is directly stated in a fetched source, and Confluence and code agree | "Confirmed in the documentation and the code." |
| Medium | Part of the answer is inferred from code, relies on a single source, or a cited page is stale | "Mostly confirmed — one part is my reading of the code, marked below." |
| Low | Sources are thin, partial or disagree | "I'm not sure. Here's what I found and what's missing." |
| Not found | No relevant source after the full search plan | "I couldn't find this in Confluence or the codebase." + closest pages + who to ask |

**How the level is set.** The model proposes a level with a one-line reason, then the Orchestrator applies hard caps it cannot override:

- No valid citations → Not found.
- Any sentence without a citation, or a cited page marked stale → at most Medium.
- Confluence and code disagree, or the coverage check left a key term unmatched → at most Low.

**Inside the answer**

- **Stated vs inferred.** Sentences backed by explicit text carry a normal citation; sentences that are the model's interpretation (usually of code) are prefixed "Based on the code, it looks like…" and marked *inferred* on the chip.
- **"What I don't know" block.** Low and Medium answers end with a short list of open gaps ("No page describes partial refunds; the code handles them in `refundPartial()` but I can't confirm the business intent").
- **Conflicts shown, never resolved silently.** When the spec and the code differ, both are stated with their sources and dates, and the user is told which describes current behaviour (the code).
- **Who to ask.** For gaps, the assistant suggests the page owner or last editor, or the repo's CODEOWNERS for that path.
- **Clarify before guessing.** If the question is ambiguous (for example "refunds" appears in two services), it asks one short clarifying question instead of picking one.
- **Out of scope stated plainly.** Questions outside the configured spaces and repos, or outside its sources entirely ("what will the release date be?"), get a direct "I don't have that information" rather than a plausible guess.

**Role-appropriate honesty.** The same uncertainty is expressed in the role's language: a Product Owner sees "I'm not sure this is built yet," a Developer sees "No implementation found for `multiCurrency`; only a design page from 2025." Uncertainty is never dropped to make a non-technical answer look simpler.

**Prompt rules (shared base, all roles)**

1. Use only the content inside `<source>` tags; if it is not there, say you don't know.
2. Cite every factual sentence; mark interpretations as inferred.
3. Report your confidence and the reason in the required field.
4. List what you could not confirm.
5. Never invent file names, page titles, functions, numbers or dates.

**API fields.** The `done` event carries `confidence`, `confidenceReason`, `gaps[]`, `conflicts[]` and an `inferred` flag per citation, so the UI renders the banner and markers without parsing text.

## End-to-end request flow

A typical question takes 6–15 seconds, with the first words streaming after about 3 seconds while searches finish.

1. **Pick role and ask.** The user signs in with SSO, selects a role (remembered for next time) and types a question. The UI sends `POST /api/ask` and opens a stream.
2. **Authorise.** The API Gateway checks the session and loads the user's Atlassian and GitHub OAuth tokens from the vault. If either is missing, the UI prompts a one-time connect.
3. **Build the prompt.** The Orchestrator loads the role profile and composes: base grounding rules + role block + allowed spaces and repos + last 3 turns of the conversation.
4. **Open a Copilot session.** Through the Copilot SDK, with the two MCP servers (via the MCP Gateway) and the custom tools registered, and hooks set for tool-call logging and source registration.
5. **Plan and search.** Copilot rewrites the query and calls search tools on Confluence and GitHub in parallel (Retrieval via MCP, steps 1–2).
6. **Fetch and register.** Shortlisted pages and files are fetched; each fetch is registered as `C#` or `G#` and returned to the model tagged with its key.
7. **Answer.** Copilot writes the role-shaped answer with inline citation keys; text streams to the UI as it arrives, with citation chips shown greyed out until step 8 confirms them.
8. **Validate.** The Orchestrator checks citations against the registry, runs the role style check, and rewrites once if needed.
9. **Render.** The UI shows the answer, citation chips, the Sources panel, "show more detail" and thumbs up/down.
10. **Log.** Question, role, tool calls, sources, answer, latency and cost are written to the Answer Log for evaluation.

## API contract and data model

The UI needs four endpoints; the answer payload carries its sources as structured data so the UI never parses links out of text.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/roles` | List roles with display name and description for the picker |
| `POST /api/ask` | Ask a question; streams events (`token`, `source`, `done`) over SSE |
| `POST /api/answers/{id}/feedback` | Thumbs up/down, optional comment, "wrong source" flag |
| `GET /api/conversations/{id}` | Reload a past conversation with its sources |

**Request**

```json
{
  "conversationId": "c_8f2…",
  "role": "business_analyst",
  "question": "How do we decide if a refund is allowed?",
  "detailLevel": "default"
}
```

**Final `done` event**

```json
{
  "answerId": "a_31c…",
  "answerMarkdown": "Customers can get a refund within 30 days [C1]. Amounts above 5,000 need manager approval [C1][G1].",
  "confidence": "high",
  "sources": [
    {
      "key": "C1",
      "type": "confluence",
      "title": "Refund Policy v3",
      "space": "PAY",
      "url": "https://acme.atlassian.net/wiki/spaces/PAY/pages/123456#Eligibility",
      "version": 14,
      "lastUpdated": "2026-08-12",
      "section": "Eligibility",
      "stale": false
    },
    {
      "key": "G1",
      "type": "github",
      "title": "refunds/policy.ts",
      "repo": "acme/payments-service",
      "url": "https://github.com/acme/payments-service/blob/9c1e2ab/src/refunds/policy.ts#L40-L88",
      "latestUrl": "https://github.com/acme/payments-service/blob/main/src/refunds/policy.ts",
      "commit": "9c1e2ab",
      "lines": [40, 88],
      "friendlyLabel": "Refund rules — code (payments service)"
    }
  ],
  "alsoConsulted": ["C3", "G4"],
  "followUps": ["Show more technical detail", "What happens when a refund is rejected?"]
}
```

**Stored tables (Postgres)**

| Table | Key fields |
| --- | --- |
| `conversations` | id, user\_id, role, created\_at |
| `answers` | id, conversation\_id, question, answer\_md, role, role\_profile\_version, model, latency\_ms, tokens\_in, tokens\_out |
| `answer_sources` | answer\_id, key, type, url, version\_or\_commit, lines, cited (bool) |
| `tool_calls` | answer\_id, server, tool, args\_hash, duration\_ms, result\_count, error |
| `feedback` | answer\_id, rating, comment, wrong\_source\_key |

Source content itself is not stored, only references, so the log never becomes a second copy of restricted pages or code.

## Security, permissions and compliance

The assistant can never show someone a page or file they could not open themselves, because every MCP call runs with that user's own token.

- **Per-user delegated access.** Users connect Atlassian and GitHub once via OAuth; tokens live in a secrets vault, are scoped read-only, and are refreshed by the API Gateway. No shared service account reads content on users' behalf.
- **Role is not a permission.** The role picker changes tone only. Picking "Developer" does not unlock anything; access comes from the user's real Confluence and GitHub permissions.
- **Read-only enforcement in three places:** OAuth scopes, the MCP Gateway allow-list, and a Copilot SDK pre-tool hook that rejects any write tool.
- **Scope limits.** An admin-managed list of Confluence spaces and GitHub repos; everything else is filtered out even if the user has access, to keep answers on-topic and avoid HR or finance spaces.
- **Prompt injection.** Retrieved text is wrapped as data and the system prompt states that instructions inside sources are never followed. Tool permissions are fixed per session, so a malicious page cannot make the agent call new tools.
- **Secrets in code.** A redaction pass masks strings that look like keys, tokens or passwords before code reaches the model or the UI.
- **Data handling.** Confirm the Copilot plan's data-retention and training terms with the GitHub account team (Business/Enterprise plans do not train on customer code by default). The Answer Log stores references, not source content, with 90-day retention.
- **Admin controls on the Atlassian side.** Atlassian Administration lets admins restrict which AI clients and domains may connect to the Rovo MCP server; add this tool's domain to that list.
- **Audit.** Every tool call is logged with user, tool, arguments hash and result count, and can be exported for security review.

## Quality, evaluation and operations

We ship when a 100-question test set scores at least 85% correct and 95% correctly cited across all roles; these are proposed targets to confirm with stakeholders.

**Evaluation set.** 20 real questions per role, collected from Slack and team leads, each with the expected answer and the pages or files that should be cited. Re-run on every prompt, role-profile or model change.

| Metric | How it's measured | Target |
| --- | --- | --- |
| Answer correctness | Reviewer or LLM judge against expected answer | ≥ 85% |
| Citation precision | Cited sources actually support the sentence | ≥ 95% |
| Citation recall | Expected sources appear in Sources | ≥ 70% |
| Role fit | Non-technical answers contain no code or banned terms; judge rates readability for the role | ≥ 90% |
| Honest "not found" | Unanswerable questions get a not-found reply | ≥ 90% |
| Latency (p50 / p95) | Request to `done` event | ≤ 8s / ≤ 20s |
| User satisfaction | Thumbs-up share in production | ≥ 75% |
| Confidence calibration | Share of High-confidence answers that reviewers judge correct; Low answers that were actually right are tracked too | ≥ 95% of High answers correct |

**Observability.** OpenTelemetry trace per question covering each tool call, Copilot turn and validation step; dashboards for latency, tool errors, MCP rate-limit hits, not-found rate and thumbs-down by role. A weekly review of thumbs-down answers feeds new test cases.

**Performance and cost controls**

- Run Confluence and GitHub searches in parallel; cap rounds at 3 and tool calls at 12.
- Short-lived cache (15 minutes, per user) of fetched pages and files by version or commit, so follow-up questions are fast without breaking permissions.
- Respect Atlassian site-level MCP rate limits and GitHub API limits with back-off and a per-user queue.
- Track Copilot usage per answer; GitHub moved to credit-based AI billing in June 2026, so budget per seat and alert on outliers.

**Failure modes**

- One MCP server down → answer from the other and say which source was unavailable.
- Both down or Copilot unavailable → clear error with a retry button; never answer from model memory alone.

## Risks, open questions and roadmap

The biggest risk is retrieval quality on live MCP search; the phased plan tests that first with one team before scaling.

**Risks**

| Risk | Impact | Mitigation |
| --- | --- | --- |
| MCP search misses the right page or file | Wrong or "not found" answers | Query rewriting, coverage check, eval set; phase-3 index if recall stays under 70% |
| Latency of live search + fetch | Users give up | Parallel calls, streaming, per-user cache, round caps |
| Outdated Confluence contradicts code | Confident but wrong business answers | Prefer code for "what does it do today", flag conflicts and stale pages explicitly |
| Simplified answers lose accuracy for non-technical roles | Bad decisions by PO/PM | Shared grounding rules, citation validation, "show more detail" |
| Rate limits on Atlassian or GitHub | Errors at peak | Back-off, queue, cache, monitor limit hits |
| Copilot SDK or MCP tool names change | Breakage after upgrades | Pin SDK version, contract tests against the tool lists |

**Open questions**

- [ ] Which Confluence spaces and GitHub repos are in scope for the pilot?
- [ ] Is the Confluence site Cloud? The Rovo MCP server serves Atlassian Cloud only; Data Center would need a self-hosted Confluence MCP server.
- [ ] Do all target users have a GitHub seat with Copilot, or do non-developers need a service-backed model (BYOK) with their own GitHub read access?
- [ ] Where will it live: a standalone web app, or also inside Teams/Slack?
- [ ] Who owns the role profiles and the evaluation set after launch?

**Roadmap**

1. **Phase 0 — Spike (2 weeks).** Copilot SDK + both MCP servers in a CLI; 20 questions; confirm tool names, latency and citation flow.
2. **Phase 1 — Pilot MVP (4–6 weeks).** Web UI, SSO and OAuth, 3 roles (Developer, BA, PO), Sources panel, answer log; one team, 2–3 spaces, 2–3 repos.
3. **Phase 2 — Hardening (4 weeks).** All roles, full eval set and dashboards, stale-source markers, "show more detail", security review.
4. **Phase 3 — Scale (as needed).** Add an optional pre-built hybrid index (embeddings + keyword) behind the same MCP interface if live search recall or latency misses targets; add Jira and other sources; Teams/Slack front ends.
