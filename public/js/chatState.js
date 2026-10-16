// @ts-check
import { NO_STEPS, recordDraft, recordProgress } from './steps.js';

/** The deepest role depth; a role at it has no more detail to give. */
const MOST_TECHNICAL_DEPTH = 3;

/** Shown when the stream ends before the answer is complete. */
const CONNECTION_LOST = 'The connection closed before the answer finished. Please try again.';

/** Shown for a question of an earlier visit that never got an answer. */
const NO_ANSWER = 'This question did not get an answer.';

/** Shown when the conversation can no longer be found. */
export const CONVERSATION_GONE =
  'That conversation has ended. Your earlier questions are shown below; start a new one to keep going.';

/**
 * What the server sends when a question is answered in a conversation.
 * @typedef {import('../../src/server/conversationView.js').AnswerView & { conversation?: ConversationInfo }} AnswerView
 */

/**
 * Where a conversation stands.
 * @typedef {object} ConversationInfo
 * @property {string} conversationId - The id.
 * @property {string} role - The role id.
 * @property {number} maxTurns - The turn cap.
 * @property {number} turnCount - Questions used so far.
 * @property {'turns' | 'budget' | null} full - Why it can take no more, if so.
 * @property {string | null} fullMessage - What to tell the reader when it is full.
 * @property {string | null} ended - Why it was closed, if it was.
 * @property {number} [roleDepth] - The role's depth, to know whether more detail is possible.
 */

/**
 * One turn of a transcript, as `GET /api/conversations/:id` gives it.
 * @typedef {object} TranscriptTurn
 * @property {number} turn - The turn.
 * @property {string} question - What was asked.
 * @property {'default' | 'more'} detailLevel - The level it was asked at.
 * @property {string} status - How it ended on the server.
 * @property {AnswerView | null} answer - The answer, if it was answered.
 */

/**
 * A conversation read back from the server.
 * @typedef {ConversationInfo & { turns: TranscriptTurn[] }} Transcript
 */

/**
 * What the server sends after sources were checked.
 * @typedef {object} RecheckPayload
 * @property {AnswerView[]} updates - Every answer whose sources were checked, as it now stands.
 * @property {ConversationInfo} [conversation] - Where the conversation stands.
 * @property {boolean} [ignored] - True when a check by hand was asked for too soon after the last.
 */

/**
 * One question and what became of it.
 * @typedef {object} TurnView
 * @property {number} turn - The turn, from 1.
 * @property {string} question - What was asked.
 * @property {'default' | 'more'} detailLevel - The level it was asked at.
 * @property {'running' | 'answered' | 'stopped' | 'failed'} phase - Where it is.
 * @property {ReadonlyArray<import('./steps.js').Step>} steps - What it has done so far, while it runs.
 * @property {string} currentStep - The kind of step in progress, while it runs.
 * @property {string} draft - The answer text streamed so far.
 * @property {AnswerView | undefined} answer - The finished answer.
 * @property {string | undefined} failure - What went wrong, in words for the reader.
 */

/**
 * What the reader has said about an answer.
 * @typedef {{ rating: 'up' | 'down', saved: boolean, message: string }} Rating
 */

/**
 * What the page shows, as plain data. The page draws it; nothing else changes it.
 * @typedef {object} ChatState
 * @property {ConversationInfo | undefined} conversation - The conversation, once there is one.
 * @property {ReadonlyArray<TurnView>} turns - Every question asked, oldest first.
 * @property {string} notice - Something to tell the reader above the conversation.
 * @property {ReadonlyArray<string>} checking - Ids of the answers being re-checked by hand.
 * @property {Readonly<Record<string, Rating>>} ratings - Feedback given, by answer id.
 */

