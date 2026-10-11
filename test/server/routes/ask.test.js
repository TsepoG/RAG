// @ts-check
import { describe, expect, it, vi } from 'vitest';
import {
  AskTimeoutError,
  CopilotError,
  QuestionCancelledError,
} from '../../../src/errors/index.js';
import { ask as realAsk, FENCE, PAGE, reply, WINDOW } from '../../helpers/ask.js';
import { buildTestApp, JSON_HEADERS, parseEvents } from '../../helpers/server.js';

/**
 * A fake `askQuestion` that answers like the real one for one canned reply.
 * @param {(input: any) => void | Promise<void>} [during] - Runs first, with the input.
 * @returns {import('vitest').Mock} The fake.
 */
function answering(during = () => undefined) {
  return vi.fn(async (input) => {
    await during(input);
    const { result } = await realAsk({ tools: [PAGE], replies: [reply(`${WINDOW} [C1].`)] });
    return result;
  });
}

/**
 * Posts a question.
 * @param {import('fastify').FastifyInstance} app - The app.
 * @param {unknown} body - The JSON body.
 * @param {Record<string, string>} [headers] - Header changes.
 * @returns {Promise<import('light-my-request').Response>} The response.
 */
function post(app, body, headers = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/ask',
    payload: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { ...JSON_HEADERS, ...headers },
  });
}

const GOOD = { question: 'How do refunds work?', role: 'tester' };

