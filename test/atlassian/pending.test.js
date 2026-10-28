// @ts-check
import { describe, expect, it } from 'vitest';
import { createPendingSignIns, PENDING_SIGN_IN_MS } from '../../src/atlassian/pending.js';
import { challengeFor } from '../../src/atlassian/pkce.js';

/**
 * A store with a clock the test moves, and real randomness.
 * @returns {{ pending: ReturnType<typeof createPendingSignIns>, clock: { time: number, now: () => number } }} The store and its clock.
 */
function setup() {
  const clock = {
    time: 1_000_000,
    now() {
      return this.time;
    },
  };
  return { pending: createPendingSignIns({ clock }), clock };
}

describe('createPendingSignIns', () => {
  it('waits ten minutes for a sign-in', () => {
    expect(PENDING_SIGN_IN_MS).toBe(600_000);
  });

  it('starts a sign-in with a random state, a random nonce and a challenge, but no verifier', () => {
    const { pending } = setup();

    const started = pending.start();

    expect(Object.keys(started).sort()).toEqual(['challenge', 'nonce', 'state']);
    expect(started.state).toMatch(/^[\w-]{43}$/);
    expect(started.nonce).toMatch(/^[\w-]{43}$/);
    expect(started.state).not.toBe(started.nonce);
  });

  it('hands back the verifier for the matching state and nonce', () => {
    const { pending } = setup();
    const { state, nonce, challenge } = pending.start();

    const taken = pending.take({ state, nonce });

    expect(taken.ok).toBe(true);
    expect(taken.ok && challengeFor(taken.verifier)).toBe(challenge);
  });

  it('accepts a sign-in only once', () => {
    const { pending } = setup();
    const { state, nonce } = pending.start();
    pending.take({ state, nonce });

    expect(pending.take({ state, nonce })).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses a sign-in that took ten minutes or more', () => {
    const { pending, clock } = setup();
    const { state, nonce } = pending.start();
    clock.time += PENDING_SIGN_IN_MS;

    expect(pending.take({ state, nonce })).toEqual({ ok: false, reason: 'expired' });
  });

  it('accepts a sign-in just before ten minutes', () => {
    const { pending, clock } = setup();
    const { state, nonce } = pending.start();
    clock.time += PENDING_SIGN_IN_MS - 1;

    expect(pending.take({ state, nonce }).ok).toBe(true);
  });

  it('refuses a state when nothing was started', () => {
    const { pending } = setup();

    expect(pending.take({ state: 'a'.repeat(43), nonce: 'b' })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('replaces a waiting sign-in when another is started', () => {
    const { pending } = setup();
    const first = pending.start();
    const second = pending.start();

    expect(pending.take(first)).toEqual({ ok: false, reason: 'expired' });
    expect(pending.take(second).ok).toBe(true);
  });

  it('leaves the waiting sign-in alone when a wrong state arrives', () => {
    const { pending } = setup();
    const { state, nonce } = pending.start();

    pending.take({ state: `${state.slice(0, -1)}x`, nonce });

    expect(pending.take({ state, nonce }).ok).toBe(true);
  });

  it('refuses a callback without the cookie of the browser that started it, and ends that sign-in', () => {
    const { pending } = setup();
    const { state, nonce } = pending.start();

    expect(pending.take({ state, nonce: undefined })).toEqual({ ok: false, reason: 'failed' });
    expect(pending.take({ state, nonce })).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses a callback with another browser cookie', () => {
    const { pending } = setup();
    const { state } = pending.start();

    expect(pending.take({ state, nonce: 'someone-else' })).toEqual({
      ok: false,
      reason: 'failed',
    });
  });
});
