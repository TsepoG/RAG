// @ts-check
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import { GithubSignInRequiredError } from '../../src/errors/index.js';
import { ALLOWLIST, buildMcpServers, SERVER_KEYS } from '../../src/mcp/index.js';
import { FAKE_GITHUB_TOKEN, validEnv } from '../helpers/env.js';

const FAKE_CLI_TOKEN = 'gho_FAKEfakeFAKEfake0123456789abcdefXYZ';
const ghCli = () => loadConfig(validEnv({ GITHUB_AUTH_MODE: 'gh-cli', GITHUB_TOKEN: undefined }));

describe('buildMcpServers in gh-cli mode', () => {
  it("sends the GitHub CLI's token as a Bearer header, with the same read-only headers, tools and time limit", () => {
    const github = buildMcpServers(ghCli(), ALLOWLIST, { githubToken: FAKE_CLI_TOKEN })[
      SERVER_KEYS.github
    ];
    const tokenMode = buildMcpServers(loadConfig(validEnv()), ALLOWLIST)[SERVER_KEYS.github];

    expect(github).toEqual({
      ...tokenMode,
      headers: { ...tokenMode.headers, Authorization: `Bearer ${FAKE_CLI_TOKEN}` },
    });
  });

  it('refuses to build the entry without a token', () => {
    expect(() => buildMcpServers(ghCli(), ALLOWLIST)).toThrow(GithubSignInRequiredError);
  });
});

describe('buildMcpServers in token mode', () => {
  it('ignores a CLI token and sends GITHUB_TOKEN, exactly as before', () => {
    const config = loadConfig(validEnv());

    expect(buildMcpServers(config, ALLOWLIST, { githubToken: FAKE_CLI_TOKEN })).toEqual(
      buildMcpServers(config, ALLOWLIST),
    );
    expect(buildMcpServers(config, ALLOWLIST)[SERVER_KEYS.github].headers?.Authorization).toBe(
      `Bearer ${FAKE_GITHUB_TOKEN}`,
    );
  });
});
