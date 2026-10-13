// @ts-check
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopilotError } from '../../../src/errors/index.js';
import { createConversationStore } from '../../../src/conversation/index.js';
import { buildConversationApp, fakeRunner, START } from '../../helpers/conversationApp.js';
import { buildTestApp, JSON_HEADERS, OWN_HOST, parseEvents } from '../../helpers/server.js';

const MINUTE = 60_000;
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

/** @type {import('fastify').FastifyInstance | undefined} */
let listening;

afterEach(async () => {
  await listening?.close();
  listening = undefined;
});

/**
 * Sends a JSON request into the app.
 * @param {import('fastify').FastifyInstance} app - The app.
 * @param {string} method - The method.
 * @param {string} url - The path.
 * @param {unknown} [body] - The JSON body, if any.
 * @param {Record<string, string>} [headers] - Header changes.
 * @returns {Promise<import('light-my-request').Response>} The response.
 */
function send(app, method, url, body, headers = {}) {
  return app.inject({
    method: /** @type {any} */ (method),
    url,
    headers: { ...JSON_HEADERS, ...headers },
    ...(body === undefined
      ? {}
      : { payload: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

/**
 * Starts a conversation.
 * @param {import('fastify').FastifyInstance} app - The app.
 * @returns {Promise<string>} Its id.
 */
async function start(app) {
  return (await send(app, 'POST', '/api/conversations', { role: 'tester' })).json().conversationId;
}

/**
 * Asks a question and reads the whole event stream.
 * @param {import('fastify').FastifyInstance} app - The app.
 * @param {string} id - The conversation id.
 * @param {Record<string, unknown>} [body] - Changes to the request.
 * @returns {Promise<{ response: import('light-my-request').Response, events: Array<{ event: string, data: any }> }>} What came back.
 */
async function ask(app, id, body = {}) {
  const response = await send(app, 'POST', `/api/conversations/${id}/messages`, {
    question: 'How do refunds work?',
    ...body,
  });
  return { response, events: response.statusCode === 200 ? parseEvents(response.body) : [] };
}

/**
 * The data of the done event.
 * @param {Array<{ event: string, data: any }>} events - The events.
 * @returns {any} The data.
 */
function doneOf(events) {
  return events.find(({ event }) => event === 'done')?.data;
}

/**
 * Opens a real connection, so a test can see what arrives before the stream ends.
 * @param {import('fastify').FastifyInstance} app - The app.
 * @param {string} id - The conversation id.
 * @returns {Promise<{ chunks: string[], seen: (event: string) => Promise<void>, done: Promise<void>, stop: () => void }>} The connection.
 */
async function connect(app, id) {
  listening = app;
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = /** @type {import('node:net').AddressInfo} */ (app.server.address());
  const chunks = /** @type {string[]} */ ([]);
  /** @type {Array<() => void>} */
  const watchers = [];
  /** @type {() => void} */
  let finish = () => undefined;
  const done = new Promise((resolve) => {
    finish = () => resolve(undefined);
  });
  const outgoing = httpRequest(
    {
      host: '127.0.0.1',
      port: address.port,
      path: `/api/conversations/${id}/messages`,
      method: 'POST',
      headers: { ...JSON_HEADERS, host: OWN_HOST },
    },
    (incoming) => {
      incoming.on('data', (chunk) => {
        chunks.push(String(chunk));
        watchers.forEach((watch) => watch());
      });
      incoming.on('end', finish);
      incoming.on('close', finish);
    },
  );
  outgoing.on('error', finish);
  outgoing.end(JSON.stringify({ question: 'How do refunds work?' }));
  return {
    chunks,
    done,
    seen: (event) =>
      new Promise((resolve) => {
        const check = () => {
          if (chunks.join('').includes(`event: ${event}\n`)) {
            resolve();
          }
        };
        watchers.push(check);
        check();
      }),
    stop: () => outgoing.destroy(),
  };
}

describe('POST /api/conversations', () => {
  it('starts a conversation for a role and gives its id and turn cap', async () => {
    const { app, store } = await buildConversationApp();

    const response = await send(app, 'POST', '/api/conversations', { role: 'tester' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      conversationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      maxTurns: 5,
    });
    expect(store.get(response.json().conversationId)).toBeDefined();
  });

  it.each([
    ['no role', {}],
    ['a role that does not exist', { role: 'admin' }],
    ['a field it does not know', { role: 'tester', extra: 1 }],
    ['a role that is not text', { role: 5 }],
  ])('answers 400 for %s, and starts nothing', async (_name, body) => {
    const { app, store } = await buildConversationApp();

    const response = await send(app, 'POST', '/api/conversations', body);

    expect(response.statusCode).toBe(400);
    expect(store.active()).toBeUndefined();
  });

  it('ends the conversation before it when another is started', async () => {
    const { app } = await buildConversationApp();
    const first = await start(app);

    const second = await start(app);

    expect((await send(app, 'GET', `/api/conversations/${first}`)).statusCode).toBe(404);
    expect((await send(app, 'GET', `/api/conversations/${second}`)).statusCode).toBe(200);
  });
});

describe('POST /api/conversations/:id/messages', () => {
  it('streams progress and tokens, then done, then a separate recheck, and closes', async () => {
    const { app } = await buildConversationApp();
    const id = await start(app);

    const { response, events } = await ask(app, id);

    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(events.map(({ event }) => event)).toEqual([
      'progress',
      'token',
      'token',
      'done',
      'recheck',
    ]);
    expect(events[0].data).toEqual({ kind: 'checking', message: 'Checking the answer…' });
    expect(events[1].data).toEqual({ text: 'Working on it' });
  });

  it('puts the turn, the sources with the turn they were fetched in, and where the conversation stands in done', async () => {
    const { app } = await buildConversationApp();
    const id = await start(app);

    const { events } = await ask(app, id);
    const done = doneOf(events);

    expect(done).toMatchObject({
      turn: 1,
      answerId: expect.any(String),
      result: { status: 'answered', confidence: 'high' },
      changedKeys: [],
      sourceStates: [
        { key: 'C1', fetchedInTurn: 1, fetchedAt: expect.any(Number), changed: false, check: null },
      ],
      conversation: {
        conversationId: id,
        role: 'tester',
        maxTurns: 5,
        turnCount: 1,
        full: null,
        ended: null,
      },
    });
    expect(done.rendered.text).toBeDefined();
    expect(done.html.answer).toContain('<');
  });

  it('remembers the answer for feedback, with the turn and how many turns the conversation had', async () => {
    const { app, answers } = await buildConversationApp();
    const id = await start(app);
    await ask(app, id);

    const { events } = await ask(app, id);
    const { answerId } = doneOf(events);

    expect(answers.get(answerId)).toMatchObject({
      turn: 2,
      conversationTurns: 2,
      status: 'answered',
    });
  });

  it('checks a source an earlier turn fetched, and tells the page in the recheck event', async () => {
    const { app, confluenceCheck } = await buildConversationApp();
    const id = await start(app);
    await ask(app, id);

    const { events } = await ask(app, id);
    const recheck = events.find(({ event }) => event === 'recheck')?.data;

    expect(confluenceCheck).toHaveBeenCalledOnce();
    expect(recheck.checks).toEqual([{ key: 'C1', status: 'unchanged', checkedAt: START }]);
    expect(recheck.skipped).toBeNull();
    expect(recheck.updates.map((/** @type {{ turn: number }} */ update) => update.turn)).toEqual([
      1, 2,
    ]);
    expect(recheck.updates[0].sourceStates[0].check).toEqual({
      status: 'unchanged',
      checkedAt: START,
    });
  });

  it('sends an empty recheck when nothing was due, so the page knows the check is over', async () => {
    const { app, confluenceCheck } = await buildConversationApp();
    const id = await start(app);

    const { events } = await ask(app, id);

    expect(confluenceCheck).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({
      event: 'recheck',
      data: expect.objectContaining({ checks: [], updates: [], changedKeys: [], skipped: null }),
    });
  });

  it('sends done before the check finishes: the check never delays the answer', async () => {
    const { app, confluenceCheck } = await buildConversationApp();
    const id = await start(app);
    await ask(app, id);
    /** @type {() => void} */
    let release = () => undefined;
    confluenceCheck.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve('unchanged'))),
    );

    const connection = await connect(app, id);
    await connection.seen('done');
    const before = connection.chunks.join('');
    release();
    await connection.done;
    const after = connection.chunks.join('');

    expect(before).toContain('event: done');
    expect(before).not.toContain('event: recheck');
    expect(after.indexOf('event: done')).toBeLessThan(after.indexOf('event: recheck'));
  });

  it('stops the turn, and only that turn, when the client goes away', async () => {
    const { app, runner, store } = await buildConversationApp({ plans: [{ untilStopped: true }] });
    const id = await start(app);

    const connection = await connect(app, id);
    await vi.waitFor(() => expect(runner.ask).toHaveBeenCalled());
    connection.stop();
    await vi.waitFor(() => expect(store.get(id)?.isBusy()).toBe(false));

    expect(runner.ask.mock.calls[0][1].signal.aborted).toBe(true);
    expect(store.get(id)?.turns()[0]?.status).toBe('cancelled');
    expect(store.get(id)?.endedReason()).toBeUndefined();
  });

  it('does not check anything for a client that went away before the answer was ready', async () => {
    /** @type {() => void} */
    let release = () => undefined;
    const { app, confluenceCheck, store } = await buildConversationApp({
      plans: [{}, { during: () => new Promise((resolve) => (release = () => resolve(undefined))) }],
    });
    const id = await start(app);
    await ask(app, id);

    const connection = await connect(app, id);
    await vi.waitFor(() => expect(store.get(id)?.isBusy()).toBe(true));
    connection.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await vi.waitFor(() => expect(store.get(id)?.isBusy()).toBe(false));

    expect(confluenceCheck).not.toHaveBeenCalled();
  });

  it('ends the stream with an error that says where the conversation stands when the turn fails', async () => {
    const { app } = await buildConversationApp({ plans: [{ fail: new CopilotError('boom') }] });
    const id = await start(app);

    const { events } = await ask(app, id);

    expect(events.map(({ event }) => event)).toEqual(['progress', 'token', 'token', 'error']);
    expect(events[3].data).toMatchObject({
      kind: 'copilot',
      conversation: { turnCount: 1, ended: null },
    });
  });

  it.each([
    ['no question', {}],
    ['a blank question', { question: '  ' }],
    ['a question over 2000 characters', { question: 'x'.repeat(2001) }],
    ['a field it does not know', { question: 'q', role: 'dev' }],
    ['a detail level that does not exist', { question: 'q', detailLevel: 'max' }],
    ['an answer id that is not an id', { question: 'q', reaskAnswerId: 'nope' }],
  ])('answers 400 for %s, without asking', async (_name, payload) => {
    const { app, runner } = await buildConversationApp();
    const id = await start(app);

    const response = await send(app, 'POST', `/api/conversations/${id}/messages`, payload);

    expect(response.statusCode).toBe(400);
    expect(runner.ask).not.toHaveBeenCalled();
  });

  it('answers 400 for an id that is not a UUID', async () => {
    const { app, runner } = await buildConversationApp();

    const response = await send(app, 'POST', '/api/conversations/not-an-id/messages', {
      question: 'q',
    });

    expect(response.statusCode).toBe(400);
    expect(runner.ask).not.toHaveBeenCalled();
  });

  it('answers 404 conversation_ended for a conversation that was never started', async () => {
    const { app, runner } = await buildConversationApp();

    const { response } = await ask(app, UNKNOWN_ID);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'conversation_ended' });
    expect(runner.ask).not.toHaveBeenCalled();
  });

  it('answers 404 conversation_ended once the conversation has been idle too long', async () => {
    const { app, setNow } = await buildConversationApp();
    const id = await start(app);

    setNow(START + 31 * MINUTE);
    const { response } = await ask(app, id);

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('conversation_ended');
  });

  it('answers 404 conversation_ended for a conversation that ended after a turn', async () => {
    const { app, store } = await buildConversationApp();
    const id = await start(app);
    store.get(id)?.end('truncated');

    const { response } = await ask(app, id);

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('conversation_ended');
  });

  it('answers 429 conversation_busy when a turn is running', async () => {
    const { app, store } = await buildConversationApp();
    const id = await start(app);
    store.get(id)?.beginTurn({ question: 'q', detailLevel: 'default' });

    const { response } = await ask(app, id);

    expect(response.statusCode).toBe(429);
    expect(response.json().code).toBe('conversation_busy');
  });

  it('answers 409 conversation_full, with the message to show, at the turn cap', async () => {
    const { app, runner } = await buildConversationApp({ limits: { maxTurns: 1 } });
    const id = await start(app);
    await ask(app, id);

    const { response } = await ask(app, id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: 'conversation_full',
      message: 'This conversation is full — start a new one to keep going.',
    });
    expect(runner.ask).toHaveBeenCalledOnce();
  });

  it('answers 409 conversation_full once the source budget is used', async () => {
    const { app, store } = await buildConversationApp();
    const id = await start(app);
    store.get(id)?.addSourceChars(1_000_000);

    const { response } = await ask(app, id);

    expect(response.statusCode).toBe(409);
  });

  it('tells the full conversation it is full in the answer that fills it', async () => {
    const { app } = await buildConversationApp({ limits: { maxTurns: 1 } });
    const id = await start(app);

    const { events } = await ask(app, id);

    expect(doneOf(events).conversation).toMatchObject({
      full: 'turns',
      fullMessage: 'This conversation is full — start a new one to keep going.',
    });
  });

  it('checks every source cited in the conversation once the last turn is answered', async () => {
    const { app, confluenceCheck } = await buildConversationApp({
      limits: { maxTurns: 1 },
    });
    const id = await start(app);

    const { events } = await ask(app, id);

    expect(confluenceCheck).toHaveBeenCalledOnce();
    expect(events.at(-1)?.data.checks).toEqual([
      { key: 'C1', status: 'unchanged', checkedAt: START },
    ]);
  });
});

