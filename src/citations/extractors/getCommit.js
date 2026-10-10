// @ts-check
import {
  asObject,
  asString,
  firstLine,
  isAllowedRepo,
  isFullSha,
  nothing,
  parseJson,
  repoFromArguments,
  repoFromUrl,
} from './shared.js';

/**
 * Reads a commit the model fetched. A commit is its own pin: its SHA names it exactly.
 * @type {import('./shared.js').Extractor}
 */
export async function extractCommit({ args, text }, { repos }) {
  const commit = asObject(parseJson(text));
  const sha = commit.sha;
  if (!isFullSha(sha)) {
    return nothing('unparseable');
  }
  const repo = repoFromUrl(asString(commit.html_url)) ?? repoFromArguments(args);
  if (!isAllowedRepo(repos, repo) || repo === undefined) {
    return nothing('repo-not-allowed');
  }
  const url = `https://github.com/${repo}/commit/${sha}`;
  return {
    sources: [
      {
        type: 'github',
        repo,
        path: '',
        title:
          firstLine(asString(asObject(commit.commit).message)) ||
          `Commit ${String(sha).slice(0, 7)}`,
        commitSha: String(sha),
        url,
        latestUrl: url,
        kind: 'commit',
        pinned: true,
      },
    ],
    candidates: [],
    blocked: false,
  };
}
