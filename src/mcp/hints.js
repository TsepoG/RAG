// @ts-check

/** The bare name of the code search tool, whose use is limited per question. */
export const CODE_SEARCH_TOOL = 'search_code';

/**
 * Most code searches one question may make. This repository's code search can return nothing for
 * every query, and each attempt, repeated with other words, uses up the call budget.
 */
export const MAX_CODE_SEARCHES = 2;

/**
 * Said to the model after an empty code search, and when it searches again past the limit, so it
 * browses folders instead.
 */
export const CODE_SEARCH_HINT =
  'Code search returned no results; this repository may not be indexed. Browse with get_file_contents on directories instead of repeating search_code.';
