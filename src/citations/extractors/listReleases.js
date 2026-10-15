// @ts-check
import { releaseListFingerprint } from '../fingerprints.js';
import {
  asObject,
  asString,
  isAllowedRepo,
  lookUpHead,
  MAX_CANDIDATES,
  nothing,
  parseJson,
  repoFromArguments,
  repoFromUrl,
} from './shared.js';

/**
 * Reads a list of releases the model fetched. The list is a source for which releases exist and
 * when they were made, pinned like a folder listing: to the head commit when it can be found. Each
 * release in it is also a candidate; to cite one on its own the model fetches it.
 * @type {import('./shared.js').Extractor}
 */
export async function extractReleaseList({ args, text }, context) {
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
      isAllowedRepo(context.repos, repoFromUrl(url)) &&
      candidates.length < MAX_CANDIDATES
    ) {
      candidates.push({ type: 'github', title, url });
    }
  }
  const repo = repoFromArguments(args);
  if (items.length === 0 || repo === undefined || !isAllowedRepo(context.repos, repo)) {
    return { sources: [], candidates, blocked: false };
  }
  const commitSha = (await lookUpHead(context, repo)) ?? '';
  // The list comes newest first.
  const newest = asString(asObject(items[0]).tag_name) || asString(asObject(items[0]).name);
  const url = `https://github.com/${repo}/releases`;
  return {
    sources: [
      {
        type: 'github',
        repo,
        path: '',
        title: 'Releases',
        commitSha,
        url,
        latestUrl: url,
        kind: 'releases',
        pinned: commitSha !== '',
        ...(newest === '' ? {} : { fingerprint: releaseListFingerprint(newest) }),
      },
    ],
    candidates,
    blocked: false,
  };
}
