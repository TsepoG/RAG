// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { createConversationStore } from '../../src/conversation/index.js';
import { ConversationEndedError } from '../../src/errors/index.js';
import { TEST_ROLE } from '../helpers/role.js';

/**
 * A store with a clock the test moves, ids that count, and a session closer that records.
 * @returns {{ store: import('../../src/conversation/index.js').ConversationStore, setNow: (ms: number) => void, closeSession: import('vitest').Mock }} The store and its doubles.
 */
function setup() {
  let now = 0;
  let next = 0;
  const closeSession = vi.fn(async () => {});
  const store = createConversationStore({
    clock: { now: () => now },
    limits: { maxTurns: 5, maxSourceChars: 1000, idleMinutes: 30 },
    closeSession,
    newId: () => `id-${++next}`,
  });
  return { store, setNow: (ms) => (now = ms), closeSession };
}

const MINUTE = 60_000;
const ROLE = { role: TEST_ROLE };
const ASK = { question: 'q', detailLevel: /** @type {const} */ ('default') };

describe('creating a conversation', () => {
  it('makes one with the role, the limits and its own citation registry', async () => {
    const { store } = setup();

    const conversation = await store.create(ROLE);

    expect(conversation).toMatchObject({ id: 'id-1', role: TEST_ROLE, maxTurns: 5 });
    expect(conversation.registry.turn()).toBe(1);
    expect(store.get('id-1')).toBe(conversation);
  });

  it('keeps one active: a new conversation ends the old one and closes its session', async () => {
    const { store, closeSession } = setup();
    const first = await store.create(ROLE);
    const session = { name: 'first' };
    first.setSession(session);

    const second = await store.create(ROLE);

    expect(store.get(first.id)).toBeUndefined();
    expect(store.get(second.id)).toBe(second);
    expect(first.endedReason()).toBe('replaced');
    expect(closeSession).toHaveBeenCalledExactlyOnceWith(session, { running: false });
    expect(first.session()).toBeUndefined();
  });

  it('tells the closer when the old conversation had a turn running', async () => {
    const { store, closeSession } = setup();
    const first = await store.create(ROLE);
    first.setSession({});
    first.beginTurn(ASK);

    await store.create(ROLE);

    expect(closeSession).toHaveBeenCalledWith(expect.anything(), { running: true });
  });

  it('closes nothing when the old conversation never opened a session', async () => {
    const { store, closeSession } = setup();
    await store.create(ROLE);

    await store.create(ROLE);

    expect(closeSession).not.toHaveBeenCalled();
  });
});

describe('finding a conversation', () => {
  it('gives nothing for an unknown id, and require throws conversation ended', async () => {
    const { store } = setup();
    await store.create(ROLE);

    expect(store.get('nope')).toBeUndefined();
    expect(() => store.require('nope')).toThrow(ConversationEndedError);
  });

  it('gives nothing before any conversation exists', () => {
    const { store } = setup();

    expect(store.get('id-1')).toBeUndefined();
    expect(() => store.require('id-1')).toThrow(ConversationEndedError);
  });

  it('requires a live conversation by its id', async () => {
    const { store } = setup();
    const conversation = await store.create(ROLE);

    expect(store.require(conversation.id)).toBe(conversation);
  });
});

describe('idle expiry', () => {
  it('forgets a conversation left alone for the idle time, and not before', async () => {
    const { store, setNow } = setup();
    const conversation = await store.create(ROLE);

    setNow(30 * MINUTE - 1);
    expect(store.get(conversation.id)).toBe(conversation);

    setNow(30 * MINUTE);
    expect(store.get(conversation.id)).toBeUndefined();
    expect(() => store.require(conversation.id)).toThrow(ConversationEndedError);
  });

  it('counts activity: a touch pushes the expiry back', async () => {
    const { store, setNow } = setup();
    const conversation = await store.create(ROLE);
    setNow(20 * MINUTE);
    conversation.touch();

    setNow(40 * MINUTE);

    expect(store.get(conversation.id)).toBe(conversation);
  });

  it('never expires a conversation while a turn is running', async () => {
    const { store, setNow } = setup();
    const conversation = await store.create(ROLE);
    conversation.beginTurn(ASK);

    setNow(90 * MINUTE);

    expect(store.get(conversation.id)).toBe(conversation);
    expect(await store.sweep()).toEqual([]);
  });

  it('sweeps an idle conversation: ends it, closes its session and gives its id', async () => {
    const { store, setNow, closeSession } = setup();
    const conversation = await store.create(ROLE);
    const session = {};
    conversation.setSession(session);
    setNow(31 * MINUTE);

    expect(await store.sweep()).toEqual([conversation.id]);

    expect(conversation.endedReason()).toBe('idle');
    expect(closeSession).toHaveBeenCalledWith(session, { running: false });
    expect(await store.sweep()).toEqual([]);
  });

  it('sweeps nothing when the conversation is still fresh, or there is none', async () => {
    const { store } = setup();
    expect(await store.sweep()).toEqual([]);

    await store.create(ROLE);

    expect(await store.sweep()).toEqual([]);
  });
});

describe('ending and removing', () => {
  it('ends a conversation but keeps its transcript, and closes its session once', async () => {
    const { store, closeSession } = setup();
    const conversation = await store.create(ROLE);
    conversation.setSession({});

    await store.end(conversation, 'full');
    await store.end(conversation, 'full');

    expect(conversation.endedReason()).toBe('full');
    expect(store.get(conversation.id)).toBe(conversation);
    expect(closeSession).toHaveBeenCalledTimes(1);
  });

  it('removes a conversation, ending it and closing its session', async () => {
    const { store, closeSession } = setup();
    const conversation = await store.create(ROLE);
    conversation.setSession({});

    expect(await store.remove(conversation.id)).toBe(true);

    expect(conversation.endedReason()).toBe('deleted');
    expect(store.get(conversation.id)).toBeUndefined();
    expect(closeSession).toHaveBeenCalledTimes(1);
  });

  it('says so when there is nothing to remove', async () => {
    const { store } = setup();

    expect(await store.remove('id-1')).toBe(false);
  });
});
