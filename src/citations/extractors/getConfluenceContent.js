// @ts-check
import { asObject, asString, blocked, isOlderThanAYear, parseJson } from './shared.js';

const PAGE_PATH = /^\/wiki\/spaces\/([^/]+)\/pages\/(\d+)(?:\/|$)/;

/**
 * Reads the space key and page id from the `content_url` argument, which the pre-tool hook has
 * already checked against the allowed site and spaces.
 * @param {string} contentUrl - The argument.
 * @returns {{ spaceKey: string, id: string } | undefined} What the URL names, or undefined.
 */
function readPageUrl(contentUrl) {
  try {
    const match = PAGE_PATH.exec(new URL(contentUrl).pathname);
    return match === null ? undefined : { spaceKey: match[1], id: match[2] };
  } catch {
    return undefined;
  }
}

/**
 * Works out which space a fetched page is in. The result carries only a numeric space id, so the
 * space comes from the URL that was asked for, and only if the page that came back is the page the
 * URL names. Without a URL, the result itself has to name the space.
 * @param {Record<string, unknown>} args - The tool arguments.
 * @param {Record<string, unknown>} data - The page data in the result.
 * @returns {{ spaceKey: string } | { problem: string }} The space key, or why it is unknown.
 */
function findSpace(args, data) {
  if (typeof args.content_url === 'string') {
    const named = readPageUrl(args.content_url);
    if (named === undefined) {
      return { problem: 'space-unknown' };
    }
    return named.id === asString(data.id)
      ? { spaceKey: named.spaceKey }
      : { problem: 'id-mismatch' };
  }
  const spaceKey = asString(asObject(data.space).key) || asString(data.spaceKey);
  return spaceKey === '' ? { problem: 'space-unknown' } : { spaceKey };
}

/**
 * Reads a Confluence page the model fetched. A page whose space cannot be established, is not
 * the page asked for, or is outside the allowed spaces is blocked: its content must not reach the
 * model. An unreadable result is blocked too, because content that cannot be checked is not shown.
 * @type {import('./shared.js').Extractor}
 */
export async function extractConfluenceContent({ args, text }, { siteUrl, spaceKeys, now }) {
  const data = asObject(asObject(parseJson(text)).data);
  const id = asString(data.id);
  const version = asObject(asObject(data.metadata).version);
  if (id === '' || typeof version.number !== 'number') {
    return blocked('unparseable');
  }
  const space = findSpace(asObject(args), data);
  if ('problem' in space) {
    return blocked(space.problem);
  }
  const allowed = spaceKeys.some((key) => key.toLowerCase() === space.spaceKey.toLowerCase());
  if (!allowed) {
    return blocked('space-not-allowed');
  }
  const lastUpdated = asString(version.createdAt) || undefined;
  // The server used so far gives only an account id (`metadata.authorId`), which is no use to a
  // reader, so a name is kept only when the version carries one in the usual `by.displayName`.
  const lastEditor = asString(asObject(version.by).displayName) || undefined;
  return {
    sources: [
      {
        type: 'confluence',
        id,
        title: asString(data.title) || `Page ${id}`,
        spaceKey: space.spaceKey,
        version: version.number,
        ...(lastUpdated === undefined ? {} : { lastUpdated }),
        ...(lastEditor === undefined ? {} : { lastEditor }),
        url: `${siteUrl}/wiki/spaces/${space.spaceKey}/pages/${id}`,
        stale: isOlderThanAYear(lastUpdated, now()),
      },
    ],
    candidates: [],
    blocked: false,
  };
}
