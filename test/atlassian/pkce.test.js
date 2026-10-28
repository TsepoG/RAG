// @ts-check
import { describe, expect, it } from 'vitest';
import {
  challengeFor,
  CHALLENGE_METHOD,
  createPkce,
  RANDOM_BYTES,
  randomToken,
} from '../../src/atlassian/pkce.js';

/** The example pair from RFC 7636, appendix B. */
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('challengeFor', () => {
  it('matches the S256 example in RFC 7636', () => {
    expect(challengeFor(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
    expect(CHALLENGE_METHOD).toBe('S256');
  });
});

describe('randomToken', () => {
  it('turns 32 random bytes into 43 URL-safe characters', () => {
    /** @type {number[]} */
    const sizes = [];
    const token = randomToken((size) => {
      sizes.push(size);
      return Buffer.alloc(size, 0xfb);
    });

    expect(sizes).toEqual([RANDOM_BYTES]);
    expect(token).toMatch(/^[\w-]{43}$/);
  });

  it('is different each time with real randomness', () => {
    expect(randomToken()).not.toBe(randomToken());
  });
});

describe('createPkce', () => {
  it('makes a verifier whose challenge is its S256 hash', () => {
    const { verifier, challenge } = createPkce();

    expect(verifier).toMatch(/^[\w-]{43}$/);
    expect(challenge).toBe(challengeFor(verifier));
  });

  it('takes its randomness from the source it is given', () => {
    const pair = createPkce((size) => Buffer.alloc(size, 1));

    expect(pair).toEqual(createPkce((size) => Buffer.alloc(size, 1)));
  });
});
