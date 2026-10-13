// @ts-check
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/errors/index.js';
import {
  appendFeedback,
  buildFeedbackLine,
  FEEDBACK_FILE,
} from '../../src/server/feedbackStore.js';

const WHEN = new Date('2026-10-11T12:00:00.000Z');
const clock = { now: () => WHEN };

/**
 * What is known about an answer, plus things that must never reach the file.
 * @returns {any} The record.
 */
function answerRecord() {
  return {
    question: 'How do refunds work?',
    role: 'po',
    detailLevel: 'default',
    status: 'answered',
    confidence: 'medium',
    citedKeys: ['C1', 'G1'],
    model: 'gpt-x',
    answer: 'Refunds are allowed for 30 days [C1].',
    token: 'ghp_secret',
  };
}

/** @type {string} */
let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'feedback-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('buildFeedbackLine', () => {
  it('holds the fields the brief lists and no others', () => {
    const line = buildFeedbackLine(
      answerRecord(),
      { rating: 'down', comment: 'Wrong window', wrongSourceKey: 'C1' },
      WHEN,
    );

    expect(JSON.parse(line)).toEqual({
      timestamp: '2026-10-11T12:00:00.000Z',
      question: 'How do refunds work?',
      role: 'po',
      detailLevel: 'default',
      status: 'answered',
      confidence: 'medium',
      citedKeys: ['C1', 'G1'],
      rating: 'down',
      comment: 'Wrong window',
      wrongSourceKey: 'C1',
      model: 'gpt-x',
      turn: null,
      conversationTurns: null,
    });
  });

  it('records which turn of a conversation was rated, and how many turns it had', () => {
    const line = buildFeedbackLine(
      { ...answerRecord(), turn: 2, conversationTurns: 3 },
      { rating: 'up' },
      WHEN,
    );

    expect(JSON.parse(line)).toMatchObject({ turn: 2, conversationTurns: 3 });
  });

  it('never holds the answer text or a token, even when the record carries them', () => {
    const line = buildFeedbackLine(answerRecord(), { rating: 'up' }, WHEN);

    expect(line).not.toContain('Refunds are allowed');
    expect(line).not.toContain('ghp_secret');
  });

  it('writes null for what was not given', () => {
    const record = { ...answerRecord(), confidence: null, model: undefined };

    const parsed = JSON.parse(buildFeedbackLine(record, { rating: 'up' }, WHEN));

    expect(parsed).toMatchObject({
      comment: null,
      wrongSourceKey: null,
      confidence: null,
      model: null,
    });
  });

  it('stays on one line when the comment has line breaks', () => {
    const line = buildFeedbackLine(answerRecord(), { rating: 'down', comment: 'a\nb\r\nc' }, WHEN);

    expect(line).not.toMatch(/[\r\n]/);
    expect(JSON.parse(line).comment).toBe('a\nb\r\nc');
  });
});

describe('appendFeedback', () => {
  it('creates the folder and the file, and writes one line', async () => {
    const target = join(dir, 'data');

    await appendFeedback(answerRecord(), { rating: 'up' }, { dir: target, clock });

    const text = await readFile(join(target, FEEDBACK_FILE), 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(text).rating).toBe('up');
  });

  it('adds to the file rather than replacing it', async () => {
    await appendFeedback(answerRecord(), { rating: 'up' }, { dir, clock });
    await appendFeedback(answerRecord(), { rating: 'down' }, { dir, clock });

    const lines = (await readFile(join(dir, FEEDBACK_FILE), 'utf8')).trim().split('\n');

    expect(lines.map((line) => JSON.parse(line).rating)).toEqual(['up', 'down']);
  });

  it('uses the system clock when none is given', async () => {
    await appendFeedback(answerRecord(), { rating: 'up' }, { dir });

    const { timestamp } = JSON.parse(await readFile(join(dir, FEEDBACK_FILE), 'utf8'));

    expect(Math.abs(Date.now() - Date.parse(timestamp))).toBeLessThan(60_000);
  });

  it('writes through the functions it is given', async () => {
    const make = vi.fn(async () => undefined);
    const add = vi.fn(async () => undefined);

    await appendFeedback(
      answerRecord(),
      { rating: 'up' },
      {
        dir: 'somewhere',
        clock,
        mkdir: /** @type {any} */ (make),
        appendFile: /** @type {any} */ (add),
      },
    );

    expect(make).toHaveBeenCalledWith('somewhere', { recursive: true });
    expect(add).toHaveBeenCalledWith(join('somewhere', FEEDBACK_FILE), expect.any(String), 'utf8');
  });

  it('says the feedback could not be saved, and keeps the cause', async () => {
    const cause = new Error('disk full');
    const add = vi.fn(async () => {
      throw cause;
    });

    const failure = await appendFeedback(
      answerRecord(),
      { rating: 'up' },
      { dir, clock, appendFile: /** @type {any} */ (add) },
    ).catch((error) => error);

    expect(failure).toBeInstanceOf(AppError);
    expect(failure.message).toBe('Could not save the feedback');
    expect(failure.cause).toBe(cause);
  });

  it('says so too when the folder cannot be created', async () => {
    const make = vi.fn(async () => {
      throw new Error('denied');
    });

    await expect(
      appendFeedback(
        answerRecord(),
        { rating: 'up' },
        { dir, clock, mkdir: /** @type {any} */ (make) },
      ),
    ).rejects.toThrow('Could not save the feedback');
  });
});
