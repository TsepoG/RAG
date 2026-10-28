// @ts-check
import { describe, expect, it } from 'vitest';
import { listSecrets, loadConfig, redactConfig } from '../../src/config/index.js';
import { FAKE_ATLASSIAN_TOKEN, FAKE_GITHUB_TOKEN, oauthEnv } from '../helpers/env.js';

describe('loadConfig in oauth mode', () => {
  it('loads without an email or an API token', () => {
    const config = loadConfig(oauthEnv());

    expect(config.atlassian.auth.mode).toBe('oauth');
    expect(config.atlassian.apiToken).toBeUndefined();
  });
});

describe('redactConfig in oauth mode', () => {
  it('leaves the API token unset, so the log does not suggest there is one', () => {
    const redacted = redactConfig(loadConfig(oauthEnv()));

    expect(redacted.atlassian.apiToken).toBeUndefined();
    expect(redacted.github.token).toBe('***');
  });
});

describe('listSecrets in oauth mode', () => {
  it('lists only the GitHub token, because the sign-in is not part of the config', () => {
    const config = loadConfig(oauthEnv({ ATLASSIAN_API_TOKEN: FAKE_ATLASSIAN_TOKEN }));

    expect(listSecrets(config)).toEqual([FAKE_GITHUB_TOKEN]);
  });
});
