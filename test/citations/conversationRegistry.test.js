// @ts-check
import { describe, expect, it } from 'vitest';
import {
  blobFingerprint,
  createConversationRegistry,
  entriesFingerprint,
  pageFingerprint,
  releaseListFingerprint,
} from '../../src/citations/index.js';
import { AppError } from '../../src/errors/index.js';
import { assembleAnswer } from '../../src/answer/result.js';
import { confluenceSource, githubSource } from '../helpers/sources.js';

/**
 * A registry with a clock the test moves.
 * @returns {{ registry: ReturnType<typeof createConversationRegistry>, setNow: (ms: number) => void }} The registry and the clock.
 */
function setup() {
  let now = 1000;
  return {
    registry: createConversationRegistry({ clock: { now: () => now } }),
    setNow: (ms) => (now = ms),
  };
}

/**
 * A Confluence page at a version, with its fingerprint.
 * @param {number} version - The version.
 * @param {string} [id] - The page id.
 * @returns {import('../../src/citations/index.js').Source} The source.
 */
function page(version, id = '100') {
  return {
    ...confluenceSource({ id, title: `Page ${id}`, version }),
    fingerprint: pageFingerprint(version),
  };
}

/**
 * A file read at a commit, with the fingerprint of its blob.
 * @param {string} blob - The blob SHA.
 * @param {string} commit - The commit it was read at.
 * @param {string} [path] - The path.
 * @returns {import('../../src/citations/index.js').Source} The source.
 */
function file(blob, commit, path = 'src/a.js') {
  return {
    ...githubSource({ path, title: path, commitSha: commit }),
    fingerprint: blobFingerprint(blob),
  };
}

const COMMIT_1 = 'a'.repeat(40);
const COMMIT_2 = 'b'.repeat(40);

describe('conversation registry numbering', () => {
  it('continues the keys from turn to turn, each kind of key on its own', () => {
    const { registry } = setup();

    const first = [registry.register(page(1, '1')), registry.register(file('b1', COMMIT_1))];
    registry.setTurn(2);
    const second = [registry.register(page(1, '2')), registry.register(file('b2', COMMIT_1, 'x'))];

    expect(first).toEqual(['C1', 'G1']);
    expect(second).toEqual(['C2', 'G2']);
  });

  it('keeps an earlier key gettable and listed in a later turn, Confluence first', () => {
    const { registry } = setup();
    registry.register(file('b1', COMMIT_1));
    registry.register(page(1));
    registry.setTurn(2);

    expect(registry.get('G1')).toMatchObject({ key: 'G1' });
    expect(registry.list().map(({ key }) => key)).toEqual(['C1', 'G1']);
  });

  it('gives an unknown key nothing', () => {
    expect(setup().registry.get('C9')).toBeUndefined();
  });

  it('starts at turn 1 and refuses a turn that is not a whole number from 1', () => {
    const { registry } = setup();

    expect(registry.turn()).toBe(1);
    registry.setTurn(3);
    expect(registry.turn()).toBe(3);
    for (const turn of [0, -1, 1.5, Number.NaN]) {
      expect(() => registry.setTurn(turn)).toThrow(AppError);
    }
  });
});

