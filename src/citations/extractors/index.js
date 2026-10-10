// @ts-check
import { extractCommit } from './getCommit.js';
import { extractConfluenceContent } from './getConfluenceContent.js';
import { extractFileContents } from './getFileContents.js';
import { extractRelease } from './getLatestRelease.js';
import { extractCommitList } from './listCommits.js';
import { extractReleaseList } from './listReleases.js';
import { extractCodeSearch } from './searchCode.js';
import { extractConfluenceSearch } from './searchConfluence.js';

export { MAX_CANDIDATES, NO_RESULTS } from './shared.js';

/** @typedef {import('./shared.js').Extractor} Extractor */
/** @typedef {import('./shared.js').ExtractContext} ExtractContext */
/** @typedef {import('./shared.js').ExtractInput} ExtractInput */
/** @typedef {import('./shared.js').Extraction} Extraction */

/**
 * The extractor for each allow-listed tool that returns content, by server key and bare tool name.
 * A tool that is not here, such as the site lookup, returns nothing that can be cited.
 */
const EXTRACTORS = Object.freeze({
  atlassian: Object.freeze({
    searchConfluence: extractConfluenceSearch,
    getConfluenceContent: extractConfluenceContent,
  }),
  github_repos: Object.freeze({
    search_code: extractCodeSearch,
    get_file_contents: extractFileContents,
    get_commit: extractCommit,
    list_commits: extractCommitList,
    list_releases: extractReleaseList,
    get_latest_release: extractRelease,
  }),
});

/**
 * Finds the extractor for a tool.
 * @param {{ server: string, tool: string }} target - The server key and bare tool name.
 * @returns {Extractor | undefined} The extractor, or undefined when the tool has none.
 */
export function getExtractor({ server, tool }) {
  const tools = Object.hasOwn(EXTRACTORS, server)
    ? /** @type {Record<string, Extractor>} */ (
        EXTRACTORS[/** @type {keyof typeof EXTRACTORS} */ (server)]
      )
    : undefined;
  return tools !== undefined && Object.hasOwn(tools, tool) ? tools[tool] : undefined;
}
