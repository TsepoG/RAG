// @vitest-environment happy-dom
// @ts-check
import { describe, expect, it } from 'vitest';
import { buildEndCard, describeEnd } from '../../../../public/js/ui/endCard.js';
import {
  buildExpiredBanner,
  EXPIRED_TEXT,
  SIGN_IN_AGAIN_LABEL,
} from '../../../../public/js/ui/expiredBanner.js';
import { buildSidebarContent } from '../../../../public/js/ui/sidebar.js';
import {
  buildSignedInPanel,
  describeAccount,
  SIGN_OUT_LABEL,
} from '../../../../public/js/ui/signedInPanel.js';
import {
  buildSignIn,
  SIGN_IN_HEADING,
  SIGN_IN_LABEL,
  SIGN_IN_PATH,
  SIGN_IN_TEXT,
} from '../../../../public/js/ui/signIn.js';

const ROLES = [{ id: 'po', displayName: 'Product Owner', description: 'Owns it.', depth: 1 }];

/**
 * Builds the sidebar content.
 * @param {Partial<import('../../../../public/js/ui/sidebar.js').SidebarInput>} [changes] - Parts to change.
 * @returns {HTMLElement} The content.
 */
function sidebar(changes = {}) {
  return buildSidebarContent({
    roles: ROLES,
    selectedId: 'po',
    locked: false,
    conversation: undefined,
    sourcesUsed: 0,
    busy: false,
    ...changes,
  });
}

describe('buildSignIn', () => {
  it('shows the heading, the line about access, and a real link to start signing in', () => {
    const screen = buildSignIn();

    expect(screen.querySelector('h2')?.textContent).toBe(SIGN_IN_HEADING);
    expect(screen.querySelector('p')?.textContent).toBe(SIGN_IN_TEXT);
    const link = /** @type {HTMLAnchorElement} */ (screen.querySelector('a'));
    expect(link.textContent).toBe(SIGN_IN_LABEL);
    expect(link.getAttribute('href')).toBe(SIGN_IN_PATH);
    expect(link.className).toBe('button button--primary');
    expect(SIGN_IN_PATH).toBe('/auth/atlassian/start');
  });

  it('is labelled by its heading and has the brand mark, hidden from screen readers', () => {
    const screen = buildSignIn();

    expect(screen.getAttribute('aria-labelledby')).toBe('sign-in-heading');
    expect(screen.querySelector('#sign-in-heading')).not.toBeNull();
    expect(screen.querySelector('.brand__mark svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('buildSignedInPanel', () => {
  it('names the site and offers a Sign out button', () => {
    const panel = buildSignedInPanel({ siteHost: 'acme.atlassian.net' });

    expect(panel.querySelector('p')?.textContent).toBe('Signed in to acme.atlassian.net');
    const button = /** @type {HTMLButtonElement} */ (panel.querySelector('button'));
    expect(button.textContent).toBe(SIGN_OUT_LABEL);
    expect(button.type).toBe('button');
    expect(button.getAttribute('data-action')).toBe('sign-out');
  });

  it.each([undefined, ''])('says "Signed in" without a site (%j)', (siteHost) => {
    expect(describeAccount(siteHost)).toBe('Signed in');
  });
});

describe('buildExpiredBanner', () => {
  it('says the sign-in expired and links to sign in again', () => {
    const banner = buildExpiredBanner();

    expect(banner.querySelector('h2')?.textContent).toBe('Your Atlassian sign-in has expired.');
    expect(banner.querySelector('p')?.textContent).toBe(EXPIRED_TEXT);
    const link = /** @type {HTMLAnchorElement} */ (banner.querySelector('a'));
    expect(link.textContent).toBe(SIGN_IN_AGAIN_LABEL);
    expect(link.getAttribute('href')).toBe('/auth/atlassian/start');
    expect(banner.getAttribute('aria-labelledby')).toBe('expired-title');
  });
});

describe('the sidebar while signing in matters', () => {
  it('hides the roles while the person must sign in first, keeping the brand', () => {
    const content = sidebar({ rolesHidden: true });

    expect(content.querySelector('.brand')).not.toBeNull();
    expect(content.querySelector('[data-role]')).toBeNull();
  });

  it('shows the signed-in panel last, when someone is signed in', () => {
    const content = sidebar({ account: { siteHost: 'acme.atlassian.net' } });

    expect(content.lastElementChild?.className).toBe('signed-in');
    expect(content.querySelector('[data-action="sign-out"]')).not.toBeNull();
  });

  it('has no panel in basic and bearer modes', () => {
    expect(sidebar().querySelector('.signed-in')).toBeNull();
  });
});

describe('the end card after signing out', () => {
  it('says the person signed out and how to go on', () => {
    expect(describeEnd('signed-out', 5)).toEqual({
      title: 'You signed out',
      body: 'Sign in to start a new conversation.',
    });
    expect(
      buildEndCard({
        reason: 'signed-out',
        maxTurns: 5,
        summary: { total: 0, unchanged: 0, changed: 0, unavailable: 0, unchecked: 0 },
      }).textContent,
    ).toContain('You signed out');
  });
});
