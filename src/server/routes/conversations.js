// @ts-check
import { FULL_MESSAGE } from '../../conversation/index.js';
import { createMetaStreamFilter } from '../../render/index.js';
import {
  citedKeysOf,
  describeAnswer,
  describeConversation,
  describeTranscript,
  findAnswerTurn,
  wasAnswered,
} from '../conversationView.js';
import { describeFailure } from '../failure.js';
import { SECURITY_HEADERS } from '../headers.js';
import { toolEventToProgress } from '../progress.js';
import { openEventStream } from '../sse.js';
import { MAX_QUESTION_LENGTH } from './ask.js';

const NOT_FOUND = 404;
const CONFLICT = 409;
const TOO_MANY_REQUESTS = 429;

/** The shape of a conversation or answer id this server hands out. */
const UUID = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

/** Matches a question that has something other than white space in it. */
const HAS_TEXT = '\\S';

const ENDED = Object.freeze({
  code: 'conversation_ended',
  message: 'That conversation has ended. Start a new one to keep going.',
});
const UNKNOWN_ANSWER = Object.freeze({
  code: 'answer_not_found',
  message: 'That answer is not part of this conversation.',
});
const BUSY = Object.freeze({
  code: 'conversation_busy',
  message: 'The conversation is still answering the last question. Please wait for it to finish.',
});
const FULL = Object.freeze({ code: 'conversation_full', message: FULL_MESSAGE });
const RECHECK_BUSY = Object.freeze({
  code: 'recheck_busy',
  message: 'Other checks are running. Please try again in a moment.',
});

const PARAMS_SCHEMA = Object.freeze({
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: UUID } },
});

/** A body with nothing in it. Clients send `{}`, because a JSON request may not be empty. */
const EMPTY_BODY_SCHEMA = Object.freeze({ type: 'object', additionalProperties: false });

const RECHECK_BODY_SCHEMA = Object.freeze({
  type: 'object',
  required: ['answerId'],
  additionalProperties: false,
  properties: { answerId: { type: 'string', pattern: UUID } },
});

/**
 * What the conversation routes need, all injected.
 * @typedef {object} ConversationRouteDeps
 * @property {ReadonlyMap<string, import('../../roles/index.js').Role>} roles - The loaded roles.
 * @property {import('../../conversation/index.js').ConversationStore} store - The conversations.
 * @property {{ ask: (conversation: import('../../conversation/index.js').Conversation, input: import('../../conversation/index.js').TurnInput) => Promise<import('../../answer/index.js').AskResult & { turn: number }> }} runner -
 *   Asks a question in a conversation.
 * @property {import('../recheckService.js').RecheckService} recheck - Checks sources for changes.
 * @property {import('../answers.js').AnswerMemory} answers - Where answers are remembered for feedback.
 * @property {(markdown: string) => string} renderHtml - Turns markdown into safe HTML.
 * @property {Pick<import('../../logger/index.js').Logger, 'info' | 'warn' | 'error'>} logger - Where to log.
 */

/**
 * Builds what the page is told after sources were checked: what each check found, and every answer
 * whose sources were checked, as it now stands.
 * @param {import('../../conversation/index.js').Conversation} conversation - The conversation.
 * @param {import('../recheckService.js').RecheckOutcome} outcome - What came of the check.
 * @param {(markdown: string) => string} renderHtml - Turns markdown into safe HTML.
 * @param {string[]} [alwaysShow] - Answer ids to include even when no check touched them.
 * @returns {object} The payload.
 */
function buildRecheckPayload(conversation, outcome, renderHtml, alwaysShow = []) {
  const checked = new Set(outcome.kind === 'done' ? outcome.results.map(({ key }) => key) : []);
  const updates = conversation
    .turns()
    .filter(wasAnswered)
    .filter(
      (record) =>
        alwaysShow.includes(String(record.outcome?.answerId)) ||
        citedKeysOf(record).some((key) => checked.has(key)),
    )
    .map((record) => describeAnswer(conversation, record, renderHtml));
  return {
    skipped: outcome.kind === 'done' ? null : outcome.kind,
    checks: outcome.kind === 'done' ? outcome.results : [],
    changedKeys: outcome.kind === 'done' ? outcome.changedKeys : [],
    updates,
    conversation: describeConversation(conversation),
  };
}

