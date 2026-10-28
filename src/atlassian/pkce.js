// @ts-check
import { createHash, randomBytes as cryptoRandomBytes } from 'node:crypto';

/**
 * Makes random bytes. Injected so tests can make the values predictable.
 * @typedef {(size: number) => Buffer} RandomBytes
 */

/** How many random bytes a verifier, a state or a nonce is made of: 256 bits each. */
export const RANDOM_BYTES = 32;

/** The only PKCE method Atlassian supports, and the only one this app uses. */
export const CHALLENGE_METHOD = 'S256';

const BASE64URL = 'base64url';

/**
 * The PKCE pair for one sign-in: the verifier stays in the app, the challenge goes to Atlassian.
 * @typedef {object} Pkce
 * @property {string} verifier - Sent only with the token exchange.
 * @property {string} challenge - `base64url(sha256(verifier))`, sent with the authorize request.
 */

/**
 * Makes a random value that is safe to put in a URL: 32 random bytes as base64url, 43 characters.
 * @param {RandomBytes} [randomBytes] - The source of randomness; defaults to node:crypto.
 * @returns {string} The value.
 */
export function randomToken(randomBytes = cryptoRandomBytes) {
  return randomBytes(RANDOM_BYTES).toString(BASE64URL);
}

/**
 * Works out the S256 challenge for a verifier.
 * @param {string} verifier - The verifier.
 * @returns {string} `base64url(sha256(verifier))`.
 */
export function challengeFor(verifier) {
  return createHash('sha256').update(verifier).digest(BASE64URL);
}

/**
 * Makes a fresh PKCE pair.
 * @param {RandomBytes} [randomBytes] - The source of randomness; defaults to node:crypto.
 * @returns {Pkce} The verifier and its challenge.
 */
export function createPkce(randomBytes = cryptoRandomBytes) {
  const verifier = randomToken(randomBytes);
  return { verifier, challenge: challengeFor(verifier) };
}