describe('conversation registry when a source was fetched', () => {
  it('records the turn and the time it was first fetched', () => {
    const { registry, setNow } = setup();
    registry.setTurn(2);
    setNow(5000);

    const key = registry.register(page(1));

    expect(registry.get(key)).toMatchObject({ fetchedInTurn: 2, fetchedAt: 5000, changed: false });
  });

  it('gives the same page at the same version the same key, and keeps when it was first fetched', () => {
    const { registry, setNow } = setup();
    const first = registry.register(page(1));
    registry.setTurn(3);
    setNow(9000);

    const again = registry.register(page(1));

    expect(again).toBe(first);
    expect(registry.get(first)).toMatchObject({ fetchedInTurn: 1, fetchedAt: 1000 });
    expect(registry.list()).toHaveLength(1);
  });

  it('gives the same file at the same blob the same key, though the head commit moved', () => {
    const { registry } = setup();
    const first = registry.register(file('blob-1', COMMIT_1));
    registry.setTurn(2);

    const again = registry.register(file('blob-1', COMMIT_2));

    expect(again).toBe(first);
    expect(registry.get(first)).toMatchObject({ commitSha: COMMIT_1, changed: false });
  });

  it('keeps two different files apart', () => {
    const { registry } = setup();

    const keys = [
      registry.register(file('blob-1', COMMIT_1, 'a.js')),
      registry.register(file('blob-1', COMMIT_1, 'b.js')),
    ];

    expect(keys).toEqual(['G1', 'G2']);
    expect(registry.list().some(({ changed }) => changed)).toBe(false);
  });

  it('treats a source with no fingerprint as the same only when it is identical', () => {
    const { registry } = setup();
    const plain = (/** @type {string} */ commit) => githubSource({ commitSha: commit });

    const keys = [
      registry.register(plain(COMMIT_1)),
      registry.register(plain(COMMIT_1)),
      registry.register(plain(COMMIT_2)),
    ];

    expect(keys).toEqual(['G1', 'G1', 'G2']);
    expect(registry.list().some(({ changed }) => changed)).toBe(false);
  });
});

describe('conversation registry when a source is fetched again and has changed', () => {
  it.each([
    ['a page', () => page(1), () => page(2)],
    ['a file', () => file('blob-1', COMMIT_1), () => file('blob-2', COMMIT_2)],
    [
      'a folder',
      () => ({
        ...githubSource({ kind: 'directory', path: 'src', title: 'src/' }),
        fingerprint: entriesFingerprint([{ name: 'a', sha: '1' }]),
      }),
      () => ({
        ...githubSource({ kind: 'directory', path: 'src', title: 'src/' }),
        fingerprint: entriesFingerprint([{ name: 'a', sha: '2' }]),
      }),
    ],
    [
      'a list of releases',
      () => ({
        ...githubSource({ kind: 'releases', path: '', title: 'Releases' }),
        fingerprint: releaseListFingerprint('v1'),
      }),
      () => ({
        ...githubSource({ kind: 'releases', path: '', title: 'Releases' }),
        fingerprint: releaseListFingerprint('v2'),
      }),
    ],
  ])(
    'gives %s a new key and marks the old key changed, without any lookup',
    (_what, before, after) => {
      const { registry } = setup();
      const old = registry.register(before());
      registry.setTurn(2);

      const fresh = registry.register(after());

      expect(fresh).not.toBe(old);
      expect(registry.get(old)).toMatchObject({ changed: true });
      expect(registry.get(fresh)).toMatchObject({ changed: false, fetchedInTurn: 2 });
    },
  );

  it('marks every earlier state changed, and only the newest not', () => {
    const { registry } = setup();
    const [one, two, three] = [1, 2, 3].map((version) => registry.register(page(version)));

    expect([one, two, three].map((key) => registry.get(key)?.changed)).toEqual([true, true, false]);
  });

  it("puts a page that went back to an earlier version on that version's key, and changes the rest", () => {
    const { registry } = setup();
    const v1 = registry.register(page(1));
    const v2 = registry.register(page(2));

    const back = registry.register(page(1));

    expect(back).toBe(v1);
    expect(registry.get(v1)?.changed).toBe(false);
    expect(registry.get(v2)?.changed).toBe(true);
  });

  it('does not touch another page when one changes', () => {
    const { registry } = setup();
    const other = registry.register(page(1, '200'));
    registry.register(page(1, '100'));

    registry.register(page(2, '100'));

    expect(registry.get(other)?.changed).toBe(false);
  });

  it('can be told by a re-check that a key changed, and ignores an unknown key', () => {
    const { registry } = setup();
    const key = registry.register(page(1));

    registry.markChanged(key);
    registry.markChanged('C9');

    expect(registry.get(key)?.changed).toBe(true);
    expect(registry.get('C9')).toBeUndefined();
  });

  it('keeps a source frozen when it is marked changed', () => {
    const { registry } = setup();
    const key = registry.register(page(1));

    registry.markChanged(key);

    expect(Object.isFrozen(registry.get(key))).toBe(true);
  });
});

