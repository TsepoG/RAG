# Phase 7 (planned, not started) — Conversation decisions

Agreed 2026-10-12. Start only after Phase 6 is merged and v0.1.0 is tagged; the owner will say when.

## Approach: Option B — one Copilot session per conversation, done properly
- Citation keys last for the whole conversation, so follow-ups can cite sources fetched in earlier turns.
- Cap of about 5 turns per conversation, then suggest starting a new one (limits context growth and SDK history compaction).
- Confidence caps, call budget and style rewrite applied per turn.
- Earlier answers and source text treated as data, not instructions.
- Changing role starts a new conversation.

## UI technology (decided 2026-10-13)
- The project is a **local proof of concept**, so the chat is built in the **existing plain HTML/CSS/JavaScript UI** from Phase 5 (no framework, no build step, server-side sanitised HTML, strict CSP).
- **Considered and deferred: CopilotKit** (React chat toolkit using the AG-UI protocol). Not used because it requires React and a build step, its message model doesn't fit the draft-then-validated-final answer with banners, citations and re-check badges (headless mode would mean writing that rendering anyway), the custom answer pipeline would need wrapping as an AG-UI agent, and the CSP/sanitisation model would need re-checking.
- **Revisit if the project moves to production** (multi-user web app with the system design's React/Next.js front end): then move the UI to React as its own step and compare CopilotKit against one or two alternatives (e.g. assistant-ui, Vercel AI SDK chat hooks) on custom message rendering and fit with a strict CSP and server-side sanitisation.

## Sources in the chat UI
- Citations are still created at answer time (required for the confidence rules). No "answer first, find sources later".
- Each message has a collapsible "Sources (n)" button with small inline chips in the text.
- Each source shows which turn it was first fetched in.

## Re-checking sources
- Manual "Re-check sources" button per message.
- Automatic re-check, triggered by source age and reuse rather than conversation length:
  - a cited source fetched more than ~15 minutes ago;
  - an answer citing a source fetched in an earlier turn;
  - before the turn cap is reached.
- Done by the app, not the model (no Copilot requests): GitHub latest-commit check for the file, Confluence page version check.
- Unchanged → "checked just now" mark. Changed → "changed since this answer" badge, that answer capped at medium with the reason shown, and a one-click "Re-ask with the latest version" (no silent rewrite).

## Evaluation
- Add 4–5 multi-turn eval cases (questions that only make sense after a previous one) so the existing eval confirms nothing regressed.
