// @ts-check
import {
  asObject,
  asString,
  firstLine,
  isAllowedRepo,
  MAX_CANDIDATES,
  nothing,
  parseJson,
  repoFromUrl,
} from './shared.js';

/**
 * Reads a list of commits. They are candidates only: a list shows what exists, not what the model
 * read. To cite a commit the model fetches it with get_commit.
 * @type {import('./shared.js').Extractor}
 */
export async function extractCommitList({ text }, { repos }) {
  const items = parseJson(text);
  if (!Array.isArray(items)) {
    return nothing('unparseable');
  }
  /** @type {import('../registry.js').Candidate[]} */
  const candidates = [];
  for (const item of items) {
    const { html_url: url, commit } = asObject(item);
    const link = asString(url);
    if (
      link !== '' &&
      isAllowedRepo(repos, repoFromUrl(link)) &&
      candidates.length < MAX_CANDIDATES
    ) {
      candidates.push({
        type: 'github',
        title: firstLine(asString(asObject(commit).message)) || link,
        url: link,
      });
    }
  }
  return { sources: [], candidates, blocked: false };
}
