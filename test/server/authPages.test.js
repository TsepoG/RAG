// @vitest-environment jsdom
// @ts-check
import { describe, expect, it } from 'vitest';
import {
  describeSignInFailure,
  renderSignInErrorPage,
  SIGN_IN_ERROR_HEADING,
  START_PATH,
} from '../../src/server/authPages.js';

/** @type {Array<import('../../src/errors/index.js').AtlassianAuthReason>} */
const REASONS = ['cancelled', 'expired', 'missing-permissions', 'wrong-site', 'failed'];

/**
 * Parses the page.
 * @param {import('../../src/errors/index.js').AtlassianAuthReason} reason - Why.
 * @param {string} [siteHost] - The site.
 * @returns {Document} The page.
 */
function page(reason, siteHost = 'acme.atlassian.net') {
  return new globalThis.DOMParser().parseFromString(
    renderSignInErrorPage(reason, siteHost),
    'text/html',
  );
}

describe('describeSignInFailure', () => {
  it.each([
    ['cancelled', 'The sign-in was cancelled on the Atlassian page.'],
    ['expired', 'The sign-in took too long, or its link was already used. Please start again.'],
    [
      'missing-permissions',
      "Atlassian didn't grant the read-only Confluence permissions the assistant needs.",
    ],
    ['wrong-site', "This Atlassian account can't reach acme.atlassian.net."],
    ['failed', 'Something went wrong while signing in to Atlassian.'],
  ])('explains %s in plain words', (reason, text) => {
    expect(
      describeSignInFailure(
        /** @type {import('../../src/errors/index.js').AtlassianAuthReason} */ (reason),
        'acme.atlassian.net',
      ),
    ).toBe(text);
  });
});

describe('renderSignInErrorPage', () => {
  it.each(REASONS)('shows the heading, the %s reason and Try again', (reason) => {
    const document = page(reason);

    expect(document.querySelector('h1')?.textContent).toBe(SIGN_IN_ERROR_HEADING);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      describeSignInFailure(reason, 'acme.atlassian.net'),
    );
    const retry = document.querySelector('a.button--primary');
    expect(retry?.textContent).toBe('Try again');
    expect(retry?.getAttribute('href')).toBe(START_PATH);
  });

  it('loads only the app style sheets and no script, so the CSP holds', () => {
    const document = page('failed');

    expect(document.querySelectorAll('script')).toHaveLength(0);
    expect(document.querySelectorAll('[style]')).toHaveLength(0);
    expect([...document.querySelectorAll('link')].map((link) => link.getAttribute('href'))).toEqual(
      ['/css/tokens.css', '/css/base.css', '/css/components.css'],
    );
  });

  it('escapes the site host', () => {
    const html = renderSignInErrorPage('wrong-site', '<b>&"\'</b>');

    expect(html).toContain('&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
    expect(html).not.toContain('<b>');
  });
});
