// @ts-check
import { describe, expect, it } from 'vitest';
import { findForbiddenContent } from '../../src/fixtures/check.js';

const NOTHING = { names: [], replaced: [] };

describe('findForbiddenContent', () => {
  it('finds nothing in clean output', () => {
    const output =
      '{"url":"https://acme.atlassian.net/wiki/spaces/ENG/pages/1","email":"user1@example.com"}';

    expect(
      findForbiddenContent(output, { names: ['realcorp', 'RC'], replaced: ['Real title'] }),
    ).toEqual([]);
  });

  it('finds a configured name as a whole word, ignoring case for names of four or more characters', () => {
    expect(
      findForbiddenContent('see RealCorp docs', { names: ['realcorp'], replaced: [] }),
    ).toEqual(['a configured name (site, owner, repository or space)']);
  });

  it('matches a short name only in its exact case, so a space key does not match ordinary words', () => {
    const names = ['TS'];

    expect(findForbiddenContent('the TS space', { names, replaced: [] })).toHaveLength(1);
    expect(findForbiddenContent('lots, ts and tests', { names, replaced: [] })).toEqual([]);
  });

  it('does not match a name inside a longer word or a hyphenated name', () => {
    const names = ['Shortlist'];

    expect(
      findForbiddenContent('shortlisted and The-Shortlist-2', { names, replaced: [] }),
    ).toEqual([]);
  });

  it('finds a name written with regex special characters literally', () => {
    expect(findForbiddenContent('a.b+c', { names: ['a.b+c'], replaced: [] })).toHaveLength(1);
    expect(findForbiddenContent('axb+c', { names: ['a.b+c'], replaced: [] })).toEqual([]);
  });

  it('ignores an empty name, which would match everywhere', () => {
    expect(findForbiddenContent('anything', { names: [''], replaced: [] })).toEqual([]);
  });

  it.each(['mail me at boss@realcorp.example', 'a.b+tag@sub.domain.org'])(
    'finds the email address in %j',
    (output) => {
      expect(findForbiddenContent(output, NOTHING)).toEqual(['an email address']);
    },
  );

  it('allows the placeholder email domain', () => {
    expect(findForbiddenContent('user7@example.com', NOTHING)).toEqual([]);
  });

  it.each(['5b1f1c4a91b24c3d8e7f0123', '712020:5b1f1c4a-91b2-4c3d-8e7f-0123456789ab'])(
    'finds the Atlassian account id %s',
    (output) => {
      expect(findForbiddenContent(`id ${output}`, NOTHING)).toEqual(['an Atlassian account id']);
    },
  );

  it('does not mistake a 40-character commit SHA for an account id', () => {
    expect(findForbiddenContent('ebf99bea1fdf70b3a206c622a5134068c73eb607', NOTHING)).toEqual([]);
  });

  it('finds an original string that was meant to be replaced', () => {
    expect(
      findForbiddenContent('left: Refund policy v3', { names: [], replaced: ['Refund policy v3'] }),
    ).toEqual(['an original string that should have been replaced']);
  });

  it('does not count a replaced word that only survives as a JSON key', () => {
    const output = '{"zipball_url":"x","zipball":"part-1"}';

    expect(findForbiddenContent(output, { names: [], replaced: ['zipball'] })).toEqual([]);
  });

  it('does not count a replaced word that is a key of JSON held inside a string', () => {
    const output = JSON.stringify({ text: JSON.stringify({ zipball_url: 'x', events: 'part-1' }) });

    expect(findForbiddenContent(output, { names: [], replaced: ['events', 'zipball'] })).toEqual(
      [],
    );
  });

  it('does not count a replaced name that only appears inside a longer token', () => {
    const output = '{"url":"https://api.github.com/repos"}';

    expect(findForbiddenContent(output, { names: [], replaced: ['.github'] })).toEqual([]);
  });

  it('finds a replaced string that survives as a value inside JSON held in a string', () => {
    const output = JSON.stringify({ text: JSON.stringify({ title: 'Secret plan' }) });

    expect(findForbiddenContent(output, { names: [], replaced: ['Secret plan'] })).toEqual([
      'an original string that should have been replaced',
    ]);
  });

  it('still finds a replaced string that survives as a JSON value', () => {
    const output = '{"zipball":"zipball"}';

    expect(findForbiddenContent(output, { names: [], replaced: ['zipball'] })).toEqual([
      'an original string that should have been replaced',
    ]);
  });

  it('reports each kind of problem once, and never the offending value', () => {
    const findings = findForbiddenContent(
      'realcorp boss@realcorp.example 5b1f1c4a91b24c3d8e7f0123',
      {
        names: ['realcorp'],
        replaced: [],
      },
    );

    expect(findings).toHaveLength(3);
    expect(JSON.stringify(findings)).not.toContain('boss');
  });
});