/**
 * Something that happened.
 * @typedef {{ type: 'started', conversation: ConversationInfo }
 *   | { type: 'restored', transcript: Transcript, roleDepth: number }
 *   | { type: 'ask', question: string, detailLevel: 'default' | 'more' }
 *   | { type: 'progress', message: string }
 *   | { type: 'token', text: string }
 *   | { type: 'done', payload: AnswerView }
 *   | { type: 'error', kind: string, message: string, conversation?: ConversationInfo }
 *   | { type: 'stop' }
 *   | { type: 'ended' }
 *   | { type: 'recheck', payload: RecheckPayload }
 *   | { type: 'checking', answerId: string, on: boolean }
 *   | { type: 'conversationState', conversation: ConversationInfo }
 *   | { type: 'gone' }
 *   | { type: 'notice', text: string }
 *   | { type: 'rate', answerId: string, rating: 'up' | 'down' }
 *   | { type: 'rated', answerId: string, saved: boolean, message: string }
 *   | { type: 'reset' }} ChatAction
 */

/**
 * The state before anything is asked.
 * @type {Readonly<ChatState>}
 */
export const INITIAL_CHAT = Object.freeze({
  conversation: undefined,
  turns: Object.freeze([]),
  notice: '',
  checking: Object.freeze([]),
  ratings: Object.freeze({}),
});

/**
 * The turn that is running, if one is.
 * @param {ChatState} state - The state.
 * @returns {TurnView | undefined} The newest turn when it is running.
 */
function runningTurn({ turns }) {
  const newest = turns.at(-1);
  return newest?.phase === 'running' ? newest : undefined;
}

/**
 * Whether a question is being answered right now.
 * @param {ChatState} state - The state.
 * @returns {boolean} True while the newest turn runs.
 */
export function isBusy(state) {
  return runningTurn(state) !== undefined;
}

/**
 * Whether the conversation can take another question: nothing is running, and it is not full or
 * closed. Before the first question there is no conversation yet, and a question can be asked.
 * @param {ChatState} state - The state.
 * @returns {boolean} True when a question can be sent.
 */
export function canAsk(state) {
  const { conversation } = state;
  return (
    !isBusy(state) &&
    (conversation === undefined || (conversation.full === null && conversation.ended === null))
  );
}

/**
 * Whether "Show more detail" is offered for a turn: the newest turn, answered at the usual level,
 * for a role that is not already at the most technical depth, in a conversation that can go on.
 * @param {ChatState} state - The state.
 * @param {TurnView} turn - The turn.
 * @returns {boolean} True when the button should show.
 */
export function canShowMoreDetail(state, turn) {
  return (
    canAsk(state) &&
    turn === state.turns.at(-1) &&
    turn.phase === 'answered' &&
    turn.answer?.result.status === 'answered' &&
    turn.detailLevel === 'default' &&
    (state.conversation?.roleDepth ?? MOST_TECHNICAL_DEPTH) < MOST_TECHNICAL_DEPTH
  );
}

/**
 * Whether "Re-ask with the latest version" is offered for a turn: some source it cites has changed
 * and the conversation can take another question.
 * @param {ChatState} state - The state.
 * @param {TurnView} turn - The turn.
 * @returns {boolean} True when the button should show.
 */
export function canReask(state, turn) {
  return canAsk(state) && (turn.answer?.changedKeys.length ?? 0) > 0;
}

/**
 * Reads a text field from data of unknown shape.
 * @param {unknown} data - The parsed data.
 * @param {string} key - The field.
 * @returns {string} The field when it is text, otherwise an empty string.
 */
function textOf(data, key) {
  const value = typeof data === 'object' && data !== null ? Reflect.get(data, key) : undefined;
  return typeof value === 'string' ? value : '';
}

/**
 * Reads where the conversation stands out of event data, if it is there.
 * @param {unknown} data - The parsed data.
 * @returns {ConversationInfo | undefined} The state, or undefined.
 */
function conversationOf(data) {
  const value =
    typeof data === 'object' && data !== null ? Reflect.get(data, 'conversation') : undefined;
  return typeof value === 'object' && value !== null
    ? /** @type {ConversationInfo} */ (value)
    : undefined;
}

/**
 * Turns an event from the server into an action. An event it does not know gives undefined.
 * @param {{ event: string, data: unknown }} message - The event, with its data parsed.
 * @returns {ChatAction | undefined} The action, or undefined for an unknown event.
 */
