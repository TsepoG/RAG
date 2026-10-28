// @ts-check
import { randomBytes as cryptoRandomBytes, timingSafeEqual } from 'node:crypto';
import { createPkce, randomToken } from './pkce.js';

/** How long a started sign-in may take before it has to be started again: 10 minutes. */
export const PENDING_SIGN_IN_MS = 10 * 60_000;

/**
 * What a started sign-in hands to the browser and to Atlassian. The verifier is not among them: it
 * stays in the server until the code is exchanged.
 * @typedef {object} StartedSignIn
 * @property {string} state - Sent to Atlassian, which sends it back on the callback.
 * @property {string} nonce - Set as a cookie in the browser that started the sign-in.
 * @property {string} challenge - The PKCE challenge for the authorize request.
 */

/**
 * What became of a callback's state and cookie. `expired` covers a sign-in that took too long, was
 * already used, or was never started here; `failed` is a callback from another browser.
 * @typedef {{ ok: true, verifier: string } | { ok: false, reason: 'expired' | 'failed' }} TakenSignIn
 */

/**
 * The one sign-in waiting for its callback.
 * @typedef {object} PendingSignIn
 * @property {string} state - The state sent to Atlassian.
 * @property {string} nonce - The cookie value of the browser that started it.
 * @property {string} verifier - The PKCE verifier.
 * @property {number} expiresAt - When it stops being accepted, in ms.
 */

/**
 * Compares two secrets in a time that does not depend on where they differ.
 * @param {string} given - What arrived.
 * @param {string} expected - What was kept.
 * @returns {boolean} True when they are the same.
 */
function sameSecret(given, expected) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Keeps the sign-in that has been started and is waiting for Atlassian to send the browser back.
 * Only one can wait at a time: starting another replaces it. Each is accepted once, within 10
 * minutes, and only from the browser that started it.
 * @param {{ clock: { now: () => number }, randomBytes?: import('./pkce.js').RandomBytes }} deps - Time and randomness.
 * @returns {{ start: () => StartedSignIn, take: (callback: { state: string, nonce: string | undefined }) => TakenSignIn }} The store.
 */
export function createPendingSignIns({ clock, randomBytes = cryptoRandomBytes }) {
  /** @type {PendingSignIn | undefined} */
  let pending;

  return {
    start() {
      const { verifier, challenge } = createPkce(randomBytes);
      const state = randomToken(randomBytes);
      const nonce = randomToken(randomBytes);
      pending = { state, nonce, verifier, expiresAt: clock.now() + PENDING_SIGN_IN_MS };
      return { state, nonce, challenge };
    },
    take({ state, nonce }) {
      const current = pending;
      // A state that matches nothing leaves the waiting sign-in alone, so a stray request cannot
      // cancel it.
      if (current === undefined || !sameSecret(state, current.state)) {
        return { ok: false, reason: 'expired' };
      }
      pending = undefined;
      if (clock.now() >= current.expiresAt) {
        return { ok: false, reason: 'expired' };
      }
      if (nonce === undefined || !sameSecret(nonce, current.nonce)) {
        return { ok: false, reason: 'failed' };
      }
      return { ok: true, verifier: current.verifier };
    },
  };
}
