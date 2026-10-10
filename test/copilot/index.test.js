// @ts-check
import { describe, expect, it } from 'vitest';
import * as copilot from '../../src/copilot/index.js';

describe('copilot public entry point', () => {
  it('exports the client, session and system message builders', () => {
    expect(Object.keys(copilot).sort()).toEqual([
      'AUTH_HELP',
      'CLIENT_NAME',
      'EXCLUDED_TOOLS',
      'buildClientOptions',
      'buildSessionConfig',
      'buildSystemMessage',
      'createCopilotClient',
      'ensureAuthenticated',
    ]);
  });
});
