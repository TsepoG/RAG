// @ts-check

/** Secret values used in fixtures, exported so tests can assert they never leak. */
export const FAKE_GITHUB_TOKEN = 'fake-github-token-for-tests';
export const FAKE_ATLASSIAN_TOKEN = 'fake-atlassian-token-for-tests';

/**
 * Builds a complete, valid environment, optionally overridden.
 * @param {Record<string, string | undefined>} [overrides] - Variables to change; undefined removes one.
 * @returns {Record<string, string>} Environment that passes validation unless overridden.
 */
export function validEnv(overrides = {}) {
  /** @type {Record<string, string | undefined>} */
  const env = {
    GITHUB_TOKEN: FAKE_GITHUB_TOKEN,
    GITHUB_REPOS: 'acme/app,acme/docs',
    ATLASSIAN_SITE_URL: 'https://acme.atlassian.net',
    ATLASSIAN_EMAIL: 'dev@acme.example',
    ATLASSIAN_API_TOKEN: FAKE_ATLASSIAN_TOKEN,
    CONFLUENCE_SPACE_KEYS: 'ENG,PROD',
    ...overrides,
  };
  return /** @type {Record<string, string>} */ (
    Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined))
  );
}
