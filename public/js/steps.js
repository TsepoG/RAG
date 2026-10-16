// @ts-check

/** The step that stands for the model writing the answer and the application checking it. */
export const WRITING_ID = 'writing';

/** The step for a progress line this file has no wording for. */
const GENERIC_ID = 'other';

/** What the server says before it checks the answer; see `src/server/progress.js`. */
const REWRITING_PATTERN = /^Rewriting the answer for an? (.+)…$/u;

/**
 * One thing the assistant did while answering, with how many times it did it.
 * @typedef {object} Step
 * @property {string} id - Which kind of step it is.
 * @property {number} count - How many progress lines it stands for.
 * @property {string} detail - Something the label needs, such as the role an answer is reworded for.
 */

/**
 * The words for one kind of step.
 * @typedef {object} StepSpec
 * @property {string} id - The kind of step.
 * @property {string} current - What it says while it is the step in progress.
 * @property {(step: Step) => string} done - What it says once it is over.
 */

/**
 * @param {string} id - The kind of step.
 * @param {string} current - The words while it is in progress.
 * @param {string | ((step: Step) => string)} done - The words once it is over.
 * @returns {StepSpec} The spec.
 */
function spec(id, current, done) {
  return { id, current, done: typeof done === 'function' ? done : () => done };
}

/**
 * @param {number} count - How many.
 * @param {string} one - The word for one.
 * @param {string} many - The word for more.
 * @returns {string} The count with its word.
 */
function counted(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

const SEARCHED_CONFLUENCE = spec(
  'confluence-search',
  'Searching Confluence',
  'Searched Confluence',
);
const READ_CONFLUENCE = spec(
  'confluence-read',
  'Reading a Confluence page',
  ({ count }) => `Read ${counted(count, 'Confluence page', 'Confluence pages')}`,
);
const CHECKED_CHANGES = spec('changes', 'Checking recent changes', 'Checked recent changes');
const CHECKED_RELEASES = spec('releases', 'Checking the releases', 'Checked the releases');

/**
 * What each message the server sends means. The wording never includes what was searched for or
 * opened, and neither do the steps.
 * @type {ReadonlyMap<string, StepSpec>}
 */
const SPEC_BY_MESSAGE = new Map([
  ['Searching Confluence…', SEARCHED_CONFLUENCE],
  ['Opening a Confluence page…', READ_CONFLUENCE],
  [
    'Connecting to Confluence…',
    spec('confluence-connect', 'Connecting to Confluence', 'Connected to Confluence'),
  ],
  ['Searching the code…', spec('code-search', 'Searching the code', 'Searched the code')],
  [
    'Reading a file from GitHub…',
    spec(
      'github-read',
      'Reading a file from GitHub',
      ({ count }) => `Read ${counted(count, 'file', 'files')} from GitHub`,
    ),
  ],
  ['Checking a recent change…', CHECKED_CHANGES],
  ['Checking recent changes…', CHECKED_CHANGES],
  ['Checking releases…', CHECKED_RELEASES],
  ['Checking the latest release…', CHECKED_RELEASES],
  [
    'Checking the answer…',
    spec(WRITING_ID, 'Writing and checking the answer', 'Wrote and checked the answer'),
  ],
]);

/** The words for the model writing the answer, which is a step from the start. */
const WRITING = /** @type {StepSpec} */ (SPEC_BY_MESSAGE.get('Checking the answer…'));

const GENERIC = spec(GENERIC_ID, 'Looking something up', 'Looked something up');

const REWORDING = spec('rewording', 'Rewording the answer', 'Reworded the answer');

/**
 * Where the steps of a running question stand.
 * @typedef {{ steps: ReadonlyArray<Step>, currentStep: string }} StepProgress
 */

/** What a question starts with: nothing done yet. */
export const NO_STEPS = Object.freeze({ steps: Object.freeze([]), currentStep: '' });

/**
 * Works out what a progress line from the server stands for.
 * @param {string} message - The line.
 * @returns {{ spec: StepSpec, detail: string } | undefined} The step, or undefined for an empty line.
 */
function resolve(message) {
  if (message === '') {
    return undefined;
  }
  const known = SPEC_BY_MESSAGE.get(message);
  if (known !== undefined) {
    return { spec: known, detail: '' };
  }
  const rewriting = REWRITING_PATTERN.exec(message);
  return rewriting === null
    ? { spec: GENERIC, detail: '' }
    : { spec: REWORDING, detail: rewriting[1] };
}

/**
 * Notes that a step happened: a repeat of an earlier step adds to its count instead of making a
 * new row, and whichever step happened last is the one in progress.
 * @param {StepProgress} progress - Where the steps stand.
 * @param {string} id - The kind of step.
 * @param {string} detail - What the label needs, if anything.
 * @returns {StepProgress} The steps after it.
 */
function touch({ steps }, id, detail) {
  const known = steps.some((step) => step.id === id);
  return {
    currentStep: id,
    steps: known
      ? steps.map((step) =>
          step.id === id ? { ...step, count: step.count + 1, detail: detail || step.detail } : step,
        )
      : [...steps, { id, count: 1, detail }],
  };
}

/**
 * Takes in a progress line from the server.
 * @param {StepProgress} progress - Where the steps stand.
 * @param {string} message - The line.
 * @returns {StepProgress} The steps after it; the same object for a line with nothing in it.
 */
export function recordProgress(progress, message) {
  const found = resolve(message);
  return found === undefined ? progress : touch(progress, found.spec.id, found.detail);
}

/**
 * Notes that the answer has started to arrive, which is the writing step even when the server has
 * not said "checking" yet.
 * @param {StepProgress} progress - Where the steps stand.
 * @returns {StepProgress} The steps after it; the same object when writing is already the step.
 */
export function recordDraft(progress) {
  return progress.currentStep === WRITING_ID ? progress : touch(progress, WRITING_ID, '');
}

/**
 * The words for a kind of step.
 * @param {string} id - The kind of step.
 * @returns {StepSpec} Its spec; the generic one for a kind that is not known.
 */
function specFor(id) {
  if (id === WRITING_ID) {
    return WRITING;
  }
  const all = [...SPEC_BY_MESSAGE.values(), REWORDING];
  return all.find((candidate) => candidate.id === id) ?? GENERIC;
}

/**
 * One row of the list the reader sees.
 * @typedef {object} StepRow
 * @property {string} id - The kind of step.
 * @property {string} label - The words for the row.
 * @property {'done' | 'current' | 'future'} status - Whether it is over, in progress or still to come.
 */

/**
 * Turns the steps into the rows to show: every step so far, the newest one in progress, and
 * "Writing and checking the answer" waiting at the end until it starts.
 * @param {StepProgress} progress - Where the steps stand.
 * @returns {StepRow[]} The rows, in order.
 */
export function describeSteps({ steps, currentStep }) {
  /** @type {StepRow[]} */
  const rows = steps.map((step) => {
    const words = specFor(step.id);
    const current = step.id === currentStep;
    const label = current ? words.current : words.done(step);
    return {
      id: step.id,
      label: step.detail === '' ? label : `${label} for ${step.detail}`,
      status: current ? 'current' : 'done',
    };
  });
  return steps.some(({ id }) => id === WRITING_ID)
    ? rows
    : [...rows, { id: WRITING_ID, label: WRITING.current, status: 'future' }];
}
