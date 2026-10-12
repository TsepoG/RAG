// @ts-check
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { EvalError } from '../../src/errors/index.js';
import { loadRoles } from '../../src/roles/index.js';
import { assertRunnable, EXAMPLE_FILE, loadCases, selectCases } from '../../src/eval/index.js';

const ROLES = new Set(['developer', 'product_owner', 'qa']);

const VALID = `
cases:
  - id: dev-one
    role: developer
    question: Where is it enforced?
    tags: [smoke]
    expect: { status: answered, reference: In one file. }
  - id: po-two
    role: product_owner
    question: How long?
    draft: true
    expect: { status: not_found, reference: Nowhere. }
  - id: qa-three
    role: qa
    question: What edge cases?
    tags: [smoke, not-found]
    expect: { status: not_found, reference: None documented. }
`;

/**
 * A fake file reader.
 * @param {string} text - What the file holds.
 * @returns {(path: string, encoding: 'utf8') => Promise<string>} The reader.
 */
function reading(text) {
  return vi.fn(async () => text);
}

/**
 * Loads cases from text.
 * @param {string} text - The YAML.
 * @returns {ReturnType<typeof loadCases>} The cases.
 */
function load(text) {
  return loadCases({ file: 'set.yaml', readFile: reading(text), roles: ROLES });
}

