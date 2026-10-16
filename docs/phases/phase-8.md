# Phase 8: UI and UX redesign ("Clarity")

## Goal

Rebuild the web UI so it looks and feels like a finished product the owner can
demo to managers. The new UI follows design direction **A · Clarity**, which
the owner chose from three directions. Nothing about how answers are produced
changes. Every honesty feature from Phases 3–7 stays visible, and most become
easier to see:

- citations
- confidence
- what the assistant isn't sure about
- source re-checks
- not found / out of scope
- turn limits

The phase also adds three small features shown in the design: **example
questions per role**, **Copy this conversation**, and a **typical answer time
hint** based on real eval timings.

## Out of scope

- React or any other framework.
- A build step or a CSS framework (Tailwind etc.).
- Dark mode.
- A conversation history list.
- Changes to the answer pipeline, prompts, caps, re-check logic or SSE events
  (except the small additions listed below).
- Anything from the production design.

React was considered and rejected for this phase. It would take roughly
twice as long for the same screens, and it would mean re-checking the CSP and
the sanitised-HTML model. If the project goes to production, moving to React
is a separate step.

## What Phases 1–7 left in place

- **Plain HTML/CSS/JS UI** in `public/`: chat shell, message list, answer
  card, "Sources (n)" panel per answer, Re-check, "Re-ask with the latest
  version", role lock prompt, turn counter, conversation-ended state,
  `sessionStorage` restore, Stop, "Show more detail", feedback buttons,
  aria-live, skip link.
- **Server-side answer HTML**: markdown is rendered with `marked`, cleaned with
  `sanitize-html` and given citation chip buttons; the client inserts that
  sanitised HTML only.
- **Server and browser security**: strict CSP, Host/Origin/Sec-Fetch-Site/
  Content-Type guards.
- **SSE events**:
  - `progress`
  - `token`
  - `done` (with `answerId`, `turn`, `recheck`)
  - a separate `recheck` event after `done`
  - `error`
- **Conversation API**: `POST/GET/DELETE /api/conversations…`, `/messages`,
  `/recheck`.
- **Roles** in `roles/*.yaml`, validated with Zod.
- **jsdom UI tests**; coverage is at least 90%.
- **Eval timings** (latency p50/p95) in `docs/EVAL_LOG.md`.

## Inputs to read first

- `CLAUDE.md`, `docs/CODING_PRINCIPLES.md`, this file.
- **The design reference**: `docs/design/phase-8/*.html`.
  - These are the owner-approved mockups.
  - Each is a self-contained HTML file with inline styles. Open it in a
    browser to see it (fonts may fall back), or read the markup for exact
    sizes and colours.
  - They are a **reference, not code to copy**: rebuild them as semantic
    markup with classes and the tokens below.
  - Files:
    - `conversation.html`: an active conversation, turn 2.
    - `welcome.html`
    - `in-progress.html`: an answer in progress.
    - `not-found-and-ended.html`: not found, out of scope and conversation ended.
    - `phone.html`
- The current `public/` code and its tests.
- `src/server` routes that feed the UI.
- `roles/*.yaml` and the role schema.
- `docs/EVAL_LOG.md`, for the latest latency numbers.

## Design tokens (one source of truth: `public/css/tokens.css`)

All colours, sizes and radii live in CSS custom properties. Components never
hard-code them.

| Token group | Values |
| --- | --- |
| Surfaces | page `#F4F6FA`, surface `#FFFFFF`, subtle `#F4F6FA`, border `#E2E6EE`, border-strong `#D3D9E4` |
| Ink | ink `#0F1729`, body `#3B4556`, muted `#556070`. Never use lighter greys for text: the mockups' `#8A93A3` fails contrast, so use muted instead |
| Accent | accent `#2446F5`, accent-strong `#1530C4`, accent-soft `#EEF1FF`, accent-border `#C9D2FF` |
| Confidence | high: bg `#E3F4EC`, text `#0E5E46`, check `#13795B`. Medium / changed: bg `#FFF1E0`, panel `#FFF7EE`, border `#F5D4AE`, text `#8A3D00`, deep `#5C2A00`. Low (not in the mockups): bg `#FDECEC`, text `#9B1C1C`. Neutral (not found / out of scope / clarify): bg `#EEF0F4`, text `#2B3444` |
| Chips | Confluence `C#`: accent-soft / accent-border / accent-strong. GitHub `G#`: subtle / border-strong / ink |
| Type | Geist 400/500/600/700 for UI; Geist Mono 400/500 for keys, file paths and commit SHAs. Sizes 12, 13, 14, 15 (body), 16, 17, 40 (welcome heading). Line height 1.5 for UI, 1.65 for answer text |
| Radii | chip 6, button 8–10, panel 12, card 16, pill 999. User bubble `16 16 4 16` |
| Spacing | 4-px scale: 4, 8, 10, 12, 14, 16, 22, 24, 28, 32 |
| Shadow | composer and end card only: `0 8px 24px rgba(15,23,41,.06)` |
| Focus | 2px accent outline, 2px offset, on every interactive element, shown on keyboard focus |

