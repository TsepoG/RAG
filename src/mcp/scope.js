// @ts-check
import { checkCql } from './cql.js';
import { ARGUMENTS, asRecord, deny, isFilled, OK } from './scopeCommon.js';
import { SERVER_KEYS } from './servers.js';

/** @typedef {import('./scopeCommon.js').Scope} Scope */
/** @typedef {import('./scopeCommon.js').ScopeResult} ScopeResult */

/**
 * The argument names each scoped tool is checked on, by bare tool name.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const SCOPED_ARGUMENTS = Object.freeze({
  searchConfluence: [ARGUMENTS.cql, ARGUMENTS.cqlContext],
  getConfluenceContent: [ARGUMENTS.contentId, ARGUMENTS.contentUrl],
  getAccessibleAtlassianResources: [],
  search_code: [ARGUMENTS.query],
  get_file_contents: [ARGUMENTS.owner, ARGUMENTS.repo],
  get_commit: [ARGUMENTS.owner, ARGUMENTS.repo],
  list_commits: [ARGUMENTS.owner, ARGUMENTS.repo],
  list_releases: [ARGUMENTS.owner, ARGUMENTS.repo],
  get_latest_release: [ARGUMENTS.owner, ARGUMENTS.repo],
});

/** Path of a Confluence Cloud page URL, capturing the space key. */
const CONFLUENCE_SPACE_PATH = /^\/wiki\/spaces\/([^/]+)\//i;
/** Space paths anywhere in a block of text, used to look for strays in tool results. */
const GITHUB_QUALIFIER = /^(-?)(repo|org|user):(.*)$/i;
const GITHUB_QUERY_PART = /"[^"]*"|\S+/g;
const PARENTHESES = /[()]/g;

/**
 * Turns the configured limits into the form the checks use.
 * @param {{ repos: ReadonlyArray<string>, spaceKeys: ReadonlyArray<string>, siteUrl: string }} limits
 *   Repos, Confluence space keys and the Atlassian site URL from config.
 * @returns {Scope} The scope.
 */
export function buildScope({ repos, spaceKeys, siteUrl }) {
  return {
    repos: new Set(repos.map((repo) => repo.toLowerCase())),
    spaceKeys: new Set(spaceKeys.map((key) => key.toLowerCase())),
    siteUrl: new URL(siteUrl).origin.toLowerCase(),
  };
}

/**
 * Checks the repository named by `owner` and `repo` arguments.
 * @param {unknown} args - Tool arguments.
 * @param {Scope} scope - What may be touched.
 * @returns {ScopeResult} Whether the repository is allowed.
 */
export function checkRepoArguments(args, scope) {
  const { owner, repo } = asRecord(args);
  if (!isFilled(owner) || !isFilled(repo)) {
    return deny('repo-missing', 'Both owner and repo are required.');
  }
  if (!scope.repos.has(`${owner}/${repo}`.toLowerCase())) {
    return deny('repo-not-allowed', `Repository ${owner}/${repo} is not in the allowed list.`);
  }
  return OK;
}

/**
 * Reads the repo/org/user qualifiers of a GitHub code search query. Quoted phrases are skipped,
 * and parentheses are blanked so a boolean operator cannot hide against one.
 * @param {string} query - The search query.
 * @returns {{ hasOr: boolean, repos: string[], widens: boolean }} Whether the query contains OR,
 *   the positive repo: values (lower-cased), and whether it has an org: or user: qualifier.
 */
function readGithubQuery(query) {
  const parts = query.replaceAll(PARENTHESES, ' ').match(GITHUB_QUERY_PART) ?? [];
  const found = { hasOr: false, repos: /** @type {string[]} */ ([]), widens: false };
  for (const part of parts) {
    if (part.toLowerCase() === 'or') {
      found.hasOr = true;
      continue;
    }
    const qualifier = GITHUB_QUALIFIER.exec(part);
    if (qualifier === null) {
      continue;
    }
    const [, negation, kind, value] = qualifier;
    if (kind.toLowerCase() !== 'repo') {
      found.widens = true;
    } else if (negation === '') {
      // A negated repo: only narrows the search, so it neither counts nor needs checking.
      found.repos.push(value.replaceAll('"', '').toLowerCase());
    }
  }
  return found;
}

