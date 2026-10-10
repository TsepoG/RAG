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
 * Reads the hits of a code search. They are candidates only, because the model has seen snippets,
 * not files. A hit in a repository that is not allowed is left out.
 * @type {import('./shared.js').Extractor}
 */
export async function extractCodeSearch({ text }, { repos }) {
  const items = asObject(parseJson(text)).items;
  if (!Array.isArray(items)) {
    return nothing('unparseable');
  }
  /** @type {import('../registry.js').Candidate[]} */
  const candidates = [];
  for (const item of items) {
    const hit = asObject(item);
    const url = asString(hit.html_url);
    const repo = asString(asObject(hit.repository).full_name) || repoFromUrl(url);
    const title = asString(hit.path) || asString(hit.name);
    if (
      url !== '' &&
      title !== '' &&
      isAllowedRepo(repos, repo) &&
      candidates.length < MAX_CANDIDATES
    ) {
      candidates.push({ type: 'github', title, url });
    }
  }
  return { sources: [], candidates, blocked: false };
}
