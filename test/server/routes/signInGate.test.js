// @ts-check
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../../src/config/index.js';
import { createConversationStore } from '../../../src/conversation/index.js';
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
 * @returns {{ app: import('fastify').FastifyInstance, ask: import('vitest').Mock }} The app and its fake ask.
 */
function oauthApp(signedIn) {
  const ask = vi.fn(async () => {
    throw new Error('ask was not expected');
  });
  const store = createConversationStore({
    clock: { now: () => START },
    limits: { maxTurns: 5, maxSourceChars: 1000, idleMinutes: 30 },
    closeSession: async () => undefined,
    newId: randomUUID,
  });
  const app = buildApp({
    config: loadConfig(oauthEnv()),
    roles: new Map([['tester', makeRole()]]),
    ask,
    answers: createAnswerMemory(),
    saveFeedback: vi.fn(),
    conversations: {
      store,
      runner: fakeRunner([{}]),
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
  return { app, ask };
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