describe('re-asking with the latest version', () => {
  it('names the changed keys of that answer to the runner, from the server record', async () => {
    const { app, runner, setStatus } = await buildConversationApp();
    const id = await start(app);
    const first = doneOf((await ask(app, id)).events);
    setStatus('changed');
    await send(app, 'POST', `/api/conversations/${id}/recheck`, { answerId: first.answerId });

    await ask(app, id, { reaskAnswerId: first.answerId });

    expect(runner.ask.mock.calls[1][1].changedKeys).toEqual(['C1']);
  });

  it('names no keys when nothing changed', async () => {
    const { app, runner } = await buildConversationApp();
    const id = await start(app);
    const first = doneOf((await ask(app, id)).events);

    await ask(app, id, { reaskAnswerId: first.answerId });

    expect(runner.ask.mock.calls[1][1].changedKeys).toEqual([]);
  });

  it('answers 404 answer_not_found for an answer that is not part of the conversation', async () => {
    const { app, runner } = await buildConversationApp();
    const id = await start(app);

    const { response } = await ask(app, id, { reaskAnswerId: UNKNOWN_ID });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('answer_not_found');
    expect(runner.ask).not.toHaveBeenCalled();
  });

  it('gives the new version a new key and leaves the old key marked changed', async () => {
    const { app, setStatus } = await buildConversationApp({
      plans: [{ pages: [{ id: '100', version: 1 }] }, { pages: [{ id: '100', version: 2 }] }],
    });
    const id = await start(app);
    const first = doneOf((await ask(app, id)).events);
    setStatus('changed');
    await send(app, 'POST', `/api/conversations/${id}/recheck`, { answerId: first.answerId });

    const second = doneOf((await ask(app, id, { reaskAnswerId: first.answerId })).events);
    const transcript = (await send(app, 'GET', `/api/conversations/${id}`)).json();

    expect(
      second.sourceStates.map((/** @type {{ key: string, changed: boolean }} */ state) => [
        state.key,
        state.changed,
      ]),
    ).toEqual([['C2', false]]);
    expect(transcript.turns[0].answer.sourceStates[0]).toMatchObject({ key: 'C1', changed: true });
  });
});

