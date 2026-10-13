// @ts-check
import { describe, expect, it } from 'vitest';
import * as answer from '../../src/answer/index.js';

describe('answer public entry point', () => {
  it('exports askQuestion, the command-line reader, the report, the argument summariser and the stages a conversation reuses', () => {
    expect(Object.keys(answer).sort()).toEqual([
      'ASK_USAGE',
      'DEFAULT_ROLE_ID',
      'askQuestion',
      'awaitQuiet',
      'buildQuestionHooks',
      'completeTurn',
      'createEventRecorder',
      'createLookups',
      'createNotifier',
      'describeInvalidKeys',
      'describeStyle',
      'formatReport',
      'parseAskArguments',
      'startInterrupt',
      'summarizeArguments',
      'toTurnError',
    ]);
  });
});
