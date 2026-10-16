# Phase 7 (complete, 2026-10-15): conversation decisions

Agreed 2026-10-12. Started 2026-10-13 and completed 2026-10-15; the release is tagged `v0.2.0`. The decisions below are as planned. "What was actually built" at the end records where the build differs from the plan.

## Approach: Option B, one Copilot session per conversation, done properly
- Citation keys last for the whole conversation, so follow-ups can cite sources fetched in earlier turns.
- A conversation is capped at about 5 turns, and then suggests starting a new one. The cap limits how much the context grows and how much SDK history compaction is needed.
- Confidence caps, the call budget and the style rewrite apply to each turn.
- Earlier answers and source text are treated as data, not instructions.
- Changing role starts a new conversation.

## UI technology (decided 2026-10-13)
- The project is a **local proof of concept**. The chat is built in the **existing plain HTML/CSS/JavaScript UI** from Phase 5: no framework, no build step, server-side sanitised HTML and a strict CSP.
- **Considered and deferred: CopilotKit**, a React chat toolkit that uses the AG-UI protocol. Reasons for not using it:
  - It needs React and a build step.
  - Its message model doesn't fit our answers: a draft followed by a validated final version, with banners, citations and re-check badges. Its headless mode would mean writing that rendering ourselves anyway.
  - Our own answer pipeline would have to be wrapped as an AG-UI agent.
  - The CSP and sanitisation model would need checking again.
- **Revisit this if the project goes to production** as a multi-user web app with the React/Next.js front end from the system design. At that point, move the UI to React as a separate step. Then compare CopilotKit with one or two alternatives (for example assistant-ui or the Vercel AI SDK chat hooks) on custom message rendering and on fit with a strict CSP and server-side sanitisation.

## Sources in the chat UI
- Citations are still created when the answer is written, because the confidence rules need them. There is no "answer first, find sources later".
- Each message has a collapsible "Sources (n)" button, plus small inline chips in the text.
- Each source shows the turn it was first fetched in.

## Re-checking sources
- Each message has a manual "Re-check sources" button.
- Automatic re-checks are triggered by a source's age and reuse, not by conversation length:
  - a cited source was fetched more than about 15 minutes ago;
  - an answer cites a source fetched in an earlier turn;
  - the conversation is about to reach the turn cap.
- The app does the re-checks, not the model, so they use no Copilot requests. GitHub files are checked for a newer version and Confluence pages for a newer page version.
- Unchanged: a "checked just now" mark.
- Changed: a "changed since this answer" badge, the answer capped at medium with the reason shown, and a one-click "Re-ask with the latest version". The answer is never rewritten silently.

## Evaluation
- 4–5 multi-turn eval cases were added: questions that only make sense after an earlier one. The existing eval was also run to confirm nothing got worse.

## What was actually built (differences from the plan above, agreed during Phase 7)
- **Confluence re-check:** an app-side call to the Confluence REST v2 page endpoint (`api.atlassian.com/ex/confluence/{cloudId}/wiki/api/v2/pages/{id}`) using the service-account bearer key, reading `version.number`. Calling `getConfluenceContent` through the MCP client was the backup plan.
- **GitHub re-check:**
  - One request per source. The live fingerprint (blob SHA, a hash of a directory's entries, or the newest release tag) is compared with the one stored when the model read the source.
  - The comparison uses the same ref the model read from, not always the default branch.
  - A source with no stored fingerprint is reported as "couldn't check", never as "changed".
- **A source re-fetched in a later turn with a different fingerprint** gets a new key, and the old key is marked changed without an extra API call.
- **"Re-ask with the latest version"** is a new turn and counts toward the cap. Its turn note names the changed keys and asks the model to fetch them again.
- **Last-turn sweep:** it skips only sources checked in the last 2 minutes (a fixed window, separate from the 15-minute age trigger). Badges show when each source was last checked.
- **Re-checks never delay the answer:** the SSE stream sends `done`, then a separate `recheck` event, and then closes. A manual re-check repeated within 30 seconds is ignored, and at most 4 checks run at once.
- **Context truncation guard:** keeping infinite sessions disabled does not stop the SDK from truncating history (`session.truncation`). If truncation happens during a turn, that answer is capped at medium ("Some earlier sources were dropped from the assistant's memory.") and the conversation ends after that turn.
- **Per-turn state:** the call budget resets each turn, the tool gate reopens each turn, and the registry's turn view makes "also consulted" list only the current turn's sources.
- **Regression baseline:** Phase 6 had no final run, so a new single-question full run with a pinned model (on Pro+) was the baseline. Noise rule: more than 5 of 38 cases losing a pass, or a drop of more than 13 points in status accuracy, appropriate declines or correctness across all answered cases, counts as a regression.
