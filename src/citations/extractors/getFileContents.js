// @ts-check
import {
  isAllowedRepo,
  isFullSha,
  nothing,
  repoFromArguments,
  asObject,
  asString,
} from './shared.js';

// The resource a file result names: repo://<owner>/<repo>/sha/<commit>/contents/<path>. The SHA in
// it is the commit the file was read at (checked against the repository's head commit on real
// data). It is not the blob SHA that the "successfully downloaded" line and directory listings show.
const RESOURCE_URI = /repo:\/\/([^/\s"]+\/[^/\s"]+)\/sha\/([0-9a-f]{40})\/contents\/([^\s"]+)/;
const DIRECTORY_START = '[';

/**
 * Percent-decodes a path, leaving it as it is when it is not validly encoded.
 * @param {string} path - The path.
 * @returns {string} The decoded path.
 */
function decodePath(path) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * Builds a github.com file link for a path.
 * @param {string} repo - `owner/repo`.
 * @param {string} ref - A commit SHA, or HEAD for the default branch.
 * @param {string} path - The file path.
 * @returns {string} The link.
 */
function blobUrl(repo, ref, path) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${repo}/blob/${ref}/${encoded}`;
}

/**
 * Looks up the head commit through the context, never letting a failure there escape.
 * @param {import('./shared.js').ExtractContext} context - The context.
 * @param {string} repo - `owner/repo`.
 * @returns {Promise<string | undefined>} A full commit SHA, or undefined.
 */
async function lookUpHead(context, repo) {
  try {
    const sha = await context.resolveHead(repo);
    return isFullSha(sha) ? sha : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads a file the model fetched. The commit it is pinned to comes only from the resource named
 * in the result; a blob SHA is never used as one. When the result names no commit, the head commit
 * of the default branch is looked up, and when that fails the link is to the default branch and
 * marked as not pinned. A directory listing is not a source.
 * @type {import('./shared.js').Extractor}
 */
export async function extractFileContents({ args, text, log }, context) {
  if (text.trimStart().startsWith(DIRECTORY_START)) {
    return nothing('directory');
  }
  const named = RESOURCE_URI.exec(log ?? '');
  const repo = named?.[1] ?? repoFromArguments(args);
  const path = named === null ? asString(asObject(args).path) : decodePath(named[3]);
  if (path === '' || path.endsWith('/')) {
    return nothing('no-file-path');
  }
  if (!isAllowedRepo(context.repos, repo) || repo === undefined) {
    return nothing('repo-not-allowed');
  }
  const commitSha = named?.[2] ?? (await lookUpHead(context, repo)) ?? '';
  const pinned = commitSha !== '';
  return {
    sources: [
      {
        type: 'github',
        repo,
        path,
        title: path,
        commitSha,
        url: blobUrl(repo, pinned ? commitSha : 'HEAD', path),
        latestUrl: blobUrl(repo, 'HEAD', path),
        kind: 'file',
        pinned,
      },
    ],
    candidates: [],
    blocked: false,
  };
}