/**
 * Registers the conversation routes: start one, ask in it (streamed), read it back, check its
 * sources again, and end it. Each id is checked to be a UUID before it is looked up.
 * @param {import('fastify').FastifyInstance} app - The app.
 * @param {ConversationRouteDeps} deps - Dependencies.
 */
export function registerConversationRoutes(
  app,
  { roles, store, runner, recheck, answers, renderHtml, logger },
) {
  /**
   * Finds the live conversation of a request, noting that it was used.
   * @param {import('fastify').FastifyRequest} request - The request.
   * @returns {import('../../conversation/index.js').Conversation | undefined} The conversation.
   */
  function find(request) {
    const conversation = store.get(/** @type {{ id: string }} */ (request.params).id);
    conversation?.touch();
    return conversation;
  }

  app.post(
    '/api/conversations',
    {
      schema: {
        body: {
          type: 'object',
          required: ['role'],
          additionalProperties: false,
          properties: { role: { type: 'string', enum: [...roles.keys()] } },
        },
      },
    },
    async (request) => {
      const { role: roleId } = /** @type {{ role: string }} */ (request.body);
      const role = /** @type {import('../../roles/index.js').Role} */ (roles.get(roleId));
      const conversation = await store.create({ role });
      return { conversationId: conversation.id, maxTurns: conversation.maxTurns };
    },
  );

  app.get(
    '/api/conversations/:id',
    { schema: { params: PARAMS_SCHEMA } },
    async (request, reply) => {
      const conversation = find(request);
      return conversation === undefined
        ? reply.code(NOT_FOUND).send(ENDED)
        : describeTranscript(conversation, renderHtml);
    },
  );

  app.delete(
    '/api/conversations/:id',
    { schema: { params: PARAMS_SCHEMA, body: EMPTY_BODY_SCHEMA } },
    async (request, reply) => {
      const { id } = /** @type {{ id: string }} */ (request.params);
      return (await store.remove(id)) ? { deleted: true } : reply.code(NOT_FOUND).send(ENDED);
    },
  );

  app.post(
    '/api/conversations/:id/recheck',
    { schema: { params: PARAMS_SCHEMA, body: RECHECK_BODY_SCHEMA } },
    async (request, reply) => {
      const conversation = find(request);
      if (conversation === undefined) {
        return reply.code(NOT_FOUND).send(ENDED);
      }
      const { answerId } = /** @type {{ answerId: string }} */ (request.body);
      const record = findAnswerTurn(conversation, answerId);
      if (record === undefined || !wasAnswered(record)) {
        return reply.code(NOT_FOUND).send(UNKNOWN_ANSWER);
      }
      const outcome = await recheck.manual(conversation, citedKeysOf(record));
      if (outcome.kind === 'busy') {
        return reply.code(TOO_MANY_REQUESTS).send(RECHECK_BUSY);
      }
      return {
        ignored: outcome.kind === 'ignored',
        ...buildRecheckPayload(conversation, outcome, renderHtml, [answerId]),
      };
    },
  );

  app.post(
    '/api/conversations/:id/messages',
    {
      schema: {
        params: PARAMS_SCHEMA,
        body: {
          type: 'object',
          required: ['question'],
          additionalProperties: false,
          properties: {
            question: {
              type: 'string',
              minLength: 1,
              maxLength: MAX_QUESTION_LENGTH,
              pattern: HAS_TEXT,
            },
            detailLevel: { type: 'string', enum: ['default', 'more'], default: 'default' },
            reaskAnswerId: { type: 'string', pattern: UUID },
          },
        },
      },
    },
    async (request, reply) => {
      const conversation = find(request);
      if (conversation === undefined || conversation.endedReason() !== undefined) {
        return reply.code(NOT_FOUND).send(ENDED);
      }
      if (conversation.isBusy()) {
        return reply.code(TOO_MANY_REQUESTS).send(BUSY);
      }
      if (conversation.fullReason() !== undefined) {
        return reply.code(CONFLICT).send(FULL);
      }
      const { question, detailLevel, reaskAnswerId } =
        /** @type {{ question: string, detailLevel: 'default' | 'more', reaskAnswerId?: string }} */ (
          request.body
        );
      const changedKeys = changedKeysFor(conversation, reaskAnswerId);
      if (changedKeys === undefined) {
        return reply.code(NOT_FOUND).send(UNKNOWN_ANSWER);
      }
      reply.hijack();
      await streamTurn(reply.raw, {
        conversation,
        input: { question: question.trim(), detailLevel, changedKeys },
      });
      return reply;
    },
  );

  /**
   * Finds the sources of an earlier answer that have changed, for a "re-ask with the latest
   * version". The keys come from the server's own record, never from the request.
   * @param {import('../../conversation/index.js').Conversation} conversation - The conversation.
   * @param {string | undefined} answerId - The answer being asked again, if any.
   * @returns {string[] | undefined} The changed keys (none for an ordinary question), or undefined when the answer is unknown.
   */
  function changedKeysFor(conversation, answerId) {
    if (answerId === undefined) {
      return [];
    }
    const record = findAnswerTurn(conversation, answerId);
    return record === undefined || !wasAnswered(record)
      ? undefined
      : citedKeysOf(record).filter((key) => conversation.registry.get(key)?.changed === true);
  }

  /**
   * Answers one question onto an event stream: progress and tokens, then `done` as soon as the
   * answer is ready, then (separately) `recheck` once the due sources have been checked, and the
   * stream closes. The check never delays the answer.
   * @param {import('http').ServerResponse} response - The raw response.
   * @param {{ conversation: import('../../conversation/index.js').Conversation, input: import('../../conversation/index.js').TurnInput }} turn - The conversation and the question.
   */
  async function streamTurn(response, { conversation, input }) {
    const stream = openEventStream(response, SECURITY_HEADERS);
    const controller = new AbortController();
    stream.onDisconnect(() => {
      logger.info({}, 'the client went away; stopping the turn');
      controller.abort();
    });
    const filter = createMetaStreamFilter();
    try {
      const result = await runner.ask(conversation, {
        ...input,
        signal: controller.signal,
        onActivity: (activity) =>
          stream.send('progress', {
            kind: activity.kind,
            message: toolEventToProgress(activity, conversation.role),
          }),
        onDelta: (text) => {
          const visible = filter.push(text);
          if (visible !== '') {
            stream.send('token', { text: visible });
          }
        },
      });
      const answerId = answers.remember({
        question: input.question,
        role: result.role,
        detailLevel: result.detailLevel,
        status: result.status,
        confidence: result.confidence,
        citedKeys: result.sources.map(({ key }) => key),
        model: result.model,
        turn: result.turn,
        conversationTurns: conversation.turnCount(),
      });
      conversation.annotateTurn(result.turn, { answerId });
      const record = /** @type {import('../../conversation/index.js').TurnRecord} */ (
        conversation.turns().find(({ turn }) => turn === result.turn)
      );
      stream.finish(
        'done',
        {
          ...describeAnswer(conversation, record, renderHtml),
          conversation: describeConversation(conversation),
        },
        { keepOpen: true },
      );
      await sendRecheck(stream, conversation, result.turn);
    } catch (error) {
      const failure = describeFailure(error);
      if (failure.kind === 'cancelled') {
        logger.info({}, 'the turn was stopped');
      } else {
        logger.error({ err: error, kind: failure.kind }, 'the turn failed');
      }
      stream.finish('error', { ...failure, conversation: describeConversation(conversation) });
    }
    stream.end();
  }

  /**
   * Checks the sources that are due after a turn and tells the page, if it is still there.
   * @param {import('../sse.js').EventStream} stream - The stream, still open after `done`.
   * @param {import('../../conversation/index.js').Conversation} conversation - The conversation.
   * @param {number} turn - The turn just answered.
   */
  async function sendRecheck(stream, conversation, turn) {
    if (!stream.isOpen()) {
      return;
    }
    const outcome = await recheck.auto(conversation, turn);
    stream.send('recheck', buildRecheckPayload(conversation, outcome, renderHtml));
  }
}
