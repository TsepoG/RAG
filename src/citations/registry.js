// @ts-check

/**
 * A Confluence page the model was given.
 * @typedef {object} ConfluenceSource
 * @property {'confluence'} type - Source type.
 * @property {string} id - Page id.
 * @property {string} title - Page title.
 * @property {string} spaceKey - Space the page is in.
 * @property {number} version - Page version at the time it was fetched.
 * @property {string} [lastUpdated] - When that version was saved, as an ISO date.
 * @property {string} [lastEditor] - Display name of whoever saved that version, when the result
 *   names one. Only ever shown to the user as someone to ask; never logged.
 * @property {string} url - Link to the page.
 * @property {boolean} [stale] - True when the page was last updated over 12 months ago.
 */

/**
 * A file, commit or release on GitHub the model was given.
 * @typedef {object} GithubSource
 * @property {'github'} type - Source type.
 * @property {string} repo - Repository as `owner/repo`.
 * @property {string} path - File or folder path; empty for a commit, a release or the top folder.
 * @property {string} title - What to call it: the path, a short commit message or a tag name.
 * @property {string} commitSha - The commit the content is pinned to, or an empty string.
 * @property {string} url - Link to it, pinned to the commit when `pinned` is true.
 * @property {string} latestUrl - The same thing on the default branch.
 * @property {'file' | 'directory' | 'commit' | 'release'} kind - What it is.
 * @property {boolean} pinned - True when the link names an exact commit.
 */

/**
 * @typedef {ConfluenceSource | GithubSource} Source
 */

/**
 * A source with the key the model cites it by.
 * @typedef {Source & { key: string }} RegisteredSource
 */

/**
 * Something that came up in a search but was never fetched. It cannot be cited.
 * @typedef {object} Candidate
 * @property {'confluence' | 'github'} type - Where it was found.
 * @property {string} title - What to call it.
 * @property {string} url - Link to it.
 */

/**
 * The sources of one question, and the keys they are cited by.
 * @typedef {object} CitationRegistry
 * @property {(source: Source) => string} register - Records a source and returns its key. The same
 *   source, registered again, gets the same key.
 * @property {(key: string) => RegisteredSource | undefined} get - Finds a source by key.
 * @property {() => RegisteredSource[]} list - Every source, Confluence first, each in key order.
 * @property {(candidate: Candidate) => void} addCandidate - Notes a search hit that was not fetched.
 * @property {() => Candidate[]} candidates - The search hits noted so far, in the order seen.
 */

/** Key letters by source type. */
const KEY_PREFIX = Object.freeze({ confluence: 'C', github: 'G' });
const KEY_PATTERN = /^[CG][1-9]\d*$/;

/**
 * Whether text has the shape of a citation key, such as `C1` or `G12`.
 * @param {string} text - The text.
 * @returns {boolean} True when it looks like a key; it may still not be a registered one.
 */
export function isKeyShaped(text) {
  return KEY_PATTERN.test(text);
}

/**
 * Builds the text two registrations of the same thing share, so they get the same key. A new
 * version of a page, or a new commit of a file, is a different source.
 * @param {Source} source - The source.
 * @returns {string} The identity of the source.
 */
function identityOf(source) {
  if (source.type === 'confluence') {
    return `confluence\u0000${source.id}\u0000${source.version}`;
  }
  const repo = source.repo.toLowerCase();
  // Two releases can point at one commit, so a release is told apart by its tag too.
  const tag = source.kind === 'release' ? source.title : '';
  return ['github', repo, source.path, source.commitSha, source.kind, tag].join('\u0000');
}

/**
 * Orders keys by letter (Confluence first), then by number.
 * @param {RegisteredSource} a - A source.
 * @param {RegisteredSource} b - Another source.
 * @returns {number} Negative when `a` comes first.
 */
function byKey(a, b) {
  const letters = a.key.charAt(0).localeCompare(b.key.charAt(0));
  return letters === 0 ? Number(a.key.slice(1)) - Number(b.key.slice(1)) : letters;
}

/**
 * Creates the registry for one question. Keys are `C1, C2…` for Confluence pages and `G1, G2…` for
 * GitHub, numbered in the order the sources are first registered.
 * @returns {CitationRegistry} An empty registry.
 */
export function createCitationRegistry() {
  /** @type {Map<string, RegisteredSource>} */
  const byIdentity = new Map();
  /** @type {Map<string, RegisteredSource>} */
  const byKeyName = new Map();
  /** @type {Map<string, Candidate>} */
  const candidatesByUrl = new Map();
  const counts = { confluence: 0, github: 0 };

  return {
    register(source) {
      const identity = identityOf(source);
      const known = byIdentity.get(identity);
      if (known !== undefined) {
        return known.key;
      }
      counts[source.type] += 1;
      const key = `${KEY_PREFIX[source.type]}${counts[source.type]}`;
      const registered = Object.freeze({ ...source, key });
      byIdentity.set(identity, registered);
      byKeyName.set(key, registered);
      return key;
    },
    get: (key) => byKeyName.get(key),
    list: () => [...byKeyName.values()].sort(byKey),
    addCandidate(candidate) {
      if (!candidatesByUrl.has(candidate.url)) {
        candidatesByUrl.set(candidate.url, Object.freeze({ ...candidate }));
      }
    },
    candidates: () => [...candidatesByUrl.values()],
  };
}