describe('loadCases', () => {
  it('loads every case, in file order, with the defaults filled in', async () => {
    const cases = await load(VALID);

    expect(cases.map(({ id }) => id)).toEqual(['dev-one', 'po-two', 'qa-three']);
    expect(cases[0]).toMatchObject({ draft: false, tags: ['smoke'] });
    expect(cases[1].draft).toBe(true);
  });

  it('reads the file it is given as UTF-8', async () => {
    const readFileFake = reading(VALID);

    await loadCases({ file: 'my/set.yaml', readFile: readFileFake, roles: ROLES });

    expect(readFileFake).toHaveBeenCalledWith('my/set.yaml', 'utf8');
  });

  it('gives cases that cannot be changed', async () => {
    const cases = await load(VALID);

    expect(Object.isFrozen(cases)).toBe(true);
    expect(Object.isFrozen(cases[0])).toBe(true);
  });

  it('accepts the roles as a map, as loadRoles returns them', async () => {
    const roles = new Map([...ROLES].map((id) => [id, {}]));

    await expect(
      loadCases({ file: 'set.yaml', readFile: reading(VALID), roles }),
    ).resolves.toHaveLength(3);
  });

  it('says to copy the example when the real set is missing', async () => {
    const missing = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    const failure = await loadCases({
      readFile: vi.fn(async () => Promise.reject(missing)),
      roles: ROLES,
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(EvalError);
    expect(failure.message).toContain('eval/questions.yaml');
    expect(failure.message).toContain(`Copy ${EXAMPLE_FILE}`);
    expect(failure.cause).toBe(missing);
  });

  it('gives no advice to copy the example when the file exists but cannot be read', async () => {
    const failure = await loadCases({
      file: 'set.yaml',
      readFile: vi.fn(async () => Promise.reject(new Error('permission denied'))),
      roles: ROLES,
    }).catch((error) => error);

    expect(failure.message).toBe('Cannot read the eval set set.yaml.');
  });

  it('rejects text that is not YAML', async () => {
    const failure = await load('cases: [unclosed').catch((error) => error);

    expect(failure).toBeInstanceOf(EvalError);
    expect(failure.message).toBe('set.yaml is not valid YAML.');
  });

  it.each([
    ['a list with no "cases" key', '- id: x'],
    ['a "cases" that is not a list', 'cases: nope'],
    ['an empty file', ''],
    ['an unknown top-level key', 'cases: []\nextra: 1'],
  ])('rejects %s', async (_name, text) => {
    await expect(load(text)).rejects.toThrow('must have a top-level "cases" list');
  });

  it('accepts an empty list of cases', async () => {
    expect(await load('cases: []')).toHaveLength(0);
  });

  it('names the case, the field and the problem', async () => {
    const failure = await load(`
cases:
  - id: dev-one
    role: developer
    question: Where?
    tags: [speedy]
    expect: { status: answered, reference: x }
`).catch((error) => error);

    expect(failure.message).toContain('Case "dev-one": tags.0:');
  });

  it('names a case with no usable id by its place in the list', async () => {
    const failure = await load(`
cases:
  - role: developer
    question: Where?
    expect: { status: answered, reference: x }
  - 5
`).catch((error) => error);

    expect(failure.message).toContain('Case #1: id:');
    expect(failure.message).toContain('Case #2:');
  });

  it('rejects an unknown role, naming the valid ones', async () => {
    const failure = await load(`
cases:
  - id: boss-one
    role: boss
    question: Where?
    expect: { status: answered, reference: x }
`).catch((error) => error);

    expect(failure.message).toContain('Case "boss-one": unknown role "boss".');
    expect(failure.message).toContain('Valid roles: developer, product_owner, qa');
  });

  it('rejects an id used twice', async () => {
    const failure = await load(`
cases:
  - { id: same, role: qa, question: One?, expect: { status: answered, reference: x } }
  - { id: same, role: qa, question: Two?, expect: { status: answered, reference: y } }
`).catch((error) => error);

    expect(failure.message).toContain('Case "same": the id is used more than once');
  });

  it('reports every problem at once, one line each', async () => {
    const failure = await load(`
cases:
  - { id: a, role: boss, question: One?, expect: { status: answered, reference: x } }
  - { id: b, role: qa, question: '', expect: { status: answered, reference: x } }
`).catch((error) => error);

    const lines = failure.message.split('\n');
    expect(lines[0]).toBe('set.yaml has problems:');
    expect(lines.filter((/** @type {string} */ line) => line.startsWith('- '))).toHaveLength(2);
  });

  it('loads the committed example with the real roles', async () => {
    const roles = await loadRoles();

    const cases = await loadCases({ file: EXAMPLE_FILE, readFile, roles });

    expect(cases).toHaveLength(5);
    expect(cases.every(({ draft }) => !draft)).toBe(true);
    expect(new Set(cases.map(({ expect: { status } }) => status))).toEqual(
      new Set(['answered', 'not_found', 'out_of_scope']),
    );
  });
});

describe('selectCases', () => {
  /** @returns {Promise<ReadonlyArray<import('../../src/eval/schema.js').EvalCase>>} The sample cases. */
  const sample = () => load(VALID);

  it('keeps every case for the full subset, which is the default', async () => {
    const cases = await sample();

    expect(selectCases(cases)).toHaveLength(3);
    expect(selectCases(cases, { subset: 'full' })).toHaveLength(3);
  });

  it('keeps only the smoke cases for the smoke subset', async () => {
    const chosen = selectCases(await sample(), { subset: 'smoke' });

    expect(chosen.map(({ id }) => id)).toEqual(['dev-one', 'qa-three']);
  });

  it('keeps one case by id', async () => {
    expect(selectCases(await sample(), { caseId: 'po-two' }).map(({ id }) => id)).toEqual([
      'po-two',
    ]);
  });

  it('keeps one role', async () => {
    expect(selectCases(await sample(), { role: 'qa' }).map(({ id }) => id)).toEqual(['qa-three']);
  });

  it('combines the filters', async () => {
    const cases = await sample();

    expect(selectCases(cases, { subset: 'smoke', role: 'developer' })).toHaveLength(1);
    expect(() => selectCases(cases, { subset: 'smoke', role: 'product_owner' })).toThrow(
      'No case matches that selection.',
    );
  });

  it('says so when the id names no case', async () => {
    await expect(
      Promise.resolve().then(async () => selectCases(await sample(), { caseId: 'nope' })),
    ).rejects.toThrow('There is no case with the id "nope".');
  });

  it('says so when a role has no cases', async () => {
    expect(() => selectCases([], {})).toThrow('No case matches that selection.');
  });
});

describe('assertRunnable', () => {
  it('lets cases that have all been checked go ahead', async () => {
    const cases = (await load(VALID)).filter(({ draft }) => !draft);

    expect(() => assertRunnable(cases)).not.toThrow();
  });

  it('refuses a selection with a draft, naming each draft', async () => {
    const cases = await load(VALID.replace('tags: [smoke, not-found]', 'draft: true'));

    expect(() => assertRunnable(cases)).toThrow(EvalError);
    expect(() => assertRunnable(cases)).toThrow('po-two, qa-three');
  });

  it('is not bothered by a draft that was not selected', async () => {
    const cases = selectCases(await load(VALID), { subset: 'smoke' });

    expect(() => assertRunnable(cases)).not.toThrow();
  });
});

describe('loadCases with the roles as a map', () => {
  it('names the valid roles from the map when a role is unknown', async () => {
    const roles = new Map([['developer', {}]]);

    const failure = await loadCases({
      file: 'set.yaml',
      readFile: reading(
        'cases:\n  - { id: x, role: boss, question: Where?, expect: { status: answered, reference: r } }',
      ),
      roles,
    }).catch((error) => error);

    expect(failure.message).toContain('Valid roles: developer');
  });
});

describe('selectCases with a list of ids', () => {
  /** @returns {Promise<ReadonlyArray<import('../../src/eval/schema.js').EvalCase>>} The sample cases. */
  const sample = () => load(VALID);

  it('keeps only the listed cases, in file order', async () => {
    const chosen = selectCases(await sample(), { ids: ['qa-three', 'po-two'] });

    expect(chosen.map(({ id }) => id)).toEqual(['po-two', 'qa-three']);
  });

  it('keeps the listed cases and the smoke cases together, each once', async () => {
    const chosen = selectCases(await sample(), { ids: ['po-two', 'dev-one'], subset: 'smoke' });

    expect(chosen.map(({ id }) => id)).toEqual(['dev-one', 'po-two', 'qa-three']);
  });

  it('keeps every case when the full subset is added', async () => {
    expect(selectCases(await sample(), { ids: ['po-two'], subset: 'full' })).toHaveLength(3);
  });

  it('names every id that is not a case', async () => {
    const cases = await sample();

    expect(() => selectCases(cases, { ids: ['po-two', 'nope', 'nada'] })).toThrow(
      'There is no case with the id "nope", "nada".',
    );
  });

  it('still applies the role filter', async () => {
    const cases = await sample();

    expect(selectCases(cases, { ids: ['po-two', 'qa-three'], role: 'qa' })).toHaveLength(1);
  });
});