States must never be told apart by colour alone: each confidence state and
source status has an icon and a text label. Body text needs at least 4.5:1
contrast and large text 3:1. `prefers-reduced-motion` turns off the spinner
animation and the streaming caret.

## Fonts

- Geist and Geist Mono are free under the SIL Open Font License.
- Serve them **from the app** (`public/fonts/*.woff2`, with the `OFL.txt`
  licence next to them), not from Google Fonts, so the CSP doesn't change.
- Take the files from an official source: the `geist` npm package or the
  Vercel Geist release. Commit only the weights you use.
- Confirm the CSP allows `font-src 'self'`. If it only has `default-src
  'self'`, that already covers it; say which.
- Use `font-display: swap` and a system-ui fallback stack.

## Screens and states (match the reference)

**Layout**
- Desktop: a white left sidebar (about 280px), with a chat column on the
  right, centred, at most 820px wide.
- At 720px and below, the sidebar becomes:
  - a top bar with the logo and a menu button (44×44, `aria-label`);
  - a strip showing the role and "Turn n of 5";
  - a drawer that opens from the menu button. The drawer holds the sidebar
    contents, traps focus, closes with Esc and returns focus to the button.
- The composer is pinned at the bottom on every width.

**Sidebar**
- Brand mark and the name "Knowledge Assistant", with the subtitle
  "Confluence + GitHub".
- **"Answering as"** role list:
  - Before the first question the buttons can be selected (`aria-pressed`).
  - After it, the chosen role shows a lock icon and the note "Role is locked
    for this conversation. Changing it starts a new one." The existing role
    lock prompt still applies.
- Conversation box:
  - "Turn n of 5", from `CONVERSATION_MAX_TURNS` (the server already sends
    this).
  - A progress bar.
  - "Sources used" count.
  - **New conversation** button.
  - **Copy this conversation** button.

**Welcome** (no conversation yet)
- Heading: "What would you like to know?", with one line of intro text.
- Three promise tiles: "Every answer is sourced", "Says how sure it is",
  "Admits what it can't find".
- **"Try asking"**: 2–4 example questions for the selected role. They change
  when the role changes. Clicking one puts it in the composer and focuses it;
  it doesn't send.
- Composer with the label "Your question", the note "Up to 5 questions per
  conversation" and an **Ask** button.

**User message**: a dark ink bubble, aligned right.

**Answer in progress**
- An ordered list of steps built from the existing `progress` events: done
  steps get a check, the current step a spinner, future steps are muted.
  Labels are in plain words, for example:
  - "Searched Confluence: 3 pages found"
  - "Read 'Returns and refunds policy'"
  - "Checking the code in src/returns/"
  - "Writing and checking the answer"
- Map the events that already exist and **don't add server events** unless one
  is genuinely missing. If one is, propose it in the plan.
- Draft text appears below in muted colour with the label "Draft: sources
  still being checked" and a caret.
- The card has `aria-busy="true"`.
- The composer is disabled and **Stop** replaces Send.
- Next to Stop, the typical-time hint (see Additions).

**Answer card (answered)**
- Header: confidence pill (icon + "High / Medium / Low confidence") and
  "Turn n".
- If a cited source changed: a medium-amber banner reading "A source has
  changed since this answer was written. G2 was updated after it was read."
  with a **Re-ask with the latest version** button.
- The existing confidence cap banner and reason stay. The reason is shown
  under the pill whenever confidence was capped.
- Answer text with inline citation chips. Chips are buttons that open or
  scroll to that source in the list.
- **"What I'm not sure about"** for gaps. Conflicts, when present, appear in
  the same style under "Where sources disagree".
- Sources toggle: **Sources (n) ▾**, collapsed by default, `aria-expanded`.
  Each row shows:
  - the key chip;
  - the title, or the file path in mono;
  - "Confluence · fetched in turn N" (or GitHub);
  - a status: "✓ checked 1 min ago", "Changed since this answer" (amber row)
    or "Couldn't check".
  - Also-consulted sources show "· also consulted" and have no status.
