// @ts-check
import {
  asObject,
  asString,
  isAllowedRepo,
  MAX_CANDIDATES,
  nothing,
  parseJson,
  repoFromUrl,
} from './shared.js';

/**
 * Reads a list of releases. They are candidates only; to cite one the model fetches it.
 * @type {import('./shared.js').Extractor}
 */
export async function extractReleaseList({ text }, { repos }) {
  const items = parseJson(text);
  if (!Array.isArray(items)) {
    return nothing('unparseable');
  }
  /** @type {import('../registry.js').Candidate[]} */
  const candidates = [];
  for (const item of items) {
    const release = asObject(item);
    const url = asString(release.html_url);
    const title = asString(release.tag_name) || asString(release.name);
    if (
      url !== '' &&
      title !== '' &&
      isAllowedRepo(repos, repoFromUrl(url)) &&
      candidates.length < MAX_CANDIDATES
    ) {
      candidates.push({ type: 'github', title, url });
    }
  }
  return { sources: [], candidates, blocked: false };
}
