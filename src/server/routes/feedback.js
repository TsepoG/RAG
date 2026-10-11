// @ts-check

/**
 * The body of a feedback request, once the schema has checked it.
 * @typedef {{ answerId: string, rating: 'up' | 'down', comment?: string, wrongSourceKey?: string }} RequestBody
 */

/** Longest comment accepted, in characters. */
export const MAX_COMMENT_LENGTH = 1000;

/** The shape of a citation key. */
const CITATION_KEY = '^[CG][1-9][0-9]*$';

/** Longest id accepted; ids this server hands out are shorter. */
const MAX_ID_LENGTH = 64;

const NOT_FOUND = 404;
const BAD_REQUEST = 400;

const BODY_SCHEMA = Object.freeze({
  type: 'object',
  required: ['answerId', 'rating'],
  additionalProperties: false,
  properties: {
    answerId: { type: 'string', minLength: 1, maxLength: MAX_ID_LENGTH },
    rating: { type: 'string', enum: ['up', 'down'] },
    comment: { type: 'string', maxLength: MAX_COMMENT_LENGTH },
    wrongSourceKey: { type: 'string', pattern: CITATION_KEY },
  },
});

/**
 * What the feedback route needs, all injected.
 * @typedef {object} FeedbackRouteDeps
 * @property {import('../answers.js').AnswerMemory} answers - The answers this server gave.
 * @property {(answer: import('../answers.js').AnswerRecord, input: import('../feedbackStore.js').FeedbackInput) => Promise<void>} save
 *   Stores one piece of feedback.
 */

/**
 * Registers `POST /api/feedback`. Feedback is accepted only for an answer this server gave, and a
 * "wrong source" only for a source that answer cited, so the page cannot invent either.
 * @param {import('fastify').FastifyInstance} app - The app.
 * @param {FeedbackRouteDeps} deps - Dependencies.
 */
export function registerFeedbackRoute(app, { answers, save }) {
  app.post('/api/feedback', { schema: { body: BODY_SCHEMA } }, async (request, reply) => {
    const { answerId, ...input } = /** @type {RequestBody} */ (request.body);
    const answer = answers.get(answerId);
    if (answer === undefined) {
      return reply.code(NOT_FOUND).send({ message: 'That answer is no longer remembered.' });
    }
    if (input.wrongSourceKey !== undefined && !answer.citedKeys.includes(input.wrongSourceKey)) {
      return reply.code(BAD_REQUEST).send({ message: 'That source was not cited by the answer.' });
    }
    await save(answer, input);
    return { saved: true };
  });
}
