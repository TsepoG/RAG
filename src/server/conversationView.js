// @ts-check
import { applySourceChangeCap } from '../honesty/index.js';
import { FULL_MESSAGE } from '../conversation/index.js';
import { buildDonePayload } from './donePayload.js';

/**
 * Where a conversation stands, for the page's header and its input.
 * @typedef {object} ConversationState
 * @property {string} conversationId - The id.
 * @property {string} role - The role id it was started with.
 * @property {number} maxTurns - The turn cap.
 * @property {number} turnCount - Turns started so far.
 * @property {'turns' | 'budget' | null} full - Why it can take no more questions, if so.
 * @property {string | null} fullMessage - What to tell the reader when it is full.
 * @property {string | null} ended - Why it was closed, if it was.
 */

/**
 * What the page knows about one source of an answer in a conversation.
 * @typedef {object} SourceState
 * @property {string} key - The citation key.
 * @property {number | undefined} fetchedInTurn - The turn it was first fetched in.
 * @property {number | undefined} fetchedAt - When, in ms.
 * @property {boolean} changed - Whether a later fetch or a re-check found it changed.
 * @property {import('../conversation/index.js').SourceCheck | null} check - The latest re-check, if any.
 */

/**
 * An answer as the page shows it in a conversation: the same payload as a single question, with
 * the turn and what is known about each source it cites.
 * @typedef {import('./donePayload.js').DonePayload & {
 *   turn: number,
 *   changedKeys: string[],
 *   sourceStates: SourceState[],
 * }} AnswerView
 */

/**
 * Describes where a conversation stands.
 * @param {import('../conversation/index.js').Conversation} conversation - The conversation.
 * @returns {ConversationState} Its state.
 */
export function describeConversation(conversation) {
  const full = conversation.fullReason() ?? null;
  return {
    conversationId: conversation.id,
    role: conversation.role.id,
    maxTurns: conversation.maxTurns,
    turnCount: conversation.turnCount(),
    full,
    fullMessage: full === null ? null : FULL_MESSAGE,
    ended: conversation.endedReason() ?? null,
  };
}

/**
 * Finds the turn that gave an answer.
 * @param {import('../conversation/index.js').Conversation} conversation - The conversation.
 * @param {string} answerId - The answer id the server handed out.
 * @returns {import('../conversation/index.js').TurnRecord | undefined} The turn, if there is one.
 */
export function findAnswerTurn(conversation, answerId) {
  return conversation.turns().find((record) => record.outcome?.answerId === answerId);
}

/**
 * The result a turn was answered with.
 * @param {import('../conversation/index.js').TurnRecord} record - An answered turn.
 * @returns {import('../answer/index.js').AskResult} Its result.
 */
function resultOf(record) {
  return /** @type {import('../answer/index.js').AskResult} */ (record.outcome?.result);
}

/**
 * The keys an answered turn cites.
 * @param {import('../conversation/index.js').TurnRecord} record - An answered turn.
 * @returns {string[]} The keys.
 */
export function citedKeysOf(record) {
  return resultOf(record).sources.map(({ key }) => key);
}

/**
 * Builds the answer of one turn as the page shows it now. A source that has changed since the
 * answer was written caps the answer at medium; the cap is worked out here from the stored result
 * each time, so a check that finds nothing changed leaves no cap behind.
 * @param {import('../conversation/index.js').Conversation} conversation - The conversation.
 * @param {import('../conversation/index.js').TurnRecord} record - An answered turn.
 * @param {(markdown: string) => string} renderHtml - Turns markdown into safe HTML.
 * @returns {AnswerView} The answer.
 */
export function describeAnswer(conversation, record, renderHtml) {
  const result = resultOf(record);
  const keys = citedKeysOf(record);
  const changedKeys = keys.filter((key) => conversation.registry.get(key)?.changed === true);
  const answerId = /** @type {string} */ (record.outcome?.answerId);
  const payload = buildDonePayload({
    answerId,
    result: applySourceChangeCap(result, changedKeys),
    role: conversation.role,
    renderHtml,
  });
  return {
    ...payload,
    turn: record.turn,
    changedKeys,
    sourceStates: keys.map((key) => {
      const source = conversation.registry.get(key);
      return {
        key,
        fetchedInTurn: source?.fetchedInTurn,
        fetchedAt: source?.fetchedAt,
        changed: source?.changed === true,
        check: conversation.checks.get(key) ?? null,
      };
    }),
  };
}

/**
 * Whether a turn was answered, and so has an answer to show.
 * @param {import('../conversation/index.js').TurnRecord} record - A turn.
 * @returns {boolean} True when it was answered.
 */
export function wasAnswered(record) {
  return record.status === 'answered' && record.outcome?.answerId !== undefined;
}

/**
 * Describes a whole conversation for a page that is reloading: where it stands, and each turn with
 * its answer as it is now.
 * @param {import('../conversation/index.js').Conversation} conversation - The conversation.
 * @param {(markdown: string) => string} renderHtml - Turns markdown into safe HTML.
 * @returns {ConversationState & { turns: Array<{ turn: number, question: string, detailLevel: string, status: string, answer: AnswerView | null }> }} The transcript.
 */
export function describeTranscript(conversation, renderHtml) {
  return {
    ...describeConversation(conversation),
    turns: conversation.turns().map((record) => ({
      turn: record.turn,
      question: record.question,
      detailLevel: record.detailLevel,
      status: record.status,
      answer: wasAnswered(record) ? describeAnswer(conversation, record, renderHtml) : null,
    })),
  };
}
