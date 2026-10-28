// @ts-check

// The page shown when signing in to Atlassian does not complete. It is built only from the fixed
// text below and the configured site: nothing from the callback's query is ever put on it. It
// uses the app's own style sheets and no script, so the usual CSP applies unchanged.

/** The page's heading. */
export const SIGN_IN_ERROR_HEADING = "Sign-in didn't complete";

/** Where "Try again" goes: a new sign-in. */
export const START_PATH = '/auth/atlassian/start';

/**
 * Says, in plain words, why the sign-in did not complete.
 * @param {import('../errors/index.js').AtlassianAuthReason} reason - Why.
 * @param {string} siteHost - The configured site's host, for the wrong-site case.
 * @returns {string} One sentence.
 */
export function describeSignInFailure(reason, siteHost) {
  switch (reason) {
    case 'cancelled':
      return 'The sign-in was cancelled on the Atlassian page.';
    case 'expired':
      return 'The sign-in took too long, or its link was already used. Please start again.';
    case 'missing-permissions':
      return "Atlassian didn't grant the read-only Confluence permissions the assistant needs.";
    case 'wrong-site':
      return `This Atlassian account can't reach ${siteHost}.`;
    default:
      return 'Something went wrong while signing in to Atlassian.';
  }
}

const ESCAPES = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

/**
 * Escapes text for HTML. The page holds no outside text, but the site host is still escaped.
 * @param {string} text - The text.
 * @returns {string} The escaped text.
 */
function escapeHtml(text) {
  return text.replaceAll(
    /[&<>"']/g,
    (character) => ESCAPES[/** @type {keyof typeof ESCAPES} */ (character)],
  );
}

/** The brand mark, drawn the way the page's icon module draws it. */
const BRAND_MARK =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 6h16M4 12h10M4 18h7"></path></svg>';

/**
 * Builds the sign-in error page.
 * @param {import('../errors/index.js').AtlassianAuthReason} reason - Why the sign-in did not complete.
 * @param {string} siteHost - The configured site's host.
 * @returns {string} The whole HTML page.
 */
export function renderSignInErrorPage(reason, siteHost) {
  const message = escapeHtml(describeSignInFailure(reason, siteHost));
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${SIGN_IN_ERROR_HEADING} · Knowledge Assistant</title>
    <link rel="stylesheet" href="/css/tokens.css" />
    <link rel="stylesheet" href="/css/base.css" />
    <link rel="stylesheet" href="/css/components.css" />
  </head>
  <body>
    <main class="auth-page">
      <div class="auth-card">
        <div class="brand">
          <span class="brand__mark">${BRAND_MARK}</span>
          <span class="brand__text">
            <span class="brand__name">Knowledge Assistant</span>
            <span class="brand__sources">Confluence + GitHub</span>
          </span>
        </div>
        <h1 class="auth-card__heading">${SIGN_IN_ERROR_HEADING}</h1>
        <p class="auth-card__text" role="alert">${message}</p>
        <a class="button button--primary" href="${START_PATH}">Try again</a>
      </div>
    </main>
  </body>
</html>
`;
}
