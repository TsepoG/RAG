// @ts-check
import { createHash } from 'node:crypto';

/**
 * A fingerprint says whether a source is still the same thing it was when the model read it: a
 * page version, a file's blob, a folder's entries, a release list's newest tag. It is opaque. The
 * extractors write it when a source is fetched and the re-check writes it again from the live
 * thing, through these same functions, so the two can be compared.
 *
 * A file's blob SHA is hashed on purpose: it must never be taken for the commit a link is pinned
 * to, and the extractors' tests check that it does not appear in a source.
 */

/** How many hex digits of a hash are kept; plenty to tell two versions of a file apart. */
const HASH_LENGTH = 16;

/** Separates the parts that are hashed, so `a`, `bc` and `ab`, `c` do not hash alike. */
const SEPARATOR = '\u0000';

/**
 * Hashes parts into a short fingerprint.
 * @param {string} kind - What is being fingerprinted, so a file and a folder never match.
 * @param {ReadonlyArray<string>} parts - What identifies its current state.
 * @returns {string} The fingerprint.
 */
function hashed(kind, parts) {
  const digest = createHash('sha256')
    .update([kind, ...parts].join(SEPARATOR))
    .digest('hex');
  return `${kind}:${digest.slice(0, HASH_LENGTH)}`;
}

/**
 * Fingerprints a Confluence page.
 * @param {number} version - The page's version number.
 * @returns {string} The fingerprint.
 */
export function pageFingerprint(version) {
  return `page:${version}`;
}

/**
 * Fingerprints a file by its blob SHA.
 * @param {string} blobSha - The file's blob SHA.
 * @returns {string} The fingerprint.
 */
export function blobFingerprint(blobSha) {
  return hashed('blob', [blobSha]);
}

/**
 * Fingerprints a folder by what is in it: the name and blob or tree SHA of each entry, whatever
 * order they were listed in.
 * @param {ReadonlyArray<{ name: string, sha: string }>} entries - The entries.
 * @returns {string} The fingerprint.
 */
export function entriesFingerprint(entries) {
  const lines = entries.map(({ name, sha }) => `${name}${SEPARATOR}${sha}`).sort();
  return hashed('entries', lines);
}

/**
 * Fingerprints a list of releases by the newest tag in it.
 * @param {string} newestTag - The tag of the newest release.
 * @returns {string} The fingerprint.
 */
export function releaseListFingerprint(newestTag) {
  return `releases:${newestTag}`;
}