export function fromServerEvent({ event, data }) {
  switch (event) {
    case 'progress':
      return { type: 'progress', message: textOf(data, 'message') };
    case 'token':
      return { type: 'token', text: textOf(data, 'text') };
    case 'done':
      return { type: 'done', payload: /** @type {AnswerView} */ (data) };
    case 'error':
      return {
        type: 'error',
        kind: textOf(data, 'kind') || 'internal',
        message: textOf(data, 'message'),
        conversation: conversationOf(data),
      };
    case 'recheck':
      return { type: 'recheck', payload: /** @type {RecheckPayload} */ (data) };
    default:
      return undefined;
  }
}

/**
 * Changes the newest turn.
 * @param {ChatState} state - The state.
 * @param {(turn: TurnView) => TurnView} change - How to change it.
 * @returns {ChatState} The state with the turn changed.
 */
function changeNewest(state, change) {
  // Only called while a turn is running, so there is a newest turn.
  const newest = /** @type {TurnView} */ (state.turns.at(-1));
  return { ...state, turns: [...state.turns.slice(0, -1), change(newest)] };
}

/**
 * Merges where the conversation stands into what is known, keeping what the server does not send.
 * @param {ChatState} state - The state.
 * @param {ConversationInfo | undefined} incoming - What the server said.
 * @returns {ConversationInfo | undefined} The merged state.
 */
function mergeConversation(state, incoming) {
  return incoming === undefined ? state.conversation : { ...state.conversation, ...incoming };
}

/**
 * Where a turn of a transcript got to.
 * @param {TranscriptTurn} entry - A turn from the transcript.
 * @returns {TurnView['phase']} Its phase.
 */
function phaseOf(entry) {
  if (entry.answer !== null) {
    return 'answered';
  }
  return entry.status === 'cancelled' ? 'stopped' : 'failed';
}

/**
 * Builds a turn from a transcript entry.
 * @param {TranscriptTurn} entry - A turn from the transcript.
 * @returns {TurnView} The turn.
 */
function fromTranscript(entry) {
  const phase = phaseOf(entry);
  return {
    turn: entry.turn,
    question: entry.question,
    detailLevel: entry.detailLevel,
    phase,
    ...NO_STEPS,
    draft: '',
    answer: entry.answer ?? undefined,
    failure: phase === 'failed' ? NO_ANSWER : undefined,
  };
}

/**
 * Reads where the conversation stands out of a transcript.
 * @param {Transcript} transcript - What `GET /api/conversations/:id` gave.
 * @returns {ConversationInfo} The state, without the depth of the role, which the server does not say.
 */
export function conversationFromTranscript(transcript) {
  const { conversationId, role, maxTurns, turnCount, full, fullMessage, ended } = transcript;
  return { conversationId, role, maxTurns, turnCount, full, fullMessage, ended };
}

/**
 * Applies the answers a re-check rebuilt.
 * @param {ChatState} state - The state.
 * @param {RecheckPayload} payload - What the server sent.
 * @returns {ChatState} The state.
 */
function applyRecheck(state, { updates, conversation }) {
  const byId = new Map(updates.map((update) => [update.answerId, update]));
  return {
    ...state,
    conversation: mergeConversation(state, conversation),
    turns: state.turns.map((turn) => {
      const update = turn.answer === undefined ? undefined : byId.get(turn.answer.answerId);
      return update === undefined ? turn : { ...turn, answer: update };
    }),
  };
}

/**
 * Ends the running turn without an answer.
 * @param {ChatState} state - The state.
 * @param {'stopped' | 'failed'} phase - How it ended.
 * @param {string | undefined} failure - What to say, for a failure.
 * @returns {ChatState} The state.
 */
function endRunning(state, phase, failure) {
  return changeNewest(state, (turn) => ({ ...turn, phase, ...NO_STEPS, failure }));
}

/**
 * Works out the next state. Pure. Events that arrive when they no longer matter, such as a token
 * after Stop, change nothing.
 * @param {ChatState} state - The state now.
 * @param {ChatAction} action - What happened.
 * @returns {ChatState} The next state; the same object when nothing changed.
 */
