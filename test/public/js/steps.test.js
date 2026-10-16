// @ts-check
import { describe, expect, it } from 'vitest';
import {
  describeSteps,
  NO_STEPS,
  recordDraft,
  recordProgress,
  WRITING_ID,
} from '../../../public/js/steps.js';

/**
 * Plays progress lines through the steps, as a running question would.
 * @param {string[]} messages - The lines, in order.
 * @returns {import('../../../public/js/steps.js').StepProgress} Where the steps end up.
 */
function play(messages) {
  return messages.reduce(recordProgress, /** @type {any} */ (NO_STEPS));
}

/**
 * The rows as "status: label", for reading in a test.
 * @param {import('../../../public/js/steps.js').StepProgress} progress - The steps.
 * @returns {string[]} One entry per row.
 */
function rows(progress) {
  return describeSteps(progress).map(({ status, label }) => `${status}: ${label}`);
}

describe('describeSteps before anything has happened', () => {
  it('shows only the writing step, waiting', () => {
    expect(rows(NO_STEPS)).toEqual(['future: Writing and checking the answer']);
  });
});

describe('recordProgress', () => {
  it.each([
    ['Searching Confluence…', 'Searching Confluence', 'Searched Confluence'],
    ['Opening a Confluence page…', 'Reading a Confluence page', 'Read 1 Confluence page'],
    ['Connecting to Confluence…', 'Connecting to Confluence', 'Connected to Confluence'],
    ['Searching the code…', 'Searching the code', 'Searched the code'],
    ['Reading a file from GitHub…', 'Reading a file from GitHub', 'Read 1 file from GitHub'],
    ['Checking a recent change…', 'Checking recent changes', 'Checked recent changes'],
    ['Checking recent changes…', 'Checking recent changes', 'Checked recent changes'],
    ['Checking releases…', 'Checking the releases', 'Checked the releases'],
    ['Checking the latest release…', 'Checking the releases', 'Checked the releases'],
    ['Looking something up…', 'Looking something up', 'Looked something up'],
  ])('words %j as %j while it runs and %j once it is over', (message, current, done) => {
    const whileRunning = rows(play([message]))[0];
    const afterwards = rows(play([message, 'Checking the answer…']))[0];

    expect(whileRunning).toBe(`current: ${current}`);
    expect(afterwards).toBe(`done: ${done}`);
  });

  it('puts the newest step in progress and the earlier ones done, with writing still to come', () => {
    const progress = play(['Searching Confluence…', 'Opening a Confluence page…']);

    expect(rows(progress)).toEqual([
      'done: Searched Confluence',
      'current: Reading a Confluence page',
      'future: Writing and checking the answer',
    ]);
  });

  it('counts a repeat of a step instead of adding a row', () => {
    const progress = play([
      'Opening a Confluence page…',
      'Opening a Confluence page…',
      'Searching the code…',
      'Reading a file from GitHub…',
      'Reading a file from GitHub…',
      'Reading a file from GitHub…',
      'Checking the answer…',
    ]);

    expect(rows(progress)).toEqual([
      'done: Read 2 Confluence pages',
      'done: Searched the code',
      'done: Read 3 files from GitHub',
      'current: Writing and checking the answer',
    ]);
  });

  it('moves the spinner to a step it returns to, keeping the rows where they were', () => {
    const progress = play([
      'Opening a Confluence page…',
      'Searching the code…',
      'Opening a Confluence page…',
    ]);

    expect(rows(progress)).toEqual([
      'current: Reading a Confluence page',
      'done: Searched the code',
      'future: Writing and checking the answer',
    ]);
  });

  it('gives any line it does not know the generic words, however many there are', () => {
    const progress = play(['A tool nobody has heard of…', 'Another one…']);

    expect(rows(progress)).toEqual([
      'current: Looking something up',
      'future: Writing and checking the answer',
    ]);
    expect(progress.steps).toEqual([{ id: 'other', count: 2, detail: '' }]);
  });

  it('turns "checking the answer" into the writing step', () => {
    const progress = play(['Searching the code…', 'Checking the answer…']);

    expect(progress.currentStep).toBe(WRITING_ID);
    expect(rows(progress)).toEqual([
      'done: Searched the code',
      'current: Writing and checking the answer',
    ]);
  });

  it('names the role an answer is reworded for, and moves writing to done', () => {
    const progress = play(['Checking the answer…', 'Rewriting the answer for a Product Owner…']);

    expect(rows(progress)).toEqual([
      'done: Wrote and checked the answer',
      'current: Rewording the answer for Product Owner',
    ]);
  });

  it('keeps the role name when the same step comes round again with none', () => {
    const progress = play([
      'Rewriting the answer for a QA…',
      'Rewriting the answer for a QA…',
      'Searching the code…',
    ]);

    expect(rows(progress)[0]).toBe('done: Reworded the answer for QA');
  });

  it('ignores a line with nothing in it, returning the same object', () => {
    const before = play(['Searching Confluence…']);

    expect(recordProgress(before, '')).toBe(before);
  });

  it('never changes the steps it was given', () => {
    const before = play(['Searching Confluence…']);
    const snapshot = JSON.stringify(before);

    recordProgress(before, 'Opening a Confluence page…');
    recordProgress(before, 'Searching Confluence…');

    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('recordDraft', () => {
  it('makes writing the step in progress when text starts to arrive before the server says so', () => {
    const progress = recordDraft(play(['Searching the code…']));

    expect(rows(progress)).toEqual([
      'done: Searched the code',
      'current: Writing and checking the answer',
    ]);
  });

  it('changes nothing when writing is already the step, so each later token is free', () => {
    const progress = recordDraft(play(['Checking the answer…']));

    expect(recordDraft(progress)).toBe(progress);
  });

  it('adds the writing step to a question that had no steps at all', () => {
    expect(rows(recordDraft(NO_STEPS))).toEqual(['current: Writing and checking the answer']);
  });
});
