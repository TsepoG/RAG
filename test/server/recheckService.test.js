// @ts-check
import { describe, expect, it, vi } from 'vitest';
import {
  blobFingerprint,
  createConversationRegistry,
  pageFingerprint,
} from '../../src/citations/index.js';
import { createConversation } from '../../src/conversation/index.js';
import {
  createRecheckService,
  MANUAL_RECHECK_INTERVAL_MS,
  MAX_CONCURRENT_RECHECKS,
} from '../../src/server/recheckService.js';
import { TEST_ROLE } from '../helpers/role.js';
import { confluenceSource, githubSource } from '../helpers/sources.js';

const START = 1_000_000;

/**
 * A conversation with a page and a file cited by its first turn.
 * @param {() => number} now - The clock.
 * @param {number} [maxTurns] - The turn cap.
 * @returns {import('../../src/conversation/index.js').Conversation} The conversation.
 */
function conversationWithSources(now, maxTurns = 3) {
  const clock = { now };
  const conversation = createConversation({
    id: 'c',
    role: TEST_ROLE,
    registry: createConversationRegistry({ clock }),
    clock,
    limits: { maxTurns, maxSourceChars: 1000 },
  });
  conversation.beginTurn({ question: 'q', detailLevel: 'default' });
  conversation.registry.register({ ...confluenceSource(), fingerprint: pageFingerprint(3) });
  conversation.registry.register({ ...githubSource(), fingerprint: blobFingerprint('abc') });
  conversation.finishTurn(1, 'answered', {
    answerId: 'a1',
    result: { sources: [{ key: 'C1' }, { key: 'G1' }] },
  });
  return conversation;
}

/**
 * A service whose checkers answer from the test.
 * @param {{ confluence?: (source: any) => Promise<string>, github?: string }} [options] - What the checkers say.
 * @returns {{ service: ReturnType<typeof createRecheckService>, now: { value: number }, confluence: import('vitest').Mock, github: import('vitest').Mock, lines: Array<Record<string, unknown>> }} The service and its doubles.
 */
function setup({ confluence = async () => 'unchanged', github = 'unchanged' } = {}) {
  const now = { value: START };
  const lines = /** @type {Array<Record<string, unknown>>} */ ([]);
  const confluenceCheck = vi.fn(confluence);
  const githubCheck = vi.fn(async () => github);
  const service = createRecheckService({
    checkers: /** @type {any} */ ({
      confluence: { check: confluenceCheck },
      github: { check: githubCheck },
    }),
    clock: { now: () => now.value },
    afterMinutes: 15,
    logger: /** @type {any} */ ({
      info: (/** @type {object} */ fields, /** @type {string} */ message) => {
        lines.push({ ...fields, message });
      },
    }),
  });
  return { service, now, confluence: confluenceCheck, github: githubCheck, lines };
}

describe('a manual re-check', () => {
  it('checks the sources it is given, records what it found, and marks a changed one in the registry', async () => {
    const { service, github } = setup({ github: 'changed' });
    const conversation = conversationWithSources(() => START);

    const outcome = await service.manual(conversation, ['C1', 'G1']);

    expect(outcome).toEqual({
      kind: 'done',
      results: [
        { key: 'C1', status: 'unchanged', checkedAt: START },
        { key: 'G1', status: 'changed', checkedAt: START },
      ],
      changedKeys: ['G1'],
    });
    expect(github).toHaveBeenCalledOnce();
    expect(conversation.checks.get('G1')).toEqual({ status: 'changed', checkedAt: START });
    expect(conversation.registry.get('G1')?.changed).toBe(true);
    expect(conversation.registry.get('C1')?.changed).toBe(false);
  });

  it('leaves out a key that is not a source of the conversation', async () => {
    const { service } = setup();
    const conversation = conversationWithSources(() => START);

    const outcome = await service.manual(conversation, ['C9']);

    expect(outcome).toEqual({ kind: 'done', results: [], changedKeys: [] });
  });

  it('is ignored within 30 seconds of the last, and runs again at 30 seconds', async () => {
    const { service, now, confluence, lines } = setup();
    const conversation = conversationWithSources(() => START);

    await service.manual(conversation, ['C1']);
    now.value = START + MANUAL_RECHECK_INTERVAL_MS - 1;
    const soon = await service.manual(conversation, ['C1']);
    now.value = START + MANUAL_RECHECK_INTERVAL_MS;
    const later = await service.manual(conversation, ['C1']);

    expect(soon).toEqual({ kind: 'ignored' });
    expect(later.kind).toBe('done');
    expect(confluence).toHaveBeenCalledTimes(2);
    expect(lines).toContainEqual(
      expect.objectContaining({ message: 'ignored a re-check asked for too soon after the last' }),
    );
  });

  it('does not start the 30 seconds when it is refused for being busy', async () => {
    const release = /** @type {Array<() => void>} */ ([]);
    const { service, now } = setup({
      confluence: () => new Promise((resolve) => release.push(() => resolve('unchanged'))),
    });
    const conversations = Array.from({ length: MAX_CONCURRENT_RECHECKS + 1 }, () =>
      conversationWithSources(() => now.value),
    );
    const running = conversations
      .slice(0, MAX_CONCURRENT_RECHECKS)
      .map((conversation) => service.manual(conversation, ['C1']));

    const last = conversations[MAX_CONCURRENT_RECHECKS];

    const refused = await service.manual(last, ['C1']);
    release.forEach((done) => done());
    await Promise.all(running);
    const retry = service.manual(last, ['C1']);
    release.at(-1)?.();

    expect(refused).toEqual({ kind: 'busy' });
    expect((await retry).kind).toBe('done');
  });
});