/**
 * Checks a GitHub code search. The tool searches all of GitHub, so the query itself must restrict
 * it to allowed repositories, and nothing in it may widen the search again.
 * @param {unknown} args - Tool arguments.
 * @param {Scope} scope - What may be touched.
 * @returns {ScopeResult} Whether the query is confined to allowed repositories.
 */
export function checkSearchCode(args, scope) {
  const { query } = asRecord(args);
  if (!isFilled(query)) {
    return deny('query-missing', 'A query is required.');
  }
  const { hasOr, repos, widens } = readGithubQuery(query);
  if (hasOr) {
    return deny('query-or', 'Queries may not use OR, because it can escape the repo: filter.');
  }
  if (widens) {
    return deny('query-widens', 'Queries may not use org: or user: qualifiers.');
  }
  if (repos.length === 0) {
    return deny('query-no-repo', 'Add a repo:owner/name qualifier for an allowed repository.');
  }
  const stray = repos.find((repo) => !scope.repos.has(repo));
  return stray === undefined
    ? OK
    : deny('query-repo-not-allowed', `Repository ${stray} is not in the allowed list.`);
}

/**
 * Decodes a percent-encoded URL segment, leaving it as it is when the encoding is malformed.
 * @param {string} segment - A path segment.
 * @returns {string} The decoded segment, or the original when it cannot be decoded.
 */
function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    // Malformed input is kept as it is; it will not match an allowed space key, so it is denied.
    return segment;
  }
}

/**
 * Checks a Confluence page fetch. Only a page URL on the configured site can be checked before
 * the call, so a bare content_id is refused.
 * @param {unknown} args - Tool arguments.
 * @param {Scope} scope - What may be touched.
 * @returns {ScopeResult} Whether the page is in an allowed space.
 */
export function checkConfluenceContent(args, scope) {
  const { [ARGUMENTS.contentId]: contentId, [ARGUMENTS.contentUrl]: contentUrl } = asRecord(args);
  if (contentId !== undefined && contentId !== null) {
    return deny(
      'content-id',
      'Use content_url, taken from a search result, instead of content_id.',
    );
  }
  const url = isFilled(contentUrl) ? URL.parse(contentUrl) : null;
  if (url === null || url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    return deny('content-url', 'content_url must be a plain https page URL from a search result.');
  }
  if (url.origin.toLowerCase() !== scope.siteUrl) {
    return deny('content-site', 'content_url must be on the configured Atlassian site.');
  }
  const space = CONFLUENCE_SPACE_PATH.exec(url.pathname)?.[1];
  if (space === undefined) {
    return deny('content-space', 'content_url must be a page URL containing /wiki/spaces/KEY/.');
  }
  return scope.spaceKeys.has(safeDecode(space).toLowerCase())
    ? OK
    : deny('content-space-not-allowed', `Space ${space} is not in the allowed list.`);
}

/**
 * Checks that a tool call needs no arguments to be in scope.
 * @returns {ScopeResult} Always allowed.
 */
function checkNoArguments() {
  return OK;
}

/** @type {Readonly<Record<string, Readonly<Record<string, (args: unknown, scope: Scope) => ScopeResult>>>>} */
const RULES = Object.freeze({
  [SERVER_KEYS.atlassian]: Object.freeze({
    searchConfluence: checkCql,
    getConfluenceContent: checkConfluenceContent,
    getAccessibleAtlassianResources: checkNoArguments,
  }),
  [SERVER_KEYS.github]: Object.freeze({
    search_code: checkSearchCode,
    get_file_contents: checkRepoArguments,
    get_commit: checkRepoArguments,
    list_commits: checkRepoArguments,
    list_releases: checkRepoArguments,
    get_latest_release: checkRepoArguments,
  }),
});

/**
 * Checks a tool call against the scope rule for that tool. A tool with no rule is refused, so
 * adding a tool to the allow-list without writing its scope check fails safe.
 * @param {{ server: string, tool: string }} target - The server and bare tool name.
 * @param {unknown} args - Tool arguments.
 * @param {Scope} scope - What may be touched.
 * @returns {ScopeResult} Whether the call stays within scope.
 */
export function checkToolScope({ server, tool }, args, scope) {
  const rules = Object.hasOwn(RULES, server) ? RULES[server] : undefined;
  const rule = rules !== undefined && Object.hasOwn(rules, tool) ? rules[tool] : undefined;
  return rule === undefined
    ? deny('no-scope-rule', 'This tool has no scope rule.')
    : rule(args, scope);
}
