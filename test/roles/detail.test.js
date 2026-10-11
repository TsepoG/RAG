// @ts-check
import { describe, expect, it } from 'vitest';
import { DETAIL_LEVELS, loadRoles, withDetailLevel } from '../../src/roles/index.js';
import { makeRole } from '../helpers/role.js';

describe('DETAIL_LEVELS', () => {
  it('names the two levels', () => {
    expect([...DETAIL_LEVELS]).toEqual(['default', 'more']);
  });
});

describe('withDetailLevel', () => {
  it('gives back the same role for the usual level', () => {
    const role = makeRole({ depth: 1 });

    expect(withDetailLevel(role, 'default')).toBe(role);
  });

  it.each([
    [1, 2],
    [2, 3],
  ])('raises depth %i to %i when more detail is asked for', (from, to) => {
    const detailed = withDetailLevel(makeRole({ depth: from }), 'more');

    expect(detailed.depth).toBe(to);
    expect(detailed.detailLevel).toBe('more');
  });

  it('gives back a role at the most technical depth as it is', () => {
    const role = makeRole({ depth: 3 });

    expect(withDetailLevel(role, 'more')).toBe(role);
    expect(role).not.toHaveProperty('detailLevel');
  });

  it('bans no word once more detail is asked for', () => {
    const role = makeRole({ depth: 1, bannedTerms: ['endpoint', 'schema'] });

    expect(withDetailLevel(role, 'more').bannedTerms).toEqual([]);
  });

  it('changes nothing else about the role, and not the role itself', () => {
    const role = makeRole({ depth: 1, bannedTerms: ['endpoint'] });

    const detailed = withDetailLevel(role, 'more');

    expect(detailed).toEqual({ ...role, depth: 2, bannedTerms: [], detailLevel: 'more' });
    expect(role.depth).toBe(1);
    expect(role.bannedTerms).toEqual(['endpoint']);
  });

  it('gives a frozen role', () => {
    expect(Object.isFrozen(withDetailLevel(makeRole({ depth: 1 }), 'more'))).toBe(true);
  });

  it('works for every shipped role that is not already at the most technical depth', async () => {
    const roles = [...(await loadRoles()).values()].filter(({ depth }) => depth < 3);

    expect(roles.length).toBeGreaterThan(0);
    for (const role of roles) {
      expect(withDetailLevel(role, 'more')).toEqual({
        ...role,
        depth: role.depth + 1,
        bannedTerms: [],
        detailLevel: 'more',
      });
    }
  });
});
