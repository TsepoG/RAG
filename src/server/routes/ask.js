// @ts-check
import { createMetaStreamFilter } from '../../render/index.js';
import { buildDonePayload } from '../donePayload.js';
import { describeFailure } from '../failure.js';
import { SECURITY_HEADERS } from '../headers.js';
import { toolEventToProgress } from '../progress.js';
import { openEventStream } from '../sse.js';
import { SIGN_IN_REQUIRED, UNAUTHORIZED } from './atlassianAuth.js';

/**
 * The body of an ask request, once the schema has checked it.
 * @typedef {{ question: string, role: string, detailLevel: 'default' | 'more' }} RequestBody
 */

/** Longest question accepted, in characters. */
export const MAX_QUESTION_LENGTH = 2000;

/** HTTP status for a question that arrives while another is being answered. */
const TOO_MANY_REQUESTS = 429;

/** Matches a question that has something other than white space in it. */
const HAS_TEXT = '\\S';

/**
 * What the ask route needs, all injected.
 * @typedef {object} AskRouteDeps
 * @property {ReadonlyMap<string, import('../../roles/index.js').Role>} roles - The loaded roles.
 * @property {(input: import('../../answer/index.js').AskInput) => Promise<import('../../answer/index.js').AskResult>} ask
 *   Answers a question; `askQuestion` with its dependencies bound.
 * @property {import('../answers.js').AnswerMemory} answers - Where answers are remembered for feedback.
 * @property {(markdown: string) => string} renderHtml - Turns markdown into safe HTML.
 * @property {Pick<import('../../logger/index.js').Logger, 'info' | 'warn' | 'error'>} logger - Where to log.
 * @property {() => Promise<boolean>} [isSignedIn] - In oauth mode, whether someone is signed in to
 *   Atlassian; a question is refused with a 401 until they are. Absent in the other modes.
 * @property {import('./githubAuth.js').GithubAuth} [githubAuth] - The GitHub side; in gh-cli mode a
 *   question is refused with a 401 while the GitHub CLI has no token.
 */

/**
 * Builds the body schema for the route.
 * @param {ReadonlyArray<string>} roleIds - The ids a request may name.
 * @returns {object} A JSON schema.
 */
function bodySchema(roleIds) {
  return {
    type: 'object',
    required: ['question', 'role'],
    additionalProperties: false,
    properties: {
      question: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_QUESTION_LENGTH,
        pattern: HAS_TEXT,
      },
      role: { type: 'string', enum: [...roleIds] },
      detailLevel: { type: 'string', enum: ['default', 'more'], default: 'default' },
    },
  };
}

/**
 * Remembers what a feedback request may refer to.
 * @param {import('../answers.js').AnswerMemory} answers - The memory.
 * @param {string} question - What was asked.
 * @param {import('../../answer/index.js').AskResult} result - The answer.
 * @returns {string} The id of the answer.
 */
function rememberAnswer(answers, question, result) {
  return answers.remember({
    question,
    role: result.role,
    detailLevel: result.detailLevel,
    status: result.status,
    confidence: result.confidence,
    citedKeys: result.sources.map(({ key }) => key),
    model: result.model,
  });
}

/**
 * Registers `POST /api/ask`: one question at a time, answered as a Server-Sent Events stream of
 * `progress` and `token` events that ends with exactly one `done` or `error`. The model's
 * answer-meta block is removed from the tokens. If the client goes away the question is stopped.
 * @param {import('fastify').FastifyInstance} app - The app.
 * @param {AskRouteDeps} deps - Dependencies.
 */
export function registerAskRoute(
  app,
  { roles, ask, answers, renderHtml, logger, isSignedIn, githubAuth },
) {
  let busy = false;
  app.post(
    '/api/ask',
    { schema: { body: bodySchema([...roles.keys()]) } },
    async (request, reply) => {
      const { question, role: roleId, detailLevel } = /** @type {RequestBody} */ (request.body);
      if (isSignedIn !== undefined && !(await isSignedIn())) {
        return reply.code(UNAUTHORIZED).send(SIGN_IN_REQUIRED);
      }
      const refusal = await githubAuth?.refusal();
      if (refusal !== undefined) {
        return reply.code(UNAUTHORIZED).send(refusal);
      }
      if (busy) {
        return reply
          .code(TOO_MANY_REQUESTS)
          .send({ message: 'Another question is being answered. Please wait for it to finish.' });
      }
      busy = true;
      try {
        const role = /** @type {import('../../roles/index.js').Role} */ (roles.get(roleId));
        reply.hijack();
        await streamAnswer(reply.raw, { question: question.trim(), role, detailLevel });
      } finally {
        busy = false;
      }
      return reply;
    },
  );

  /**
   * Answers one question onto an event stream, whatever happens.
   * @param {import('http').ServerResponse} response - The raw response.
   * @param {{ question: string, role: import('../../roles/index.js').Role, detailLevel: 'default' | 'more' }} input - The request.
   */
  async function streamAnswer(response, { question, role, detailLevel }) {
    const stream = openEventStream(response, SECURITY_HEADERS);
    const controller = new AbortController();
    stream.onDisconnect(() => {
      logger.info('the client went away; stopping the question');
      controller.abort();
    });
    const filter = createMetaStreamFilter();
    try {
      const result = await ask({
        question,
        role,
        detailLevel,
        signal: controller.signal,
        onActivity: (activity) =>
          stream.send('progress', {
            kind: activity.kind,
            message: toolEventToProgress(activity, role),
          }),
        onDelta: (text) => {
          const visible = filter.push(text);
          if (visible !== '') {
            stream.send('token', { text: visible });
          }
        },
      });
      const answerId = rememberAnswer(answers, question, result);
      stream.finish('done', buildDonePayload({ answerId, result, role, renderHtml }));
    } catch (error) {
      const failure = describeFailure(error);
      if (failure.kind === 'cancelled') {
        logger.info('the question was stopped');
      } else {
        logger.error({ err: error, kind: failure.kind }, 'the question failed');
      }
      stream.finish('error', failure);
    }
  }
}
