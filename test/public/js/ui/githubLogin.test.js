// @vitest-environment happy-dom
// @ts-check
import { describe, expect, it } from 'vitest';
import {
  attentionOf,
  buildAttentionBanners,
  buildSignInScreens,
  panelAccountOf,
} from '../../../../public/js/ui/attention.js';
import {
  buildGithubBanner,
  buildGithubSignIn,
  CHECK_AGAIN_LABEL,
  describeGithubAccount,
} from '../../../../public/js/ui/githubLogin.js';
import { buildSignedInPanel } from '../../../../public/js/ui/signedInPanel.js';

describe('describeGithubAccount', () => {
  it('names the account, or says only that the GitHub CLI is used', () => {
    expect(describeGithubAccount('TsepoG')).toBe('GitHub: TsepoG (GitHub CLI)');
    expect(describeGithubAccount(undefined)).toBe('GitHub (GitHub CLI)');
    expect(describeGithubAccount('')).toBe('GitHub (GitHub CLI)');
  });
});

describe('buildGithubSignIn', () => {
  it.each([
    [
      'logged-out',
      "GitHub CLI isn't logged in.",
      'gh auth login',
      'Run gh auth login in a terminal, then press Check again.',
    ],
    [
      'sso',
      'GitHub needs your organisation authorised.',
      'gh auth refresh -h github.com',
      'Run gh auth refresh -h github.com to authorise your organisation, then press Check again.',
    ],
    [
      'cli-missing',
      'GitHub CLI not found.',
      'GITHUB_CLI_PATH',
      'Install the GitHub CLI, or set GITHUB_CLI_PATH, then press Check again.',
    ],
  ])(
    'says what to do for %s, with the command as code and a Check again button',
    (reason, title, command, text) => {
      const screen = buildGithubSignIn(
        /** @type {keyof typeof import('../../../../public/js/signIn.js').GITHUB_MESSAGES} */ (
          reason
        ),
        { brand: true },
      );

      expect(screen.querySelector('h2')?.textContent).toBe(title);
      expect(screen.querySelector('p')?.textContent).toBe(text);
      expect(screen.querySelector('code')?.textContent).toBe(command);
      const button = /** @type {HTMLButtonElement} */ (screen.querySelector('button'));
      expect(button.textContent).toBe(CHECK_AGAIN_LABEL);
      expect(button.type).toBe('button');
      expect(button.getAttribute('data-action')).toBe('check-github');
      expect(screen.querySelector('a')).toBeNull();
      expect(screen.getAttribute('aria-labelledby')).toBe('github-sign-in-heading');
    },
  );

  it('carries the brand mark only when asked', () => {
    expect(
      buildGithubSignIn('logged-out', { brand: true }).querySelector('.brand__mark'),
    ).not.toBeNull();
    expect(
      buildGithubSignIn('logged-out', { brand: false }).querySelector('.brand__mark'),
    ).toBeNull();
  });
});

describe('buildGithubBanner', () => {
  it('says what to do and offers Check again, not a link', () => {
    const banner = buildGithubBanner('sso');

    expect(banner.className).toBe('expired-banner');
    expect(banner.querySelector('h2')?.textContent).toBe(
      'GitHub needs your organisation authorised.',
    );
    expect(banner.querySelector('code')?.textContent).toBe('gh auth refresh -h github.com');
    expect(banner.querySelector('[data-action="check-github"]')).not.toBeNull();
    expect(banner.querySelector('a')).toBeNull();
    expect(banner.getAttribute('aria-labelledby')).toBe('github-banner-title');
  });
});

describe('buildSignedInPanel with the GitHub CLI', () => {
  it('names both accounts, and offers Sign out for Atlassian', () => {
    const panel = buildSignedInPanel({
      siteHost: 'acme.atlassian.net',
      github: { login: 'TsepoG' },
    });

    expect([...panel.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'Signed in to acme.atlassian.net',
      'GitHub: TsepoG (GitHub CLI)',
    ]);
    expect(panel.querySelector('[data-action="sign-out"]')).not.toBeNull();
  });

  it('names only GitHub, with no Sign out, when Atlassian uses a service account', () => {
    const panel = buildSignedInPanel({ atlassian: false, github: { login: 'TsepoG' } });

    expect(panel.textContent).toBe('GitHub: TsepoG (GitHub CLI)');
    expect(panel.querySelector('button')).toBeNull();
  });
});

describe('what needs attention', () => {
  it('reads the Atlassian part alone when GitHub is not in gh-cli mode', () => {
    expect(attentionOf({ needed: true, account: undefined })).toEqual({
      atlassian: true,
      github: undefined,
    });
  });

  it('reads both parts in gh-cli mode', () => {
    expect(
      attentionOf({
        needed: true,
        account: undefined,
        atlassianNeeded: false,
        github: { needed: true, reason: 'sso', login: undefined },
      }),
    ).toEqual({ atlassian: false, github: 'sso' });
  });

  it('builds one sign-in part and one banner for each, Atlassian first', () => {
    const screens = buildSignInScreens({ atlassian: true, github: 'logged-out' });
    const banners = buildAttentionBanners({ atlassian: true, github: 'logged-out' });

    expect(screens.map((screen) => screen.getAttribute('aria-labelledby'))).toEqual([
      'sign-in-heading',
      'github-sign-in-heading',
    ]);
    expect(screens[1].querySelector('.brand__mark')).toBeNull();
    expect(banners.map((banner) => banner.getAttribute('aria-labelledby'))).toEqual([
      'expired-title',
      'github-banner-title',
    ]);
    expect(buildSignInScreens({ atlassian: false, github: undefined })).toEqual([]);
    expect(buildAttentionBanners({ atlassian: false, github: undefined })).toEqual([]);
  });

  it('gives the panel the Atlassian account alone outside gh-cli mode', () => {
    const account = { siteHost: 'acme.atlassian.net' };

    expect(panelAccountOf({ needed: false, account })).toBe(account);
  });

  it('adds the GitHub account to the panel while the GitHub CLI has a token', () => {
    const github = { needed: false, reason: /** @type {const} */ ('logged-out'), login: 'TsepoG' };

    expect(panelAccountOf({ needed: false, account: undefined, github })).toEqual({
      atlassian: false,
      github: { login: 'TsepoG' },
    });
    expect(
      panelAccountOf({ needed: false, account: { siteHost: 'acme.atlassian.net' }, github }),
    ).toEqual({ siteHost: 'acme.atlassian.net', atlassian: true, github: { login: 'TsepoG' } });
    expect(
      panelAccountOf({ needed: true, account: undefined, github: { ...github, needed: true } }),
    ).toBeUndefined();
  });
});