describe('the limit on re-checks running at once', () => {
  it('is 4, and a fifth is refused until one finishes', async () => {
    const release = /** @type {Array<() => void>} */ ([]);
    let blocking = true;
    const { service, lines } = setup({
      confluence: () =>
        blocking
          ? new Promise((resolve) => release.push(() => resolve('unchanged')))
          : Promise.resolve('unchanged'),
    });
    const make = () => conversationWithSources(() => START);
    const running = [make(), make(), make(), make()].map((conversation) =>
      service.manual(conversation, ['C1']),
    );

    const fifth = await service.manual(make(), ['C1']);
    blocking = false;
    release.forEach((done) => done());
    await Promise.all(running);
    const sixth = await service.manual(make(), ['C1']);

    expect(MAX_CONCURRENT_RECHECKS).toBe(4);
    expect(fifth).toEqual({ kind: 'busy' });
    expect(sixth.kind).toBe('done');
    expect(lines).toContainEqual(
      expect.objectContaining({ message: 'did not re-check: too many re-checks are running' }),
    );
  });

  it('frees its place when a check fails', async () => {
    const { service } = setup({
      confluence: () => Promise.reject(new Error('boom')),
    });
    for (let attempt = 0; attempt < MAX_CONCURRENT_RECHECKS + 1; attempt += 1) {
      await expect(
        service.manual(
          conversationWithSources(() => START),
          ['C1'],
        ),
      ).rejects.toThrow('boom');
    }
  });
});

describe('an automatic re-check', () => {
  it('checks the sources the turn cited that an earlier turn fetched', async () => {
    const { service, confluence } = setup();
    const conversation = conversationWithSources(() => START);
    conversation.beginTurn({ question: 'again', detailLevel: 'default' });
    conversation.finishTurn(2, 'answered', {
      answerId: 'a2',
      result: { sources: [{ key: 'C1' }] },
    });

    const outcome = await service.auto(conversation, 2);

    expect(outcome).toMatchObject({ kind: 'done', results: [{ key: 'C1', status: 'unchanged' }] });
    expect(confluence).toHaveBeenCalledOnce();
  });

  it('checks every source cited anywhere in the conversation once it is full', async () => {
    const { service } = setup();
    const conversation = conversationWithSources(() => START, 2);
    conversation.beginTurn({ question: 'again', detailLevel: 'default' });
    conversation.finishTurn(2, 'answered', {
      answerId: 'a2',
      result: { sources: [{ key: 'C1' }] },
    });

    const outcome = await service.auto(conversation, 2);

    expect(conversation.fullReason()).toBe('turns');
    expect(outcome).toMatchObject({ results: [{ key: 'C1' }, { key: 'G1' }] });
  });

  it('checks nothing when the turn has no answer', async () => {
    const { service, confluence } = setup();
    const conversation = conversationWithSources(() => START);

    const outcome = await service.auto(conversation, 5);

    expect(outcome).toEqual({ kind: 'done', results: [], changedKeys: [] });
    expect(confluence).not.toHaveBeenCalled();
  });
});
