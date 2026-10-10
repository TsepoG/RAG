// @ts-check
import {
  asObject,
  asString,
  isAllowedRepo,
  isFullSha,
  nothing,
  parseJson,
  repoFromUrl,
} from './shared.js';

/**
 * Reads a release the model fetched. Its link names the tag, which does not move, so it is pinned.
 * The commit is recorded when the release names one; a branch name there is not a commit.
 * @type {import('./shared.js').Extractor}
 */
export async function extractRelease({ text }, { repos }) {
  const release = asObject(parseJson(text));
  const url = asString(release.html_url);
  const repo = repoFromUrl(url);
  const title = asString(release.tag_name) || asString(release.name);
  if (url === '' || title === '') {
    return nothing('unparseable');
  }
  if (!isAllowedRepo(repos, repo) || repo === undefined) {
    return nothing('repo-not-allowed');
  }
  return {
    sources: [
      {
        type: 'github',
        repo,
        path: '',
        title,
        commitSha: isFullSha(release.target_commitish) ? String(release.target_commitish) : '',
        url,
        latestUrl: url,
        kind: 'release',
        pinned: true,
      },
    ],
    candidates: [],
    blocked: false,
  };
}
