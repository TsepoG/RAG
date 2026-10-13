// @ts-check
import { AppError } from '../errors/index.js';
import { byKey, identityOf, KEY_PREFIX } from './registry.js';

/** Separates the parts of an identity. */
const SEPARATOR = '\u0000';

/**
 * The registry of a whole conversation. It is a citation registry with the same interface as the
 * one a single question uses, plus what a conversation needs:
 * - keys continue from turn to turn, so an earlier turn's key can be cited in a later one;
 * - each source records the turn it was first fetched in, and when;
 * - fetching the same thing again returns the same key, but fetching it again and finding it
 *   different gives a new key and marks the old one `changed`, with no lookup of any kind: the
 *   fingerprint the extractor wrote is all it compares;
 * - `turnView()` is what one turn sees, so its answer lists only what that turn used.
 * @typedef {import('./registry.js').CitationRegistry & {
 *   setTurn: (turn: number) => void,
 *   turn: () => number,
 *   markChanged: (key: string) => void,
 *   turnView: () => import('./registry.js').CitationRegistry,
 * }} ConversationRegistry
 */

/**
 * What a source is, apart from which state of it was seen: a page, or a path in a repository. Two
 * sources of one subject with different fingerprints are two states of the same thing.
 * @param {import('./registry.js').Source} source - The source.
 * @returns {string} The subject.
 */
function subjectOf(source) {
  return source.type === 'confluence'
    ? ['confluence', source.id].join(SEPARATOR)
    : ['github', source.repo.toLowerCase(), source.path, source.kind].join(SEPARATOR);
}

/**
 * Creates the registry for a conversation.
 * @param {{ clock: { now: () => number } }} deps - The time source.
 * @returns {ConversationRegistry} An empty registry, at turn 1.
 */
export function createConversationRegistry({ clock }) {
  /** @type {Map<string, string>} */
  const keyByIdentity = new Map();
  /** @type {Map<string, import('./registry.js').RegisteredSource>} */
  const byKeyName = new Map();
  /** @type {Map<string, string[]>} */
  const keysBySubject = new Map();
  /** @type {Map<string, import('./registry.js').Candidate>} */
  const candidatesByUrl = new Map();
  const counts = { confluence: 0, github: 0 };
  let currentTurn = 1;

  /**
   * Finds what makes two registrations the same source. A source with a fingerprint is the same as
   * another of its subject with the same fingerprint, however the link was pinned; one without is
   * the same only as one that is identical, as in a single question.
   * @param {import('./registry.js').Source} source - The source.
   * @returns {string} The identity.
   */
  function identity(source) {
    return source.fingerprint === undefined
      ? identityOf(source)
      : [subjectOf(source), source.fingerprint].join(SEPARATOR);
  }

  /**
   * Sets whether a key is marked changed, keeping the source frozen.
   * @param {string} key - The key.
   * @param {boolean} changed - Whether the source changed since it was fetched.
   */
  function setChanged(key, changed) {
    const source = byKeyName.get(key);
    if (source !== undefined && source.changed !== changed) {
      byKeyName.set(key, Object.freeze({ ...source, changed }));
    }
  }

  /**
   * Says which key is the current state of a subject: every other key of it is then a state that
   * has been replaced.
   * @param {string} subject - The subject.
   * @param {string} current - The key of its latest state.
   */
  function settle(subject, current) {
    const keys = keysBySubject.get(subject) ?? [];
    if (!keys.includes(current)) {
      keys.push(current);
    }
    keysBySubject.set(subject, keys);
    keys.forEach((key) => setChanged(key, key !== current));
  }

  /**
   * Gives a new source its key.
   * @param {import('./registry.js').Source} source - The source.
   * @param {string} id - Its identity.
   * @returns {string} The key.
   */
  function create(source, id) {
    counts[source.type] += 1;
    const key = `${KEY_PREFIX[source.type]}${counts[source.type]}`;
    byKeyName.set(
      key,
      Object.freeze({
        ...source,
        key,
        fetchedInTurn: currentTurn,
        fetchedAt: clock.now(),
        changed: false,
      }),
    );
    keyByIdentity.set(id, key);
    return key;
  }

  /** @type {ConversationRegistry} */
  const registry = {
    register(source) {
      const id = identity(source);
      const key = keyByIdentity.get(id) ?? create(source, id);
      if (source.fingerprint !== undefined) {
        settle(subjectOf(source), key);
      }
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
    setTurn(turn) {
      if (!Number.isInteger(turn) || turn < 1) {
        throw new AppError(`A turn is a whole number from 1, not ${turn}.`);
      }
      currentTurn = turn;
    },
    turn: () => currentTurn,
    markChanged: (key) => setChanged(key, true),
    turnView() {
      /** @type {Set<string>} */
      const used = new Set();
      /** @type {Map<string, import('./registry.js').Candidate>} */
      const candidates = new Map();
      return {
        register(source) {
          const key = registry.register(source);
          used.add(key);
          return key;
        },
        // A reply can only look up a key it cites (or a conflict names), so a key looked up here
        // is one this turn used, whichever turn fetched it.
        get(key) {
          const source = registry.get(key);
          if (source !== undefined) {
            used.add(key);
          }
          return source;
        },
        // A key is only ever added to `used` after it was found, so it is always there.
        list: () =>
          [...used]
            .map(
              (key) => /** @type {import('./registry.js').RegisteredSource} */ (byKeyName.get(key)),
            )
            .sort(byKey),
        addCandidate(candidate) {
          registry.addCandidate(candidate);
          if (!candidates.has(candidate.url)) {
            candidates.set(candidate.url, Object.freeze({ ...candidate }));
          }
        },
        candidates: () => [...candidates.values()],
      };
    },
  };
  return registry;
}
