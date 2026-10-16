// @ts-check

/**
 * What each confidence level is called on the page and in a copied conversation.
 * @type {Readonly<Record<'high' | 'medium' | 'low', string>>}
 */
export const CONFIDENCE_LABELS = Object.freeze({
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
});

/**
 * What a reply that is not an answer is called.
 * @type {Readonly<Record<'not_found' | 'out_of_scope' | 'clarify', string>>}
 */
export const STATUS_LABELS = Object.freeze({
  not_found: 'Not found in the docs',
  out_of_scope: 'Outside what I can answer',
  clarify: 'Needs a bit more detail',
});

/** The label of a failed turn. */
export const ERROR_LABEL = 'Something went wrong';
