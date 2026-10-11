// @ts-check
import { describe, expect, it } from 'vitest';
import * as answer from '../../src/answer/index.js';

describe('answer public entry point', () => {
  it('exports askQuestion, the command-line reader, the report and the argument summariser', () => {
    expect(Object.keys(answer).sort()).toEqual([
      'ASK_USAGE',
      'DEFAULT_ROLE_ID',
      'askQuestion',
      'describeInvalidKeys',
      'describeStyle',
      'formatReport',
      'parseAskArguments',
      'summarizeArguments',
    ]);
  });
});
