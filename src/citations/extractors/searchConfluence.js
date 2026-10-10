// @ts-check
import { asObject, asString, blocked, MAX_CANDIDATES, parseJson } from './shared.js';

const SPACE_PATH = /^(?:\/wiki)?\/spaces\/([^/]+)(?:\/pages\/(\d+))?/;

/**
 * Reads where a search hit is: its space, and its page id when it is a page.
 * @param {Record<string, unknown>} hit - One search result.
 * @returns {{ spaceKey: string, id?: string } | undefined} The location, or undefined.
 */
function locate(hit) {
  const url = asString(hit.url) || asString(asObject(asObject(hit.content)._links).webui);
  const match = SPACE_PATH.exec(url);
  if (match === null) {
    return undefined;
  }
  return match[2] === undefined ? { spaceKey: match[1] } : { spaceKey: match[1], id: match[2] };
}

/**
 * Reads the hits of a Confluence search. The query is already confined to the allowed spaces, so
 * a hit outside them, or one whose space cannot be read, means the result cannot be trusted: the
 * whole result is blocked, because its excerpts are content too. Hits are candidates only, since
 * the model has not read the pages.
 * @type {import('./shared.js').Extractor}
 */
export async function extractConfluenceSearch({ text }, { siteUrl, spaceKeys }) {
  const results = asObject(asObject(parseJson(text)).data).results;
  if (!Array.isArray(results)) {
    return blocked('unparseable');
  }
  const allowed = new Set(spaceKeys.map((key) => key.toLowerCase()));
  /** @type {import('../registry.js').Candidate[]} */
  const candidates = [];
  for (const raw of results) {
    const hit = asObject(raw);
    const where = locate(hit);
    if (where === undefined) {
      return blocked('space-unknown');
    }
    if (!allowed.has(where.spaceKey.toLowerCase())) {
      return blocked('space-not-allowed');
    }
    const title = asString(hit.title) || asString(asObject(hit.content).title);
    if (where.id !== undefined && title !== '' && candidates.length < MAX_CANDIDATES) {
      candidates.push({
        type: 'confluence',
        title,
        url: `${siteUrl}/wiki/spaces/${where.spaceKey}/pages/${where.id}`,
      });
    }
  }
  return { sources: [], candidates, blocked: false };
}
