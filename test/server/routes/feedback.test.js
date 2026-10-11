// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { createAnswerMemory } from '../../../src/server/answers.js';
import { buildTestApp, JSON_HEADERS } from '../../helpers/server.js';

const RECORD = {
  question: 'How do refunds work?',
  role: 'tester',
  detailLevel: /** @type {const} */ ('default'),
  status: 'answered',
  confidence: 'medium',
  citedKeys: ['C1', 'G1'],
  model: 'gpt-x',
};

/**
 * Sets up an app that remembers one answer.
 * @param {import('vitest').Mock} [saveFeedback] - The fake store.
 * @returns {{ app: import('fastify').FastifyInstance, answerId: string, save: import('vitest').Mock }} The app and the id.
 */
function setup(saveFeedback = vi.fn(async () => undefined)) {
  const answers = createAnswerMemory();
  const answerId = answers.remember(RECORD);
  const { app } = buildTestApp({ answers, saveFeedback });
  return { app, answerId, save: saveFeedback };
}

/**
 * Posts feedback.
 * @param {import('fastify').FastifyInstance} app - The app.
 * @param {unknown} body - The JSON body.
 * @returns {Promise<import('light-my-request').Response>} The response.
 */
function post(app, body) {
  return app.inject({
    method: 'POST',
    url: '/api/feedback',
    payload: JSON.stringify(body),
    headers: JSON_HEADERS,
  });
}

describe('POST /api/feedback', () => {
  it('stores feedback for an answer it gave, with what it remembers about that answer', async () => {
    const { app, answerId, save } = setup();

    const response = await post(app, {
      answerId,
      rating: 'down',
      comment: 'Wrong window',
      wrongSourceKey: 'G1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ saved: true });
    expect(save).toHaveBeenCalledWith(RECORD, {
      rating: 'down',
      comment: 'Wrong window',
      wrongSourceKey: 'G1',
    });
  });

  it('accepts a rating alone', async () => {
    const { app, answerId, save } = setup();

    expect((await post(app, { answerId, rating: 'up' })).statusCode).toBe(200);
    expect(save).toHaveBeenCalledWith(RECORD, { rating: 'up' });
  });

  it('answers 404 for an id it did not give out, and stores nothing', async () => {
    const { app, save } = setup();

    const response = await post(app, { answerId: 'made-up', rating: 'up' });

    expect(response.statusCode).toBe(404);
    expect(save).not.toHaveBeenCalled();
  });

  it('answers 400 for a source the answer did not cite', async () => {
    const { app, answerId, save } = setup();

    const response = await post(app, { answerId, rating: 'down', wrongSourceKey: 'C9' });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('not cited');
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    ['no id', { rating: 'up' }],
    ['no rating', { answerId: 'x' }],
    ['a rating that is not up or down', { answerId: 'x', rating: 'meh' }],
    ['a comment over 1000 characters', { answerId: 'x', rating: 'up', comment: 'c'.repeat(1001) }],
    ['a source key of the wrong shape', { answerId: 'x', rating: 'up', wrongSourceKey: 'X1' }],
    ['a source key with extra text', { answerId: 'x', rating: 'up', wrongSourceKey: 'C1 and' }],
    ['an id that is too long', { answerId: 'x'.repeat(65), rating: 'up' }],
    ['a field it does not know', { answerId: 'x', rating: 'up', answer: 'text' }],
  ])('answers 400 for %s', async (_name, body) => {
    const { app, save } = setup();

    const response = await post(app, body);

    expect(response.statusCode).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it('accepts a comment of exactly 1000 characters', async () => {
    const { app, answerId } = setup();

    const response = await post(app, { answerId, rating: 'up', comment: 'c'.repeat(1000) });

    expect(response.statusCode).toBe(200);
  });

  it('answers 500 with a plain message when it cannot be stored', async () => {
    const { app, answerId } = setup(
      vi.fn(async () => {
        throw new Error('disk full at C:\\private\\path');
      }),
    );

    const response = await post(app, { answerId, rating: 'up' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ message: 'Something went wrong. Please try again.' });
  });
});