- **Re-check sources** button in the sources header.
- Footer: **Show more detail →** on the left, and on the right thumbs up/down
  icon buttons (44×44, `aria-label`).

**Not found / out of scope / clarify**
- A neutral pill: "Not found in the docs" (magnifier icon), "Outside what I
  can answer" (no-entry icon), or "Needs a bit more detail" (question icon).
- Plain text explanation.
- For not found: a subtle panel with **"Where I looked"** (the sources it
  consulted) and **"Who might know"** (the existing who-to-ask output). Hide
  either part when it's empty.

**Conversation ended**
- An end card replaces the composer, with:
  - a title and a one-line reason;
  - the final re-check summary (for example "Final check of all 6 sources: 5
    unchanged, 1 changed");
  - **Start a new conversation** (primary) and **Copy this conversation**.
- Write text for every end reason that already exists, for example:
  - turn cap: "This conversation has reached its 5 questions"
  - source budget: "This conversation has read as much as it can"
  - truncation: "Earlier sources dropped out of the assistant's memory"
  - idle expiry or server restart: "This conversation has expired"

**Errors** (not in the mockups)
- An answer-card-shaped panel with a low-red pill "Something went wrong", the
  existing user-facing message, and a **Try again** button where the existing
  code allows a retry.

## Additions

1. **Example questions per role**
   - Add an optional `examples` field to the role schema: 0–4 strings of 10–160
     characters each.
   - Expose it through the existing role-listing route, or add one if roles
     are currently embedded in the page; say which.
   - Claude Code drafts 3 examples per role, marked as drafts in the plan, and
     the owner edits them. They must be questions the real eval set shows the
     assistant can answer, not invented topics.
2. **Copy this conversation**
   - A pure function `conversationToMarkdown(transcript)` builds the markdown:
     - a title line with role and date;
     - then, for each turn: the question, the answer text with citation keys,
       the confidence and its reason, and a "Sources" list of `[KEY] title —
       URL`.
   - It copies with `navigator.clipboard.writeText` (localhost counts as a
     secure context).
   - If the clipboard isn't available, show the markdown in a read-only
     textarea dialog, selected, with a "Copy" hint.
   - Announce "Conversation copied" through the existing aria-live region.
   - It uses only data the client already has. No new server route.
3. **Typical answer time hint**
   - Read the latest full-run p50 and p95 latency from `docs/EVAL_LOG.md`.
     Round them to the nearest 5 seconds and store them as named constants in
     one UI config module, with a comment naming the run they came from.
   - Display: "Usually takes about {p50}–{p95} seconds".
   - Hide the hint if the constants are missing. Report the chosen numbers in
     the plan.

## Code structure

- Split the UI into small render modules under `public/js/ui/`. Each exports
  pure-ish functions that take data and return DOM elements, with no fetch
  calls inside:
  - `sidebar.js`
  - `welcome.js`
  - `message.js`
  - `answerCard.js`
  - `sources.js`
  - `progress.js`
  - `composer.js`
  - `endCard.js`
  - `drawer.js`
  - `copyConversation.js`
  - `timeHint.js`
- State and networking stay in the existing modules. Remove dead code from the
  old UI.
- CSS files:
  - `public/css/tokens.css`
  - `base.css`: reset, fonts, focus, reduced motion
  - `layout.css`: sidebar, column, breakpoints
  - `components.css`: one section per module, with BEM-style class names
- No inline `style` attributes in the markup.
- Sanitised answer HTML is still the only HTML inserted as HTML. Everything
  else is built with DOM APIs and `textContent`.
- If the existing structure makes a module unnecessary, say so in the plan
  rather than creating an empty file.
- Keep the docs reference files out of SonarQube and Prettier scope (`docs/`
  is already Prettier-ignored). Confirm whether Sonar analyses `docs/`, and
  exclude `docs/design/` if it does.

## Tests required

- Each render module, in jsdom:
  - correct text, roles and labels for each state;
  - `aria-pressed`, `aria-expanded` and `aria-busy`;
  - icon-only buttons have `aria-label`;
  - no element gets HTML except the sanitised answer container.
- Answer card states:
  - high, medium, low;
  - capped with a reason;
  - changed source with Re-ask;
  - gaps;
  - conflicts;
  - not found with and without "Where I looked" / "Who might know";
  - out of scope;
  - clarify;
  - error.
- Sources rows:
  - checked (relative time with an injected clock);
  - changed;
  - couldn't check;
  - also consulted;
  - a chip click focuses the matching row.
- Progress: event-to-label mapping, including unknown events (a generic label,
  never a crash); step status transitions; draft label shown until `done`.
- Welcome: examples change with the role; clicking one fills and focuses the
  composer without sending.
- End card: each end reason's text; the final re-check summary counts.
- Drawer: opens and closes, Esc, focus trap, focus returns to the button.
- `conversationToMarkdown`: full transcript; changed and also-consulted
  sources; a turn with no sources; characters that need escaping.
- Copy: clipboard success and failure (fallback dialog); announcement.
- Time hint: formatting; hidden when the constants are missing.
- Role schema: `examples` valid, too many, too long.
- **Automated accessibility**: add `axe-core` as a dev dependency and run it in
  jsdom against the welcome, conversation, in-progress, not-found and ended
  states. Zero violations. Colour-contrast checks don't work in jsdom, so
  contrast is checked by the owner in the browser (below).

## Acceptance criteria

- [x] `npm run verify` passes; coverage ≥ 90% on all four measures.
      _3834 tests, coverage 100% on all four measures._
- [ ] The UI matches the reference at 1440px and 390px for: welcome, active
      conversation (turn 2 with a changed source), answer in progress, not
      found / out of scope, and conversation ended. The owner compares
      screenshots side by side with the mockups.
- [x] All honesty features from Phases 3–7 are still visible and working:
      chips, confidence and reason, gaps, conflicts, Sources (n), re-check,
      Re-ask, Stop, Show more detail, feedback, role lock, turn cap,
      reload restore.
      _Checked by the owner in the browser, and by the ported tests._
- [x] Example questions per role, Copy this conversation, and the time hint
      work as specified.
      _The role field is `suggestedQuestions`, because `examples` was already taken. The hint reads "Most answers take 1–3 minutes" (p25–p75 of run 20261014-190623), not p50–p95 as drafted. Copy also shows a message on screen._
- [x] Geist fonts are served locally with the licence; the CSP is unchanged or
      only tightened.
      _The CSP is unchanged; `.woff2` was added to the static server._
- [x] axe-core finds zero violations in the tested states. In Chrome
      DevTools, Lighthouse accessibility scores ≥ 95 on the conversation
      screen, and keyboard-only use works end to end, including the phone
      drawer (owner checks).
      _axe runs in jsdom (the other UI tests use happy-dom). Lighthouse accessibility: 96 on desktop and on a phone; one best practice, touch target size, is left. The skip link was removed at the owner's request, so the keyboard pass starts at the roles._
- [x] No answer-pipeline behaviour change: the existing server and answer
      tests pass without being modified, and one smoke conversation in the
      browser behaves as in Phase 7.
      _The server and answer tests are unmodified; the smoke conversation behaved as in Phase 7._
- [ ] README screenshots are updated. `docs/DEMO.md` is rewritten as a
      10-minute manager demo on the new UI. `CHANGELOG.md` has an entry.
      `docs/ROADMAP.md` gains Phase 8.
- [ ] Phase 7 acceptance boxes are ticked to reflect reality, and this file
      plus `docs/design/phase-8/` are committed, in the first commit of the
      branch.
- [ ] CI is green; the SonarQube quality gate passes with zero new issues.

## Copilot request budget

The UI work needs no eval runs. Live requests are only for browser checks:
roughly 10–15 in total (a few conversations covering the states, plus the demo
rehearsal). Not-found and out-of-scope states can be triggered with questions
from the eval set that are known to produce them.

## Git rules for this phase

Claude Code never commits or pushes. It never adds `Co-Authored-By:` or
"Generated with Claude Code" lines (CODING_PRINCIPLES §8). After each step it
runs `npm run verify`, stops, summarises and suggests a Conventional Commit
message. The owner tags the release (`v0.3.0`).

## Manual steps for the repo owner

1. Pull `main`.
2. Save this file as `docs/phases/phase-8.md` and the mockups in
   `docs/design/phase-8/`, all uncommitted.
3. Let Claude Code create `phase-8-ui`.
4. Edit the drafted example questions for each role.
5. At the steps Claude Code asks, compare screenshots with the mockups at
   1440px and 390px, and send notes.
6. Run Lighthouse and a keyboard-only pass on the conversation screen.
7. Rehearse the manager demo using `docs/DEMO.md`.
8. After merging: `git tag v0.3.0 && git push origin v0.3.0`.
