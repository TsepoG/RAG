// @ts-check

/** Shown for a tool this file has no wording for, such as a new one on the allow-list. */
const GENERIC_TOOL_MESSAGE = 'Looking something up…';

/**
 * What the person sees for each tool. The wording never includes what was searched for or opened:
 * those arguments can hold page titles, file paths and other content the progress line should not
 * repeat.
 */
const TOOL_MESSAGES = Object.freeze({
  searchConfluence: 'Searching Confluence…',
  getConfluenceContent: 'Opening a Confluence page…',
  getAccessibleAtlassianResources: 'Connecting to Confluence…',
  search_code: 'Searching the code…',
  get_file_contents: 'Reading a file from GitHub…',
  get_commit: 'Checking a recent change…',
  list_commits: 'Checking recent changes…',
  list_releases: 'Checking releases…',
  get_latest_release: 'Checking the latest release…',
});

/** What the person sees once the model has replied. */
const CHECKING_MESSAGE = 'Checking the answer…';

/**
 * Turns what a question is doing into a line for a progress display.
 * @param {import('../answer/askQuestion.js').Activity} activity - What the question is doing.
 * @param {{ displayName: string }} role - The role, named when the answer is rewritten for it.
 * @returns {string} A short sentence, free of anything taken from a page, file or query.
 */
export function toolEventToProgress(activity, role) {
  if (activity.kind === 'checking') {
    return CHECKING_MESSAGE;
  }
  if (activity.kind === 'rewriting') {
    return `Rewriting the answer for a ${role.displayName}…`;
  }
  return Object.hasOwn(TOOL_MESSAGES, activity.tool)
    ? TOOL_MESSAGES[/** @type {keyof typeof TOOL_MESSAGES} */ (activity.tool)]
    : GENERIC_TOOL_MESSAGE;
}