export function next(state, action) {
  switch (action.type) {
    case 'started':
      return { ...INITIAL_CHAT, conversation: action.conversation };
    case 'restored':
      return {
        ...INITIAL_CHAT,
        conversation: {
          ...conversationFromTranscript(action.transcript),
          roleDepth: action.roleDepth,
        },
        turns: action.transcript.turns.map(fromTranscript),
      };
    case 'reset':
      return INITIAL_CHAT;
    case 'conversationState':
      return { ...state, conversation: mergeConversation(state, action.conversation) };
    case 'gone':
      return {
        ...state,
        conversation: state.conversation && { ...state.conversation, ended: 'gone' },
        notice: CONVERSATION_GONE,
      };
    case 'notice':
      return { ...state, notice: action.text };
    case 'checking':
      return {
        ...state,
        checking: action.on
          ? [...state.checking.filter((id) => id !== action.answerId), action.answerId]
          : state.checking.filter((id) => id !== action.answerId),
      };
    case 'recheck':
      return applyRecheck(state, action.payload);
    case 'rate':
      return {
        ...state,
        ratings: {
          ...state.ratings,
          [action.answerId]: { rating: action.rating, saved: false, message: '' },
        },
      };
    case 'rated': {
      const current = state.ratings[action.answerId];
      return current === undefined
        ? state
        : {
            ...state,
            ratings: {
              ...state.ratings,
              [action.answerId]: { ...current, saved: action.saved, message: action.message },
            },
          };
    }
    case 'ask':
      return isBusy(state)
        ? state
        : {
            ...state,
            notice: '',
            turns: [
              ...state.turns,
              {
                turn: (state.conversation?.turnCount ?? state.turns.length) + 1,
                question: action.question,
                detailLevel: action.detailLevel,
                phase: 'running',
                ...NO_STEPS,
                draft: '',
                answer: undefined,
                failure: undefined,
              },
            ],
          };
    default:
      return nextWhileRunning(state, action);
  }
}

/**
 * Works out the steps of a turn after something happened, keeping nothing else of the turn.
 * @param {(progress: import('./steps.js').StepProgress, ...rest: string[]) => import('./steps.js').StepProgress} record - What takes it in.
 * @param {TurnView} turn - The running turn.
 * @param {string[]} rest - What happened.
 * @returns {import('./steps.js').StepProgress} The steps and the one in progress.
 */
function stepsAfter(record, turn, ...rest) {
  const { steps, currentStep } = record(
    { steps: turn.steps, currentStep: turn.currentStep },
    ...rest,
  );
  return { steps, currentStep };
}

/**
 * Applies what happens to the turn that is running.
 * @param {ChatState} state - The state now.
 * @param {ChatAction} action - What happened.
 * @returns {ChatState} The next state.
 */
function nextWhileRunning(state, action) {
  if (!isBusy(state)) {
    return state;
  }
  switch (action.type) {
    case 'progress':
      return changeNewest(state, (turn) => ({
        ...turn,
        ...stepsAfter(recordProgress, turn, action.message),
      }));
    case 'token':
      return changeNewest(state, (turn) => ({
        ...turn,
        draft: turn.draft + action.text,
        ...stepsAfter(recordDraft, turn),
      }));
    case 'done': {
      const { conversation, ...answer } = action.payload;
      return {
        ...changeNewest(state, (turn) => ({
          ...turn,
          turn: answer.turn,
          phase: 'answered',
          ...NO_STEPS,
          answer,
        })),
        conversation: mergeConversation(state, conversation),
      };
    }
    case 'error':
      return {
        ...endRunning(
          state,
          action.kind === 'cancelled' ? 'stopped' : 'failed',
          action.kind === 'cancelled' ? undefined : action.message,
        ),
        conversation: mergeConversation(state, action.conversation),
      };
    case 'stop':
      return endRunning(state, 'stopped', undefined);
    case 'ended':
      return endRunning(state, 'failed', CONNECTION_LOST);
    default:
      return state;
  }
}