describe('POST /api/conversations/:id/recheck', () => {
  /**
   * Starts a conversation and gets one answer in it.
   * @param {Awaited<ReturnType<typeof buildConversationApp>>} built - The app.
   * @returns {Promise<{ id: string, answerId: string }>} The ids.
   */
  async function answered({ app }) {
    const id = await start(app);
    const done = doneOf((await ask(app, id)).events);
    return { id, answerId: done.answerId };
  }

  it('checks the answer’s sources now and gives the answer back with what was found', async () => {
    const built = await buildConversationApp();
    const { id, answerId } = await answered(built);

    const response = await send(built.app, 'POST', `/api/conversations/${id}/recheck`, {
      answerId,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ignored: false,
      checks: [{ key: 'C1', status: 'unchanged', checkedAt: START }],
      changedKeys: [],
      updates: [{ answerId, sourceStates: [{ key: 'C1', check: { status: 'unchanged' } }] }],
    });
  });

  it('caps the answer at medium and says why when a source has changed', async () => {
    const built = await buildConversationApp({ status: 'changed' });
    const { id, answerId } = await answered(built);

    const response = await send(built.app, 'POST', `/api/conversations/${id}/recheck`, {
      answerId,
    });

    const [update] = response.json().updates;
    expect(response.json().changedKeys).toEqual(['C1']);
    expect(update.result).toMatchObject({ status: 'answered', confidence: 'medium' });
    expect(update.result.capsApplied).toContainEqual(
      expect.objectContaining({ code: 'source-changed' }),
    );
    expect(update.result.confidenceReason).toContain(
      'A source has changed since this answer was written.',
    );
    expect(update.sourceStates[0]).toMatchObject({ changed: true, check: { status: 'changed' } });
  });

  it('shows the cap on a reload too', async () => {
    const built = await buildConversationApp({ status: 'changed' });
    const { id, answerId } = await answered(built);
    await send(built.app, 'POST', `/api/conversations/${id}/recheck`, { answerId });

    const transcript = (await send(built.app, 'GET', `/api/conversations/${id}`)).json();

    expect(transcript.turns[0].answer.result.confidence).toBe('medium');
    expect(transcript.turns[0].answer.changedKeys).toEqual(['C1']);
  });

  it('ignores a check asked for within 30 seconds of the last, and takes the next after', async () => {
    const built = await buildConversationApp();
    const { id, answerId } = await answered(built);
    const url = `/api/conversations/${id}/recheck`;

    await send(built.app, 'POST', url, { answerId });
    built.setNow(START + 29_999);
    const soon = await send(built.app, 'POST', url, { answerId });
    built.setNow(START + 30_000);
    const later = await send(built.app, 'POST', url, { answerId });

    expect(soon.json()).toMatchObject({ ignored: true, checks: [] });
    expect(soon.json().updates).toHaveLength(1);
    expect(later.json().ignored).toBe(false);
    expect(built.confluenceCheck).toHaveBeenCalledTimes(2);
  });

  it('answers 429 recheck_busy when too many checks are running', async () => {
    const store = createConversationStore({
      clock: { now: () => START },
      limits: { maxTurns: 5, maxSourceChars: 1000, idleMinutes: 30 },
      closeSession: async () => undefined,
      newId: randomUUID,
    });
    const { app } = buildTestApp({
      conversations: {
        store,
        runner: fakeRunner([{}]),
        recheck: { manual: async () => ({ kind: 'busy' }), auto: async () => ({ kind: 'busy' }) },
      },
    });
    const id = await start(app);
    const done = (await ask(app, id)).events;
    const answerId = doneOf(done).answerId;

    const response = await send(app, 'POST', `/api/conversations/${id}/recheck`, { answerId });

    expect(response.statusCode).toBe(429);
    expect(response.json().code).toBe('recheck_busy');
    expect(done.at(-1)?.data).toMatchObject({ skipped: 'busy', checks: [] });
  });

  it('answers 404 answer_not_found for an answer that is not in the conversation', async () => {
    const built = await buildConversationApp();
    const { id } = await answered(built);

    const response = await send(built.app, 'POST', `/api/conversations/${id}/recheck`, {
      answerId: UNKNOWN_ID,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('answer_not_found');
  });

  it('answers 404 conversation_ended for a conversation that is gone', async () => {
    const { app } = await buildConversationApp();

    const response = await send(app, 'POST', `/api/conversations/${UNKNOWN_ID}/recheck`, {
      answerId: UNKNOWN_ID,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('conversation_ended');
  });

  it.each([
    ['no answer id', {}],
    ['an answer id that is not an id', { answerId: 'nope' }],
    ['a field it does not know', { answerId: UNKNOWN_ID, extra: 1 }],
  ])('answers 400 for %s', async (_name, body) => {
    const { app } = await buildConversationApp();
    const id = await start(app);

    const response = await send(app, 'POST', `/api/conversations/${id}/recheck`, body);

    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/conversations/:id', () => {
  it('gives the conversation and each turn with its answer, so a reload can show it', async () => {
    const { app } = await buildConversationApp({
      plans: [{}, { fail: new CopilotError('boom') }],
    });
    const id = await start(app);
    await ask(app, id);
    await ask(app, id, { question: 'And then?' });

    const response = await send(app, 'GET', `/api/conversations/${id}`);

    expect(response.statusCode).toBe(200);
    const transcript = response.json();
    expect(transcript).toMatchObject({
      conversationId: id,
      role: 'tester',
      maxTurns: 5,
      turnCount: 2,
    });
    expect(transcript.turns).toHaveLength(2);
    expect(transcript.turns[0]).toMatchObject({
      turn: 1,
      question: 'How do refunds work?',
      status: 'answered',
    });
    expect(transcript.turns[0].answer).toMatchObject({ turn: 1, sourceStates: [{ key: 'C1' }] });
    expect(transcript.turns[1]).toMatchObject({
      turn: 2,
      question: 'And then?',
      status: 'failed',
      answer: null,
    });
  });

  it('answers 404 conversation_ended for an unknown conversation, and 400 for an id that is not one', async () => {
    const { app } = await buildConversationApp();

    const unknown = await send(app, 'GET', `/api/conversations/${UNKNOWN_ID}`);
    const bad = await send(app, 'GET', '/api/conversations/nope');

    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().code).toBe('conversation_ended');
    expect(bad.statusCode).toBe(400);
  });

  it('counts a reload as activity, so the conversation is not closed under the reader', async () => {
    const { app, setNow } = await buildConversationApp();
    const id = await start(app);
    setNow(START + 20 * MINUTE);
    await send(app, 'GET', `/api/conversations/${id}`);

    setNow(START + 40 * MINUTE);

    expect((await send(app, 'GET', `/api/conversations/${id}`)).statusCode).toBe(200);
  });
});

describe('DELETE /api/conversations/:id', () => {
  it('ends the conversation and closes its session', async () => {
    const { app, store, closeSession } = await buildConversationApp();
    const id = await start(app);
    const session = {};
    store.get(id)?.setSession(session);

    const response = await send(app, 'DELETE', `/api/conversations/${id}`, {});

    expect(response.json()).toEqual({ deleted: true });
    expect(closeSession).toHaveBeenCalledWith(session, { running: false });
    expect((await send(app, 'GET', `/api/conversations/${id}`)).statusCode).toBe(404);
  });

  it('answers 404 conversation_ended when there is nothing to delete', async () => {
    const { app } = await buildConversationApp();

    const response = await send(app, 'DELETE', `/api/conversations/${UNKNOWN_ID}`, {});

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('conversation_ended');
  });

  it('wants a JSON body like every other change, and refuses one with fields in it', async () => {
    const { app } = await buildConversationApp();
    const id = await start(app);

    const empty = await send(app, 'DELETE', `/api/conversations/${id}`);
    const extra = await send(app, 'DELETE', `/api/conversations/${id}`, { x: 1 });

    expect(empty.statusCode).toBe(400);
    expect(extra.statusCode).toBe(400);
  });
});

describe('the guards on every conversation route', () => {
  const id = UNKNOWN_ID;
  /** @type {Array<[string, string, unknown]>} */
  const routes = [
    ['POST', '/api/conversations', { role: 'tester' }],
    ['POST', `/api/conversations/${id}/messages`, { question: 'q' }],
    ['GET', `/api/conversations/${id}`, undefined],
    ['DELETE', `/api/conversations/${id}`, {}],
    ['POST', `/api/conversations/${id}/recheck`, { answerId: id }],
  ];
  const changing = routes.filter(([method]) => method !== 'GET');

  it.each(routes)('lets %s %s through from this machine', async (method, url, body) => {
    const { app } = await buildConversationApp();

    const response = await send(app, method, url, body, { origin: `http://${OWN_HOST}` });

    expect(response.statusCode).not.toBe(403);
    expect(response.statusCode).not.toBe(413);
  });

  it.each(routes)('refuses %s %s addressed to another host', async (method, url, body) => {
    const { app, runner, store } = await buildConversationApp();

    const response = await send(app, method, url, body, { host: 'evil.example' });

    expect(response.statusCode).toBe(403);
    expect(runner.ask).not.toHaveBeenCalled();
    expect(store.active()).toBeUndefined();
  });

  it.each(routes)('refuses %s %s started by another site', async (method, url, body) => {
    const { app, store } = await buildConversationApp();

    const response = await send(app, method, url, body, { 'sec-fetch-site': 'cross-site' });

    expect(response.statusCode).toBe(403);
    expect(store.active()).toBeUndefined();
  });

  it.each(routes)('refuses %s %s from a foreign Origin', async (method, url, body) => {
    const { app, store } = await buildConversationApp();

    const response = await send(app, method, url, body, { origin: 'http://evil.example' });

    expect(response.statusCode).toBe(403);
    expect(store.active()).toBeUndefined();
  });

  it.each(changing)('refuses %s %s that is not sent as JSON', async (method, url, body) => {
    const { app, store } = await buildConversationApp();

    const response = await send(app, method, url, body, { 'content-type': 'text/plain' });

    expect(response.statusCode).toBe(403);
    expect(store.active()).toBeUndefined();
  });

  it.each(changing)('refuses %s %s with a body over 16 KB', async (method, url) => {
    const { app, runner, store } = await buildConversationApp();

    const response = await send(app, method, url, { padding: 'x'.repeat(17_000) });

    expect(response.statusCode).toBe(413);
    expect(runner.ask).not.toHaveBeenCalled();
    expect(store.active()).toBeUndefined();
  });
});
