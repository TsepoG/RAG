// @ts-check
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import { AtlassianSignInRequiredError } from '../../src/errors/index.js';
import { buildMcpServers, SERVER_KEYS } from '../../src/mcp/servers.js';
import { oauthEnv, validEnv } from '../helpers/env.js';

const TOOL_NAMES = {
  [SERVER_KEYS.atlassian]: ['searchConfluence'],
  [SERVER_KEYS.github]: ['get_file_contents'],
};

/** A made-up access token; it is never a real one. */
const SIGNED_IN_TOKEN = 'fake-signed-in-access-token';

describe('buildMcpServers in oauth mode', () => {
  it('sends the token of the person who signed in as a Bearer token', () => {
    const servers = buildMcpServers(loadConfig(oauthEnv()), TOOL_NAMES, {
      atlassianToken: SIGNED_IN_TOKEN,
    });

    expect(servers.atlassian.headers).toEqual({ Authorization: `Bearer ${SIGNED_IN_TOKEN}` });
  });

  it('keeps everything else as the other modes build it', () => {
    const oauth = buildMcpServers(loadConfig(oauthEnv()), TOOL_NAMES, {
      atlassianToken: SIGNED_IN_TOKEN,
    });
    const bearer = buildMcpServers(
      loadConfig(validEnv({ ATLASSIAN_AUTH_MODE: 'bearer', ATLASSIAN_EMAIL: undefined })),
      TOOL_NAMES,
    );

    expect({ ...oauth.atlassian, headers: undefined }).toEqual({
      ...bearer.atlassian,
      headers: undefined,
    });
    expect(oauth.github_repos).toEqual(bearer.github_repos);
  });

  it('refuses to build the servers without a token', () => {
    expect(() => buildMcpServers(loadConfig(oauthEnv()), TOOL_NAMES)).toThrow(
      AtlassianSignInRequiredError,
    );
  });
});

describe('buildMcpServers outside oauth mode', () => {
  it('ignores a signed-in token', () => {
    const config = loadConfig(validEnv());

    expect(buildMcpServers(config, TOOL_NAMES, { atlassianToken: SIGNED_IN_TOKEN })).toEqual(
      buildMcpServers(config, TOOL_NAMES),
    );
  });
});
