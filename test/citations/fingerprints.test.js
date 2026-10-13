// @ts-check
import { describe, expect, it } from 'vitest';
import {
  blobFingerprint,
  entriesFingerprint,
  pageFingerprint,
  releaseListFingerprint,
} from '../../src/citations/index.js';

const BLOB = '57f682c9d938c83e89b36d164d53cfd37a5d7893';
const OTHER_BLOB = 'd80951b943c0ee2f7d7902e6dfb269b0056ea3d7';

describe('pageFingerprint and releaseListFingerprint', () => {
  it('say the version or the newest tag in plain words', () => {
    expect(pageFingerprint(7)).toBe('page:7');
    expect(releaseListFingerprint('v0.2.0')).toBe('releases:v0.2.0');
  });
});

describe('blobFingerprint', () => {
  it('is the same for the same blob and different for another', () => {
    expect(blobFingerprint(BLOB)).toBe(blobFingerprint(BLOB));
    expect(blobFingerprint(BLOB)).not.toBe(blobFingerprint(OTHER_BLOB));
  });

  it('never contains the blob SHA, so it cannot be taken for a commit', () => {
    expect(blobFingerprint(BLOB)).toMatch(/^blob:[0-9a-f]{16}$/);
    expect(blobFingerprint(BLOB)).not.toContain(BLOB);
  });
});

describe('entriesFingerprint', () => {
  const entries = [
    { name: 'a.py', sha: BLOB },
    { name: 'b.py', sha: OTHER_BLOB },
  ];

  it('is the same whatever order the entries were listed in', () => {
    expect(entriesFingerprint(entries)).toBe(entriesFingerprint([...entries].reverse()));
  });

  it.each([
    ['a changed file', [{ name: 'a.py', sha: OTHER_BLOB }, entries[1]]],
    ['a renamed file', [{ name: 'c.py', sha: BLOB }, entries[1]]],
    ['a removed file', [entries[0]]],
    ['a new file', [...entries, { name: 'c.py', sha: BLOB }]],
  ])('differs for %s', (_name, changed) => {
    expect(entriesFingerprint(changed)).not.toBe(entriesFingerprint(entries));
  });

  it('does not mix up a name and a SHA that run together', () => {
    expect(entriesFingerprint([{ name: 'ab', sha: 'c' }])).not.toBe(
      entriesFingerprint([{ name: 'a', sha: 'bc' }]),
    );
  });

  it('is never the same as a file fingerprint', () => {
    expect(entriesFingerprint([{ name: 'a', sha: BLOB }])).not.toBe(blobFingerprint(BLOB));
  });
});
