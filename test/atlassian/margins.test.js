// @ts-check
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createStoredTokenProvider,
  MIN_TURN_TOKEN_MARGIN_MS,
  SESSION_TOKEN_MARGIN_MS,
  SIGN_IN_FIRST,
  turnTokenMargin,
} from '../../src/atlassian/tokens.js';
import { createSignInStore } from '../../src/atlassian/store.js';
import { createLogger } from '../../src/logger/index.js';
import { CLIENT, SIGN_IN } from '../helpers/atlassian.js';
import { createMemoryStream } from '../helpers/memory-stream.js';

const MINUTE = 60_000;

describe('token margins', () => {
  it('wants three hours left when a session is made', () => {
    expect(SESSION_TOKEN_MARGIN_MS).toBe(180 * MINUTE);
  });

  it('wants at least five minutes left when a turn starts', () => {
    expect(MIN_TURN_TOKEN_MARGIN_MS).toBe(5 * MINUTE);
    expect(turnTokenMargin(120_000)).toBe(5 * MINUTE);
  });

  it('wants the whole turn plus a minute when the turn may take longer', () => {
    expect(turnTokenMargin(600_000)).toBe(11 * MINUTE);
  });
});

describe('createStoredTokenProvider', () => {
  it('reads the sign-in from the folder it is given', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'sign-in-cli-'));
    try {
      const provider = createStoredTokenProvider({
        dir,
        logger: createLogger({ destination: createMemoryStream().stream }),
      });

      expect(await provider.status()).toEqual({ signedIn: false });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('hands out a stored token that has time left, using the real clock', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'sign-in-cli-'));
    try {
      const logger = createLogger({ destination: createMemoryStream().stream });
      const store = createSignInStore({ dir, logger });
      await store.writeClient(CLIENT);
      await store.writeSignIn({ ...SIGN_IN, expiresAt: Date.now() + 8 * 60 * MINUTE });

      const token = await createStoredTokenProvider({ dir, logger }).getAtlassianToken({
        minValidityMs: 5 * MINUTE,
      });

      expect(token.accessToken).toBe(SIGN_IN.accessToken);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('tells the commands where to sign in', () => {
    expect(SIGN_IN_FIRST).toBe('Sign in through the web app first (ATLASSIAN_AUTH_MODE=oauth).');
  });
});