describe('conversation registry candidates', () => {
  it('keeps each search hit once, by link, across turns', () => {
    const { registry } = setup();
    const hit = { type: /** @type {const} */ ('confluence'), title: 'A', url: 'https://x/a' };

    registry.addCandidate(hit);
    registry.setTurn(2);
    registry.addCandidate({ ...hit, title: 'again' });

    expect(registry.candidates()).toEqual([hit]);
  });
});

describe('a turn view', () => {
  it('lists what the turn fetched and what it looked up from an earlier turn, and nothing else', () => {
    const { registry } = setup();
    registry.register(page(1, '1'));
    registry.register(page(1, '2'));
    registry.register(page(1, '3'));
    registry.setTurn(2);
    const view = registry.turnView();

    view.register(file('blob-1', COMMIT_1));
    view.get('C2');

    expect(view.list().map(({ key }) => key)).toEqual(['C2', 'G1']);
  });

  it('counts a source fetched again in this turn as used, under its earlier key', () => {
    const { registry } = setup();
    const first = registry.register(page(1));
    registry.setTurn(2);
    const view = registry.turnView();

    const again = view.register(page(1));

    expect(again).toBe(first);
    expect(view.list().map(({ key }) => key)).toEqual([first]);
  });

  it('does not count a key that was never given out', () => {
    const view = setup().registry.turnView();

    expect(view.get('C9')).toBeUndefined();
    expect(view.list()).toEqual([]);
  });

  it('shows a key as changed once the conversation says so', () => {
    const { registry } = setup();
    const key = registry.register(page(1));
    registry.setTurn(2);
    const view = registry.turnView();
    view.get(key);

    registry.markChanged(key);

    expect(view.list()[0]).toMatchObject({ changed: true });
  });

  it('keeps the search hits of a turn apart from those of the turns before, but not from the conversation', () => {
    const { registry } = setup();
    registry.addCandidate({ type: 'github', title: 'old', url: 'https://x/old' });
    registry.setTurn(2);
    const view = registry.turnView();

    view.addCandidate({ type: 'github', title: 'new', url: 'https://x/new' });
    view.addCandidate({ type: 'github', title: 'new', url: 'https://x/new' });

    expect(view.candidates().map(({ title }) => title)).toEqual(['new']);
    expect(registry.candidates().map(({ title }) => title)).toEqual(['old', 'new']);
  });

  it('gives one turn its own view of what was used', () => {
    const { registry } = setup();
    const first = registry.turnView();
    first.register(page(1));

    expect(registry.turnView().list()).toEqual([]);
  });
});

describe('a turn view with the answer', () => {
  it('cites a source from an earlier turn by its key, and lists as consulted only what this turn touched', () => {
    const { registry } = setup();
    registry.register(page(1, '1'));
    registry.register(page(1, '2'));
    registry.register(file('blob-1', COMMIT_1));
    registry.setTurn(2);
    const view = registry.turnView();
    view.register(file('blob-2', COMMIT_1, 'src/b.js'));

    const parts = assembleAnswer({
      answer: 'The rule is in the first page [C1], and in the new file [G2].',
      role: { id: 'developer' },
      registry: view,
    });

    expect(parts.sources.map(({ key }) => key)).toEqual(['C1', 'G2']);
    expect(parts.uncitedSourceKeys).toEqual([]);
    expect(parts.alsoConsulted).toEqual([]);
    expect(parts.invalidKeys).toEqual([]);
  });

  it('still refuses a key that no turn ever fetched', () => {
    const { registry } = setup();
    registry.register(page(1));
    registry.setTurn(2);

    const parts = assembleAnswer({
      answer: 'This is stated in a page that was never read [C9].',
      role: { id: 'developer' },
      registry: registry.turnView(),
    });

    expect(parts.invalidKeys).toEqual(['C9']);
    expect(parts.sources).toEqual([]);
  });
});