describe('POST /api/ask: the request', () => {
  it.each([
    ['no question', { role: 'tester' }],
    ['an empty question', { question: '', role: 'tester' }],
    ['a question of only spaces', { question: '  \n ', role: 'tester' }],
    ['a question over 2000 characters', { question: 'x'.repeat(2001), role: 'tester' }],
    ['a question that is not text', { question: 5, role: 'tester' }],
    ['no role', { question: 'q' }],
    ['a role that does not exist', { question: 'q', role: 'admin' }],
    ['a detail level that does not exist', { question: 'q', role: 'tester', detailLevel: 'max' }],
    ['a field it does not know', { question: 'q', role: 'tester', extra: 1 }],
  ])('answers 400 for %s, without asking', async (_name, body) => {
    const ask = answering();
    const { app } = buildTestApp({ ask });

    const response = await post(app, body);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty('message');
    expect(ask).not.toHaveBeenCalled();
  });

  it('answers 400 for a body that is not JSON', async () => {
    const { app } = buildTestApp({ ask: answering() });

    expect((await post(app, '{nope')).statusCode).toBe(400);
  });

  it('answers 413 for a body over 16 KB, without asking', async () => {
    const ask = answering();
    const { app } = buildTestApp({ ask });

    const response = await post(app, { ...GOOD, question: 'x'.repeat(17_000) });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toHaveProperty('message');
    expect(ask).not.toHaveBeenCalled();
  });

  it('accepts a question of exactly 2000 characters', async () => {
    const { app } = buildTestApp({ ask: answering() });

    const response = await post(app, { ...GOOD, question: 'x'.repeat(2000) });

    expect(response.statusCode).toBe(200);
  });

  it('refuses a foreign Origin with 403 before it looks at the body', async () => {
    const ask = answering();
    const { app } = buildTestApp({ ask });
    const evil = ['https', '://evil.example'].join('');

    const response = await post(app, {}, { origin: evil });

    expect(response.statusCode).toBe(403);
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('POST /api/ask: the stream', () => {
  it('is an event stream with the security headers and no caching', async () => {
    const { app } = buildTestApp({ ask: answering() });

    const response = await post(app, GOOD);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('passes the question, the role and the level to ask, with a signal and the callbacks', async () => {
    const ask = answering();
    const { app } = buildTestApp({ ask });

    await post(app, { question: '  How do refunds work?  ', role: 'dev', detailLevel: 'more' });

    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'How do refunds work?',
        role: expect.objectContaining({ id: 'dev' }),
        detailLevel: 'more',
        signal: expect.any(AbortSignal),
        onActivity: expect.any(Function),
        onDelta: expect.any(Function),
      }),
    );
  });

  it('uses the usual level when none is given', async () => {
    const ask = answering();
    const { app } = buildTestApp({ ask });

    await post(app, GOOD);

    expect(ask.mock.calls[0][0].detailLevel).toBe('default');
  });

  it('sends progress, then tokens, then exactly one done', async () => {
    const ask = answering(({ onActivity, onDelta }) => {
      onActivity({ kind: 'tool', server: 'atlassian', tool: 'searchConfluence' });
      onDelta('Refunds are ');
      onDelta('allowed.');
      onActivity({ kind: 'checking' });
    });
    const { app } = buildTestApp({ ask });

    const events = parseEvents((await post(app, GOOD)).body);

    expect(events.map(({ event }) => event)).toEqual([
      'progress',
      'token',
      'token',
      'progress',
      'done',
    ]);
    expect(events[0].data).toEqual({ kind: 'tool', message: 'Searching Confluence…' });
    expect(events[1].data).toEqual({ text: 'Refunds are ' });
    expect(events[3].data).toEqual({ kind: 'checking', message: 'Checking the answer…' });
  });

  it('names the role in the rewriting message', async () => {
    const ask = answering(({ onActivity }) => onActivity({ kind: 'rewriting' }));
    const { app } = buildTestApp({ ask });

    const [progress] = parseEvents((await post(app, GOOD)).body);

    expect(progress.data.message).toBe('Rewriting the answer for a Tester…');
  });

  it('never sends the answer-meta block, wherever it is split', async () => {
    const reportText = `Answer text.\n\n${FENCE}answer-meta\n{"status":"answered","SECRET":1}\n${FENCE}`;
    const ask = answering(({ onDelta }) => {
      for (let start = 0; start < reportText.length; start += 7) {
        onDelta(reportText.slice(start, start + 7));
      }
    });
    const { app } = buildTestApp({ ask });

    const events = parseEvents((await post(app, GOOD)).body);
    const tokens = events.filter(({ event }) => event === 'token');

    expect(tokens.map(({ data }) => data.text).join('')).toBe('Answer text.\n\n');
    expect(JSON.stringify(tokens)).not.toContain('SECRET');
  });

  it('ends with done carrying an answer id, the result, the banner and the HTML', async () => {
    const { app } = buildTestApp({ ask: answering() });

    const events = parseEvents((await post(app, GOOD)).body);
    const done = events.at(-1);

    expect(events.filter(({ event }) => event === 'done')).toHaveLength(1);
    expect(done?.event).toBe('done');
    expect(done?.data.answerId).toEqual(expect.any(String));
    expect(done?.data.result.status).toBe('answered');
    expect(done?.data.rendered.banner).not.toBe('');
    expect(done?.data.html.answer).toContain('class="cite"');
  });

  it('remembers the answer so feedback can refer to it', async () => {
    const { app, answers } = buildTestApp({ ask: answering() });

    const done = parseEvents((await post(app, GOOD)).body).at(-1);

    expect(answers.get(done?.data.answerId)).toMatchObject({
      question: 'How do refunds work?',
      role: 'tester',
      status: 'answered',
      citedKeys: ['C1'],
    });
  });
});

describe('POST /api/ask: when it fails', () => {
  it.each([
    [new AskTimeoutError(1000), 'timeout'],
    [new CopilotError('private detail'), 'copilot'],
    [new Error('private detail'), 'internal'],
  ])('sends one error event, of kind %# , and no detail', async (error, kind) => {
    const { app } = buildTestApp({ ask: vi.fn(async () => Promise.reject(error)) });

    const response = await post(app, GOOD);
    const events = parseEvents(response.body);

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('error');
    expect(events[0].data.kind).toBe(kind);
    expect(response.body).not.toContain('private detail');
  });

  it('logs a failure at error level, with the error', async () => {
    const { app, lines } = buildTestApp({
      ask: vi.fn(async () => Promise.reject(new Error('boom'))),
    });

    await post(app, GOOD);

    expect(lines()).toContainEqual(
      expect.objectContaining({ level: 'error', msg: 'the question failed' }),
    );
  });

  it('sends a cancelled error, logged as information, when the question is stopped', async () => {
    const { app, lines } = buildTestApp({
      ask: vi.fn(async () => Promise.reject(new QuestionCancelledError())),
    });

    const [event] = parseEvents((await post(app, GOOD)).body);

    expect(event.data.kind).toBe('cancelled');
    expect(lines().map(({ msg }) => msg)).toContain('the question was stopped');
  });

  it('sends an error when the answer cannot be put together', async () => {
    const { app } = buildTestApp({
      ask: /** @type {any} */ (vi.fn(async () => ({ not: 'a result' }))),
    });

    const events = parseEvents((await post(app, GOOD)).body);

    expect(events.map(({ event }) => event)).toEqual(['error']);
  });

  it('can take the next question after a failure', async () => {
    const ask = vi.fn().mockRejectedValueOnce(new Error('boom'));
    ask.mockImplementation(answering());
    const { app } = buildTestApp({ ask });

    await post(app, GOOD);
    const second = parseEvents((await post(app, GOOD)).body);

    expect(second.at(-1)?.event).toBe('done');
  });
});

describe('POST /api/ask: one question at a time', () => {
  it('answers 429 to a second question while the first is running, then takes one again', async () => {
    /** @type {() => void} */
    let release = () => undefined;
    const gate = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    const ask = vi.fn();
    ask.mockImplementationOnce(answering(async () => gate));
    ask.mockImplementation(answering());
    const { app } = buildTestApp({ ask });

    const first = post(app, GOOD);
    await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce());
    const second = await post(app, GOOD);
    release();
    const firstResponse = await first;
    const third = await post(app, GOOD);

    expect(second.statusCode).toBe(429);
    expect(second.json().message).toContain('Another question');
    expect(parseEvents(firstResponse.body).at(-1)?.event).toBe('done');
    expect(third.statusCode).toBe(200);
    expect(ask).toHaveBeenCalledTimes(2);
  });
});

describe('POST /api/ask: when the client goes away', () => {
  it('aborts the question, logs it and frees the server for the next one', async () => {
    /** @type {any} */
    let raw;
    /** @type {AbortSignal | undefined} */
    let signal;
    const ask = vi.fn();
    ask.mockImplementationOnce(
      (input) =>
        new Promise((_resolve, reject) => {
          signal = input.signal;
          signal?.addEventListener('abort', () => reject(new QuestionCancelledError()));
          raw.emit('close');
        }),
    );
    ask.mockImplementation(answering());
    const { app, lines } = buildTestApp({ ask });
    app.addHook('onRequest', (_request, reply, done) => {
      raw = reply.raw;
      done();
    });

    await post(app, GOOD).catch(() => undefined); // the stream is cut off, as it is when the client leaves
    const next = await post(app, GOOD);

    expect(signal?.aborted).toBe(true);
    expect(lines().map(({ msg }) => msg)).toContain('the client went away; stopping the question');
    expect(next.statusCode).toBe(200);
  });
});
