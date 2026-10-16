# Demo script (10 minutes, for a manager)

A walkthrough for showing the assistant to someone who has not seen it. It assumes the setup in
the README is done, `npm start` is running and the page is open at `http://127.0.0.1:3000`.

Answers take a while (the typical range the page itself shows is 1–3 minutes), so this script is
built around the waiting. It uses **four live questions**, picked because they were among the
fastest in the evaluation that show something worth showing, and it uses the time while each runs
to explain the step list. The seconds next to each question are the time it took in the last full
evaluation run (`20261014-190623`, conversation path; see [EVAL_LOG.md](EVAL_LOG.md)). Yours will
differ, so rehearse first and expect up to double.

The questions are real ones about this project's own Confluence and GitHub content, not patterns.
If your content differs, pick questions for the same four purposes (a sourced answer, out of
scope, a changed source, not found) and note their timings.

| # | Role | Conversation | Question | Shows | Eval time |
| --- | --- | --- | --- | --- | --- |
| 1 | Product Owner | 1 | How does the product choose short-term picks? (the third **Try asking** suggestion) | a sourced answer with a confidence level, the step list, citations | about 75 s |
| 2 | Product Owner | 1 | What is the weather like tomorrow? | out of scope | about 25 s |
| 3 | Business Analyst | 2 | Which service supplies the currency exchange rates the system uses? | not found, and where it looked | about 80 s |

A changed-source re-check, between questions 1 and 2, needs no question and no Copilot request. In
all, three Copilot requests, about 3 minutes of waiting.

## Before you start

Do this once, ahead of the demo.

1. **Rehearse questions 1 to 3** so you know the answers and which Confluence page question 1 cites
   (open **Sources** and note the page title).
2. **Prepare the changed source.** Pick a Confluence page that question 1 cites, in a space where
   an extra version does no harm. Have it open in a second window, ready to edit: a one-word change
   to a sentence, then publish. During the demo the edit is made after question 1 has been
   answered. Undo it afterwards if it matters.
3. Start with a fresh page: **New conversation**, or clear the browser's session storage, so the
   welcome screen shows.
4. Open the page at 1440 pixels wide or full screen. Keep the README's phone screenshot at hand
   in case someone asks about small screens.

## 1. Introduction (1 minute)

- Say what it is: a local assistant that answers from Confluence and GitHub, read-only, and says
  how sure it is. It runs on one machine for one person.
- Point at **Answering as** in the sidebar: five roles. The same question gets different answers
  for a developer and a product owner.
- Point at the three tiles: every answer is sourced, says how sure it is, admits what it cannot
  find. The rest of the demo shows each one.
- Point at **Try asking**: questions that are known to work for the chosen role. Click one: it
  fills the box and does not send.

## 2. A sourced answer (3 minutes)

**Conversation 1 · Product Owner.** Choose **Product Owner**, click **How does the product choose
short-term picks?** and press **Ask**. (About 75 seconds.)

While it runs, talk through the **step list** under the question:

- "Searched Confluence", "Read 2 Confluence pages", "Searched the code", "Reading a file from
  GitHub": these are the real tool calls, not an animation. A tick means done, the spinner is the
  current step.
- "Writing and checking the answer" is last, and the longest. Explain that the draft shown in
  grey is **not checked yet**: the application checks every citation and works out the confidence
  itself before showing the real answer.
- Point at the box under the question: **Stop**, and "Most answers take 1–3 minutes".

When the answer arrives:

- Point at the **confidence pill** and the reason under it. This one is often *medium*: it says
  why. The confidence is worked out by the application, not claimed by the model.
- Point at the Product Owner's wording: no code, no file paths. The style check enforces it.
- Click a **citation chip** (`C1`): it opens **Sources (n)** and highlights that source. Each
  source says where it came from and in which turn it was fetched.
- Point at **What I'm not sure about**: the gaps are listed, not hidden.

## 3. A changed source (1 minute)

Still in conversation 1.

1. In the second window, make the prepared edit to the cited Confluence page and publish it.
2. Back on the page, press **Re-check sources** (in the open Sources list). No Copilot request is
   made: the application compares the page's version number directly. (If you have not edited, each
   source shows "✓ checked just now".)
3. Point out what appears: the source says **changed since this answer**, the answer gets an amber
   banner, its confidence drops to *medium*, and **Re-ask with the latest version** is offered.
   Say that pressing it asks again and fetches the page under a new key. Do not press it unless
   there is time: it is another request of about a minute.
4. Say that the same check runs by itself for a source reused in a later turn and for every source
   after the last allowed turn, and that a source that cannot be reached shows "couldn't check",
   never "changed".

## 4. When it should say no (1 minute)

Still in conversation 1, still **Product Owner**. Ask **What is the weather like tomorrow?** (About
25 seconds, the fastest.)

- Point out the grey pill **Outside what I can answer**. The assistant says no source can answer,
  instead of guessing.
- Say that this is a correct outcome, not an error. Note that this question and the previous one
  are the same conversation: the sidebar says "Turn 2 of 5".

## 5. Changing the role starts a new conversation (1 minute)

- Point at the lock beside **Product Owner** and the note: "Role is locked for this conversation.
  Changing it starts a new one." A conversation is for one role, so an answer is never written
  for one audience and then explained to another.
- Press **New conversation**. The welcome screen returns. Choose **Business Analyst**: the
  **Try asking** questions change with the role.

## 6. Not found (2 minutes)

**Conversation 2 · Business Analyst.** Ask **Which service supplies the currency exchange rates
the system uses?** (About 80 seconds.)

While it runs, say that this is a question the documentation does not answer, and that the point is
whether the assistant admits it.

- Point out the pill **Not found in the docs** and the one sentence under it. There is no invented
  service name and no sources list.
- Point at **Where I looked**: the pages and folders it checked, so the person knows the search
  was not careless. If **Who might know** appears, say it comes from CODEOWNERS.
- Say that "not found" is a correct outcome too.

## 7. Close (2 minutes)

- Press **Copy this conversation** in the sidebar. A message says "Conversation copied". Paste it
  into any document: every question, the answer with its citation keys, the confidence and why, and
  a list of sources with links. Say it is for handing a conversation to someone else.
- Give a thumbs-down with a comment, and say that it goes to a local file without the answer, and
  can become a test case with `npm run eval:from-feedback`.
- Say the limits: one person, one conversation at a time, memory for one conversation only (at most
  five questions), answers take tens of seconds to a few minutes, and the status and confidence
  are partly the model's call. The measurements behind that are in [EVAL_LOG.md](EVAL_LOG.md).

## Optional extras, if there is time

- **Show more detail** under the Product Owner's answer: the same question again, one step more
  technical, without changing the role. About a minute.
- **The end of a conversation.** Start the server with `CONVERSATION_MAX_TURNS=2` and ask two
  questions: a card replaces the question box, says why, shows the final check of every source and
  offers **Start a new conversation**.
- **Stop.** Press **Esc** while a question runs. The conversation stays open.
- **The phone layout.** Make the window 390 pixels wide: the sidebar becomes a menu.

## If something goes wrong

- A question stops with a timeout: ask again, or raise `ASK_TIMEOUT_MS`.
- Question 3 comes back as an answer, not "not found": use the fallback instead, **Can users sign in
  with single sign-on?** as Product Owner. It was not found in the evaluation too, but takes about
  165 seconds, and starting it in conversation 2 means choosing Product Owner again.
- The answer says nothing was found for something you know exists: check that the page is in
  `CONFLUENCE_SPACE_KEYS`; then see Troubleshooting in the README.
- Nothing loads: check the terminal where `npm start` runs; it prints which setting is wrong.
