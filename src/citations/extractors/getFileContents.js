// @ts-check
import { blobFingerprint, entriesFingerprint } from '../fingerprints.js';
import {
  isAllowedRepo,
  lookUpHead,
  nothing,
  repoFromArguments,
  asObject,
  asString,
  parseJson,
} from './shared.js';

// The resource a file result names: repo://<owner>/<repo>/sha/<commit>/contents/<path>. The SHA in
// it is the commit the file was read at (checked against the repository's head commit on real
// data). It is not the blob SHA that the "successfully downloaded" line and directory listings show.
const RESOURCE_URI = /repo:\/\/([^/\s"]+\/[^/\s"]+)\/sha\/([0-9a-f]{40})\/contents\/([^\s"]+)/;
const DIRECTORY_START = '[';
// The model often asks for "/README.md"; the file is README.md, and a leading slash would put a
// double slash in the link and make one file two sources.
const LEADING_SLASHES = /^\/+/;
// A listed entry's link names the commit the listing was read at: .../blob|tree/<commit>/<path>.
// The first line of a downloaded file names its blob: "successfully downloaded text file (SHA: …)".
const BLOB_LINE = /^successfully downloaded [a-z ]*file \(SHA: ([0-9a-f]{40})\)/;
const ENTRY_LINK = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:blob|tree)\/([0-9a-f]{40})\//;

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
 * Builds a github.com folder link for a path.
 * @param {string} repo - `owner/repo`.
 * @param {string} ref - A commit SHA, or HEAD for the default branch.
 * @param {string} path - The folder path; empty for the top folder.
 * @returns {string} The link.
 */
function treeUrl(repo, ref, path) {
  const encoded = path === '' ? '' : `/${path.split('/').map(encodeURIComponent).join('/')}`;
  return `https://github.com/${repo}/tree/${ref}${encoded}`;
}

/**
 * Finds the commit a folder listing was read at, from the links of its entries. Only an entry of
 * the same repository counts, and an entry's own blob SHA is never in that position of the link.
 * @param {ReadonlyArray<unknown>} listing - The parsed listing.
 * @param {string} repo - `owner/repo`.
 * @returns {string | undefined} A full commit SHA, or undefined.
 */
function commitOfListing(listing, repo) {
  for (const entry of listing) {
    const link = ENTRY_LINK.exec(asString(asObject(entry).html_url));
    if (link !== null && link[1].toLowerCase() === repo.toLowerCase()) {
      return link[2];
    }
  }
  return undefined;
}

/**
 * Writes the field naming the ref the model asked to read, or nothing for the default branch.
 * @param {unknown} args - The arguments of the call.
 * @returns {{ ref?: string }} The field to spread into a source.
 */
function refField(args) {
  const ref = asString(asObject(args).ref).trim();
  return ref === '' ? {} : { ref };
}

/**
 * Writes the fingerprint field, or nothing when there is none.
 * @param {string | undefined} fingerprint - The fingerprint, if it could be worked out.
 * @returns {{ fingerprint?: string }} The field to spread into a source.
 */
function fingerprintField(fingerprint) {
  return fingerprint === undefined ? {} : { fingerprint };
}

/**
 * Fingerprints a downloaded file by the blob SHA on the first line of the result.
 * @param {string} text - The result text.
 * @returns {string | undefined} The fingerprint, or undefined when the result names no blob.
 */
function fileFingerprint(text) {
  const blob = BLOB_LINE.exec(text)?.[1];
  return blob === undefined ? undefined : blobFingerprint(blob);
}

/**
 * Fingerprints a folder listing by the name and SHA of each entry. Nothing when an entry lacks
 * either, because a listing that cannot be compared whole cannot be compared.
 * @param {ReadonlyArray<unknown>} listing - The parsed listing.
 * @returns {string | undefined} The fingerprint, or undefined.
 */
function listingFingerprint(listing) {
  const entries = listing.map((entry) => {
    const { name, sha } = asObject(entry);
    return { name: asString(name), sha: asString(sha) };
  });
  return entries.every(({ name, sha }) => name !== '' && sha !== '')
    ? entriesFingerprint(entries)
    : undefined;
}

/**
 * Reads a folder listing the model fetched. It is a source for which files and folders exist, and
 * pinned like a file: to the commit its entries' links name, else the head commit, else not pinned.
 * @param {import('./shared.js').ExtractInput} input - The arguments and text of the call.
 * @param {import('./shared.js').ExtractContext} context - The context.
 * @returns {Promise<import('./shared.js').Extraction>} The listing as a source, or nothing.
 */
async function extractDirectory({ args, text }, context) {
  const listing = parseJson(text);
  const repo = repoFromArguments(args);
  if (!Array.isArray(listing)) {
    return nothing('unparseable');
  }
  if (!isAllowedRepo(context.repos, repo) || repo === undefined) {
    return nothing('repo-not-allowed');
  }
  const path = asString(asObject(args).path)
    .split('/')
    .filter((part) => part !== '')
    .join('/');
  const commitSha = commitOfListing(listing, repo) ?? (await lookUpHead(context, repo)) ?? '';
  const pinned = commitSha !== '';
  return {
    sources: [
      {
        type: 'github',
        repo,
        path,
        title: path === '' ? '/' : `${path}/`,
        commitSha,
        url: treeUrl(repo, pinned ? commitSha : 'HEAD', path),
        latestUrl: treeUrl(repo, 'HEAD', path),
        kind: 'directory',
        pinned,
        ...refField(args),
        ...fingerprintField(listingFingerprint(listing)),
      },
    ],
    candidates: [],
    blocked: false,
  };
}

/**
 * Reads a file the model fetched. The commit it is pinned to comes only from the resource named
 * in the result; a blob SHA is never used as one. When the result names no commit, the head commit
 * of the default branch is looked up, and when that fails the link is to the default branch and
 * marked as not pinned. A folder listing is read by extractDirectory.
 * @type {import('./shared.js').Extractor}
 */
export async function extractFileContents({ args, text, log }, context) {
  if (text.trimStart().startsWith(DIRECTORY_START)) {
    return extractDirectory({ args, text }, context);
  }
  const named = RESOURCE_URI.exec(log ?? '');
  const repo = named?.[1] ?? repoFromArguments(args);
  const requested = named === null ? asString(asObject(args).path) : decodePath(named[3]);
  const path = requested.replace(LEADING_SLASHES, '');
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
        ...refField(args),
        ...fingerprintField(fileFingerprint(text)),
      },
    ],
    candidates: [],
    blocked: false,
  };
}
