// @ts-check

/**
 * Someone worth asking, and which of the answer's sources they are tied to.
 * @typedef {object} WhoToAsk
 * @property {string} name - A display name, or an owner exactly as CODEOWNERS writes it.
 * @property {string[]} sourceKeys - Keys of the sources they edited or own, in key order.
 */

/** Most people suggested; more would stop being useful. */
export const MAX_PEOPLE = 5;

/**
 * Stands in for "a file in this folder", so a folder is asked about the way its files are.
 * @type {string}
 */
const FOLDER_PROBE = '_';

/**
 * Works out who owns a GitHub source, from CODEOWNERS.
 * @param {import('../citations/index.js').RegisteredSource & { type: 'github' }} source - A file or folder source.
 * @param {{ ownersOf: (repo: string, path: string) => Promise<string[]> }} lookup - The CODEOWNERS lookup.
 * @returns {Promise<string[]>} The owners; empty for a source that has no path.
 */
async function ownersOfSource(source, lookup) {
  if (source.kind === 'file') {
    return lookup.ownersOf(source.repo, source.path);
  }
  // A folder is owned by whoever owns what is inside it. The top folder has no rule of its own.
  return source.kind === 'directory' && source.path !== ''
    ? lookup.ownersOf(source.repo, `${source.path}/${FOLDER_PROBE}`)
    : [];
}

/**
 * Suggests who to ask about what the answer could not settle, with no extra model call: the person
 * who last saved a Confluence page the model read (when the page said who), and the CODEOWNERS of
 * the files and folders it read. Names are only returned, never logged.
 * @param {{ sources: ReadonlyArray<import('../citations/index.js').RegisteredSource>, lookup: { ownersOf: (repo: string, path: string) => Promise<string[]> } }} input
 *   The sources the model was given (cited or not) and the CODEOWNERS lookup.
 * @returns {Promise<WhoToAsk[]>} At most five people, in the order their sources were first seen.
 */
export async function buildWhoToAsk({ sources, lookup }) {
  const found = await Promise.all(
    sources.map(async (source) => ({
      key: source.key,
      names:
        source.type === 'confluence'
          ? [source.lastEditor ?? ''].filter((name) => name !== '')
          : await ownersOfSource(source, lookup),
    })),
  );
  /** @type {Map<string, string[]>} */
  const byName = new Map();
  found.forEach(({ key, names }) => {
    names.forEach((name) => {
      byName.set(name, [...(byName.get(name) ?? []), key]);
    });
  });
  return [...byName]
    .slice(0, MAX_PEOPLE)
    .map(([name, sourceKeys]) => ({ name, sourceKeys: [...new Set(sourceKeys)] }));
}
