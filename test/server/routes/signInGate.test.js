// @ts-check
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../../src/config/index.js';
import { createConversationStore } from '../../../src/conversation/index.js';
import { AtlassianSignInRequiredError } from '../../../src/errors/index.js';
import { createLogger } from '../../../src/logger/index.js';
import { createAnswerMemory } from '../../../src/server/answers.js';
import { buildApp } from '../../../src/server/app.js';
import { fakeRunner, START } from '../../helpers/conversationApp.js';
import { oauthEnv } from '../../helpers/env.js';
import { createMemoryStream } from '../../helpers/memory-stream.js';
import { makeRole } from '../../helpers/role.js';
import { JSON_HEADERS } from '../../helpers/server.js';

/**
 * Builds an oauth-mode app with a conversation store and the given sign-in state.
 * @param {boolean} signedIn - Whether someone is signed in.
 * @param {() => Promise<void>} [prepare] - What the runner does before a turn.
 * @returns {{ app: import('fastify').FastifyInstance, ask: import('vitest').Mock, runner: { ask: import('vitest').Mock, prepare: import('vitest').Mock } }} The app and its doubles.
 */
function oauthApp(signedIn, prepare = async () => undefined) {
  const ask = vi.fn(async () => {
    throw new Error('ask was not expected');
  });
  const store = createConversationStore({
    clock: { now: () => START },
    limits: { maxTurns: 5, maxSourceChars: 1000, idleMinutes: 30 },
    closeSession: async () => undefined,
    newId: randomUUID,
  });
  const runner = { ...fakeRunner([{}]), prepare: vi.fn(prepare) };
  const app = buildApp({
    config: loadConfig(oauthEnv()),
    roles: new Map([['tester', makeRole()]]),
    ask,
    answers: createAnswerMemory(),
    saveFeedback: vi.fn(),
    conversations: {
      store,
      runner,
      recheck: { manual: vi.fn(), auto: vi.fn() },
    },
    atlassianAuth: {
      flow: { start: vi.fn(), finish: vi.fn() },
      tokens: {
        status: async () =>
          signedIn
            ? { signedIn: true, expiresAt: START, siteHost: 'acme.atlassian.net' }
            : { signedIn: false },
      },
      signOut: vi.fn(),
      endActiveConversation: vi.fn(),
    },
    staticFiles: new Map(),
    logger: createLogger({ destination: createMemoryStream().stream }),
  });
  return { app, ask, runner };
}

/**
 * Starts a conversation and returns its id.
 * @param {import('fastify').FastifyInstance} app - The app.
 * @returns {Promise<string>} The id.
 */
async function startConversation(app) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/conversations',
    headers: JSON_HEADERS,
    payload: { role: 'tester' },
  });
  return response.json().conversationId;
}

/**
 * Asks a question in a conversation.
 * @param {import('fastify').FastifyInstance} app - The app.
 * @param {string} id - The conversation.
 * @returns {Promise<import('light-my-request').Response>} The response.
 */
function askIn(app, id) {
  return app.inject({
    method: 'POST',
    url: `/api/conversations/${id}/messages`,
    headers: JSON_HEADERS,
    payload: { question: 'What is the refund policy?' },
  });
}

describe('questions in oauth mode before anyone signs in', () => {
  it('cannot start a conversation: 401 atlassian_signin_required', async () => {
    const { app } = oauthApp(false);

    const response = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      headers: JSON_HEADERS,
      payload: { role: 'tester' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: 'atlassian_signin_required',
      message: 'Sign in with Atlassian to keep going.',
    });
  });

  it('cannot ask a single question: 401 atlassian_signin_required', async () => {
    const { app, ask } = oauthApp(false);

    const response = await app.inject({
      method: 'POST',
      url: '/api/ask',
      headers: JSON_HEADERS,
      payload: { question: 'What is the refund policy?', role: 'tester' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('atlassian_signin_required');
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('questions in oauth mode once someone has signed in', () => {
  it('can start a conversation', async () => {
    const { app } = oauthApp(true);

    const response = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      headers: JSON_HEADERS,
      payload: { role: 'tester' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ maxTurns: 5 });
  });
});

describe('a question in a conversation in oauth mode', () => {
  it('is refused with 401 before streaming when the sign-in has expired, and uses no turn', async () => {
    const { app, runner } = oauthApp(true, async () => {
      throw new AtlassianSignInRequiredError();
    });
    const id = await startConversation(app);

    const response = await askIn(app, id);

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('atlassian_signin_required');
    expect(runner.ask).not.toHaveBeenCalled();
    const transcript = await app.inject({
      method: 'GET',
      url: `/api/conversations/${id}`,
      headers: JSON_HEADERS,
    });
    expect(transcript.statusCode).toBe(200);
    expect(transcript.json().turnCount).toBe(0);
  });

  it('is answered once the sign-in lasts the turn', async () => {
    const { app, runner } = oauthApp(true);
    const id = await startConversation(app);

    const response = await askIn(app, id);

    expect(response.statusCode).toBe(200);
    expect(runner.prepare).toHaveBeenCalledOnce();
    expect(runner.ask).toHaveBeenCalledOnce();
  });

  it('fails as any other error would when preparing breaks for another reason', async () => {
    const { app, runner } = oauthApp(true, async () => {
      throw new Error('restart failed');
    });
    const id = await startConversation(app);

    const response = await askIn(app, id);

    expect(response.statusCode).toBe(500);
    expect(runner.ask).not.toHaveBeenCalled();
  });
});
