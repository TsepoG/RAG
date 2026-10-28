// @ts-check
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import { buildSessionConfig } from '../../src/copilot/session.js';
import { AtlassianSignInRequiredError } from '../../src/errors/index.js';
import { oauthEnv } from '../helpers/env.js';
import { TEST_ROLE } from '../helpers/role.js';

/**
 * Builds a session config in oauth mode.
 * @param {string} [atlassianToken] - The signed-in token.
 * @returns {import('@github/copilot-sdk').SessionConfig} The config.
 */
function build(atlassianToken) {
  return buildSessionConfig({
    config: loadConfig(oauthEnv()),
    role: /** @type {any} */ (TEST_ROLE),
    workingDirectory: 'sandbox/work',
    hooks: {},
    onPermissionRequest: async () => ({ kind: 'reject' }),
    atlassianToken,
  });
}

describe('buildSessionConfig in oauth mode', () => {
  it('sends the signed-in token to the Atlassian server', () => {
    const config = build('fake-signed-in-token');

    expect(config.mcpServers?.atlassian).toMatchObject({
      headers: { Authorization: 'Bearer fake-signed-in-token' },
    });
  });

  it('cannot be built without a token', () => {
    expect(() => build()).toThrow(AtlassianSignInRequiredError);
  });
});
