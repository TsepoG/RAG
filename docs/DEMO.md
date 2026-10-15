# Demo script (13 minutes)

A walkthrough for showing the assistant to someone who has not seen it. It assumes the setup in
the README is done, `npm start` is running and the page is open at `http://127.0.0.1:3000`.

The questions below are patterns, not fixed text. Replace each topic in square brackets with
something that really exists in your Confluence spaces and your repositories, and prefer a topic
that appears in both. Each question is meant to show one thing, so the script says what to point
out.

Allow about 1 minute per question: answers take 30 to 90 seconds, so ask the next one while you
talk about the last.

## 0. Before you start (1 minute)

- Say what it is: a local assistant that answers from Confluence and GitHub, read-only, and says
  how sure it is.
- Point at the role picker: the five roles get different answers to the same question.
- Say what to watch for in every answer: the confidence banner, the numbered sources, and the
  "What I couldn't confirm" list.

## 1. Developer (2 minutes)

1. **Ask:** "In which file is [a rule or limit in your code] set, and where is it documented?"
   - Point out: the answer cites a file and a Confluence page, each with its own key.
   - Click a code source: the link is pinned to a commit, so it shows what the assistant saw, even
     after the branch moves.
2. **Ask:** "What does [a configuration option] do?"
   - Point out: a sentence that starts "Based on the code, it looks like…" and a citation marked
     with an asterisk is the assistant's own reading, not a quote.

## 2. Business analyst (1 minute)

3. **Ask:** "What is the rule for [a business rule], and is it already built?"
   - Point out: when the documentation says it is done and the repository does not contain it,
     the answer shows both sides under "Where the documentation and the code disagree", written by
     the application, not the model. The confidence drops to low.

## 3. QA (1 minute)

4. **Ask:** "What cases do we need to test for [a feature]?"
   - Point out: a list from the test documentation, in the QA role's words, and sources for each
     part.

## 4. Product owner (2 minutes)

5. **Ask:** "What does [a feature] do for users, and can we rely on it yet?"
   - Point out: no code, no file paths, no jargon (the style check enforces it, and rewrites the
     answer once if it slips). The sources list uses plain labels.
6. Press **Show more detail** under the answer.
   - Point out: the same question is asked again one step more technical, without changing the role.

## 5. Project manager (1 minute)

7. **Ask:** "Which releases have been published, and when?"
   - Point out: the release list is a source; the dates come from it.
8. **Ask:** "What is the biggest open risk before [next phase]?"
   - Point out: an open decision is reported as open, not settled.

## 6. When it should say no (2 minutes)

9. **Ask (any role):** "What will the release date be next year?"
   - Point out: out of scope. The assistant says that no source can answer, instead of guessing.
10. **Ask:** a question about something plausible that is not documented, such as [a feature your
    project does not have].
    - Point out: "not found", the closest pages, and who might know (from CODEOWNERS). Say that
      "not found" is a correct outcome, not an error.
11. **Ask:** a vague question that fits two things, such as "What is the rate limit?" when two
    services have one.
    - Point out: one short clarifying question. Say honestly that this is the weakest behaviour: in
      the evaluation it often picked one reading instead of asking (see `docs/EVAL_LOG.md`).

## 7. Follow-ups and changed sources (3 minutes)

Use the same conversation as the questions above, or start a new one (**New conversation**).

12. **Ask** a follow-up that builds on an answer, such as "And what happens when that fails?"
    - Point out: the follow-up cites a source by the key it had in the earlier answer, and the
      turn counter ("Turn 2 of 5") under the role picker. Each answer has its own **Sources (n)**
      list, and each source says which turn fetched it.
    - Try changing the role in the middle: the page asks first, because a conversation is for one
      role.
13. Press **Re-check sources** under an answer.
    - Point out: each source gets "✓ checked 1 min ago". The app compared a version number or a
      commit SHA directly; it did not ask the model again.
14. *Optional, needs a second window.* Edit a cited Confluence page (or push a small change to a
    cited file), then press **Re-check sources** again.
    - Point out: the source says **changed since this answer**, the answer shows a warning and its
      confidence drops to medium, and **Re-ask with the latest version** appears. Press it: a new
      answer cites the page under a new key, and the old key stays marked changed.
    - Say that the check also runs by itself for a source reused in a later turn and for every
      source after the last allowed turn, and that "couldn't check" is shown, never "changed", when
      a source cannot be reached.
    - Say that a conversation holds at most five questions (`CONVERSATION_MAX_TURNS`); after that
      the page asks for a new one.

## 8. Close (1 minute)

- Press **Esc** while a question runs, to show that it can be stopped.
- Give a thumbs-down with a comment, and say that it goes to a local file without the answer, and
  can become a test case with `npm run eval:from-feedback`.
- Say the limits: one person, memory for one conversation only, answers take tens of seconds, the assistant's status and
  confidence are partly the model's call. The evaluation behind that is in `docs/EVAL_LOG.md`.

## If something goes wrong

- A question stops with a timeout: ask again, or raise `ASK_TIMEOUT_MS`.
- The answer says nothing was found for something you know exists: check that the page is in
  `CONFLUENCE_SPACE_KEYS`; then see Troubleshooting in the README.
- Nothing loads: check the terminal where `npm start` runs; it prints which setting is wrong.
