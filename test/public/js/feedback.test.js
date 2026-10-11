// @vitest-environment happy-dom
// @ts-check
import { beforeEach, describe, expect, it } from 'vitest';
import {
  markRating,
  readFeedbackDetails,
  resetFeedback,
  showFeedbackStatus,
} from '../../../public/js/feedback.js';
import { loadPage } from '../../helpers/page.js';

const SOURCES = [
  { key: 'C1', title: 'Refund Policy' },
  { key: 'G1', title: 'src/refund.js' },
];

/** @type {import('../../../public/js/refs.js').PageRefs} */
let refs;

beforeEach(() => {
  refs = loadPage();
  resetFeedback(refs, SOURCES);
});

/**
 * Reads the options of the wrong-source picker.
 * @returns {Array<{ value: string, text: string }>} The options.
 */
function options() {
  return [...refs.feedbackSource.querySelectorAll('option')].map((option) => ({
    value: option.value,
    text: option.textContent ?? '',
  }));
}

describe('resetFeedback', () => {
  it('offers no source, then each source the answer cited', () => {
    expect(options()).toEqual([
      { value: '', text: 'None' },
      { value: 'C1', text: '[C1] Refund Policy' },
      { value: 'G1', text: '[G1] src/refund.js' },
    ]);
  });

  it('offers only "None" when nothing was cited', () => {
    resetFeedback(refs, []);

    expect(options()).toHaveLength(1);
  });

  it('clears what the last answer left, and unlocks the controls', () => {
    markRating(refs, 'down');
    /** @type {HTMLTextAreaElement} */ (refs.feedbackComment).value = 'old';
    showFeedbackStatus(refs, 'Saved', true);

    resetFeedback(refs, SOURCES);

    expect(refs.thumbsUp.getAttribute('aria-pressed')).toBe('false');
    expect(refs.thumbsDown.getAttribute('aria-pressed')).toBe('false');
    expect(refs.feedbackForm.hidden).toBe(true);
    expect(/** @type {HTMLTextAreaElement} */ (refs.feedbackComment).value).toBe('');
    expect(refs.feedbackStatus.textContent).toBe('');
    expect(/** @type {HTMLButtonElement} */ (refs.thumbsUp).disabled).toBe(false);
    expect(/** @type {HTMLButtonElement} */ (refs.feedbackSend).disabled).toBe(false);
  });
});

describe('markRating', () => {
  it('shows a thumbs up as pressed, with no form', () => {
    markRating(refs, 'up');

    expect(refs.thumbsUp.getAttribute('aria-pressed')).toBe('true');
    expect(refs.thumbsDown.getAttribute('aria-pressed')).toBe('false');
    expect(refs.feedbackForm.hidden).toBe(true);
  });

  it('shows a thumbs down as pressed, and opens the form', () => {
    markRating(refs, 'down');

    expect(refs.thumbsDown.getAttribute('aria-pressed')).toBe('true');
    expect(refs.thumbsUp.getAttribute('aria-pressed')).toBe('false');
    expect(refs.feedbackForm.hidden).toBe(false);
  });

  it('closes the form again when the person changes to a thumbs up', () => {
    markRating(refs, 'down');
    markRating(refs, 'up');

    expect(refs.feedbackForm.hidden).toBe(true);
  });
});

describe('readFeedbackDetails', () => {
  it('gives nothing when nothing was filled in', () => {
    expect(readFeedbackDetails(refs)).toEqual({});
  });

  it('gives the comment, trimmed, and the chosen source', () => {
    /** @type {HTMLTextAreaElement} */ (refs.feedbackComment).value = '  Wrong window  ';
    /** @type {HTMLSelectElement} */ (refs.feedbackSource).value = 'G1';

    expect(readFeedbackDetails(refs)).toEqual({ comment: 'Wrong window', wrongSourceKey: 'G1' });
  });

  it('leaves out a comment that is only spaces', () => {
    /** @type {HTMLTextAreaElement} */ (refs.feedbackComment).value = '   ';

    expect(readFeedbackDetails(refs)).toEqual({});
  });
});

describe('showFeedbackStatus', () => {
  it('locks the controls once it is saved, so it is not sent twice', () => {
    showFeedbackStatus(refs, 'Thank you.', true);

    expect(refs.feedbackStatus.textContent).toBe('Thank you.');
    expect(/** @type {HTMLButtonElement} */ (refs.thumbsUp).disabled).toBe(true);
    expect(/** @type {HTMLButtonElement} */ (refs.thumbsDown).disabled).toBe(true);
    expect(/** @type {HTMLButtonElement} */ (refs.feedbackSend).disabled).toBe(true);
  });

  it('leaves the controls alone when it was not saved, so it can be tried again', () => {
    showFeedbackStatus(refs, 'It could not be sent.', false);

    expect(refs.feedbackStatus.textContent).toBe('It could not be sent.');
    expect(/** @type {HTMLButtonElement} */ (refs.thumbsUp).disabled).toBe(false);
  });
});
