# Phase 8: UI/UX redesign decisions

Agreed 2026-10-15. Brief: `docs/phases/phase-8.md`. Mockups: `docs/design/phase-8/`.

## Direction
- Three directions were mocked up:
  - **A · Clarity**: light, sidebar, sources inline.
  - **B · Console**: dark, with a permanent Evidence panel.
  - **C · Briefing**: bold, with an "In short" line and suggested follow-ups.
- **The owner chose A as it is**, in its default blue (#2446F5). Nothing was borrowed from B or C.
- These A screens were designed and approved:
  - welcome
  - active conversation
  - answer in progress
  - not found / out of scope + conversation ended
  - phone (390px)

## Technology
- **Plain HTML/CSS/JS, no React.** Estimated 3–4 working days with plain JS, against 7–10 with React for the same screens.
  - Most of React's extra time would go into rebuilding things that already work: the build step, the jsdom tests, SSE state, and re-checking the CSP and sanitised-HTML model.
- To keep a later move to React a port rather than a redesign, the UI is split into small render modules (`public/js/ui/`) and one set of CSS variables (`public/css/tokens.css`).
- Geist and Geist Mono are self-hosted (OFL licence), so the CSP doesn't change.
- Revisit React only if the project goes to production, as its own phase after the manager demo.

## Three additions the owner asked for
1. Example questions per role, as an optional `examples` field in the role YAML. Clicking one fills the composer but doesn't send.
2. "Copy this conversation", as markdown with sources, done entirely in the browser.
3. A typical answer time hint, taken from the real p50/p95 latency in `EVAL_LOG.md` (not an invented number).

## Purpose
- The owner presents the MVP to managers. `docs/DEMO.md` is rewritten as a 10-minute demo on the new UI.
- Release tag: `v0.3.0`.
