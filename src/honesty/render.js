// @ts-check

/**
 * What the application says in its own voice, by situation. A role can reword any of these under
 * `phrases` in its YAML file.
 * @type {Readonly<{ high: string, medium: string, low: string, notFound: string, outOfScope: string }>}
 */
export const DEFAULT_PHRASES = Object.freeze({
  high: 'Confirmed by the sources below.',
  medium:
    'Mostly confirmed. Part of this is my reading of the sources, or could not be fully checked; see the notes below.',
  low: "I'm not sure. Here's what I found and what's missing.",
  notFound: "I couldn't find this in Confluence or the codebase.",
  outOfScope:
    "I don't have that information. I can only answer from the team's Confluence pages and code.",
});

/** The headings of the sections the application adds, shared by the terminal and the web page. */
export const SECTION_TITLES = Object.freeze({
  gaps: "What I couldn't confirm",
  closestPages: 'Closest pages I checked',
  whoToAsk: 'Who might know',
});

/** Most "closest pages" listed with a "not found" answer. */
export const MAX_CLOSEST_PAGES = 5;

/**
 * The part of a result that is rendered.
 * @typedef {object} RenderableResult
 * @property {'answered' | 'not_found' | 'clarify' | 'out_of_scope'} status - The final status.
 * @property {'high' | 'medium' | 'low' | null} confidence - The final level; null unless answered.
 * @property {string} answer - The checked answer text.
 * @property {string[]} gaps - What the model could not confirm.
 * @property {Array<{ topic: string, docSays: string, docKeys: string[], codeSays: string, codeKeys: string[] }>} conflicts
 *   Where the documentation and the code disagree, with the keys of each side.
 * @property {string} [clarifyingQuestion] - The one question to ask the user.
 * @property {Array<{ key?: string, title: string, url: string }>} alsoConsulted - Pages and files
 *   that were looked at but not cited.
 * @property {Array<{ name: string, sourceKeys: string[] }>} whoToAsk - People worth asking.
 */

/**
 * The part of a role that is rendered.
 * @typedef {{ phrases?: Partial<Record<keyof typeof DEFAULT_PHRASES, string>> }} RenderRole
 */

/**
 * The answer as the terminal or the web page shows it, as separate parts so each can lay them out.
 * @typedef {object} RenderedAnswer
 * @property {'high' | 'medium' | 'low' | null} level - The confidence level, for a badge.
 * @property {string} banner - The plain-language line shown first; empty for a clarifying question.
 * @property {string} text - The answer, or the clarifying question; empty when the banner says it all.
 * @property {string[]} conflicts - One sentence per disagreement between the documentation and the code.
 * @property {string[]} gaps - What could not be confirmed; only for a medium or low answer.
 * @property {Array<{ key?: string, title: string, url: string }>} closestPages - Up to five pages
 *   to try instead; only for "not found".
 * @property {Array<{ name: string, sourceKeys: string[] }>} whoToAsk - People to ask; only for
 *   "not found" and for medium and low answers.
 */

const TRAILING_STOPS = new Set(['.', '!', '?', ';', ':', ' ']);

/**
 * Removes the full stop and spaces at the end of a phrase so it reads inside a longer sentence.
 * @param {string} text - The phrase.
 * @returns {string} The phrase without its ending.
 */
function withoutEnding(text) {
  let end = text.length;
  while (end > 0 && TRAILING_STOPS.has(text[end - 1])) {
    end -= 1;
  }
  return text.slice(0, end);
}

/**
 * Writes the keys of one side of a disagreement.
 * @param {ReadonlyArray<string>} keys - The keys.
 * @returns {string} The keys in brackets, with a leading space, or nothing.
 */
function writeKeys(keys) {
  const written = keys.map((key) => `[${key}]`).join('');
  return keys.length === 0 ? '' : ` ${written}`;
}

/**
 * Writes one disagreement. The application writes it from the structured report, so the model
 * cannot soften it or decide it.
 * @param {RenderableResult['conflicts'][number]} conflict - The disagreement.
 * @returns {string} A sentence.
 */
function describeConflict({ topic, docSays, docKeys, codeSays, codeKeys }) {
  return (
    `${withoutEnding(topic)}: the documentation says ${withoutEnding(docSays)}${writeKeys(docKeys)}; ` +
    `the code does ${withoutEnding(codeSays)}${writeKeys(codeKeys)}. The code reflects current behaviour.`
  );
}

/**
 * Picks the line to show first.
 * @param {RenderableResult} result - The result.
 * @param {RenderRole} role - The role.
 * @returns {string} The banner, in the role's words when it has its own.
 */
function pickBanner({ status, confidence }, role) {
  const phrases = { ...DEFAULT_PHRASES, ...role.phrases };
  if (status === 'not_found') {
    return phrases.notFound;
  }
  if (status === 'out_of_scope') {
    return phrases.outOfScope;
  }
  return status === 'answered' && confidence !== null ? phrases[confidence] : '';
}

/**
 * Lays out a result for a reader. Pure, so the terminal and the web server share it. What the
 * model wrote is shown only for an answered question or as the one clarifying question; for "not
 * found" and "out of scope" the role's own text is shown instead, with no sources.
 * @param {RenderableResult} result - The final result.
 * @param {RenderRole} role - The role the answer is for.
 * @returns {RenderedAnswer} The parts to show.
 */
export function renderFinalAnswer(result, role) {
  const { status, confidence } = result;
  const unsure = status === 'not_found' || confidence === 'medium' || confidence === 'low';
  const answered = status === 'answered';
  let text = '';
  if (answered) {
    text = result.answer.trim();
  } else if (status === 'clarify') {
    text = result.clarifyingQuestion ?? '';
  }
  return {
    level: answered ? confidence : null,
    banner: pickBanner(result, role),
    text,
    conflicts: answered ? result.conflicts.map(describeConflict) : [],
    gaps: answered && unsure ? [...result.gaps] : [],
    closestPages: status === 'not_found' ? result.alsoConsulted.slice(0, MAX_CLOSEST_PAGES) : [],
    whoToAsk: unsure ? [...result.whoToAsk] : [],
  };
}
