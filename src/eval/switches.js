// @ts-check
import { table } from './format.js';

/** Shown where the runtime did not name a model, a reason or a source. */
const UNKNOWN = 'unknown';

/**
 * A kind of model change and the cases it happened in.
 * @typedef {object} SwitchGroup
 * @property {string} reason - Why the runtime changed the model.
 * @property {string} source - Who chose the change.
 * @property {string} from - The model before.
 * @property {string} to - The model after.
 * @property {string[]} cases - The ids of the cases it happened in, without repeats.
 */

/**
 * Reads the model changes recorded in an answer, ignoring anything that is not shaped like one.
 * @param {Record<string, unknown> | undefined} result - A stored answer.
 * @returns {Array<{ reason: string, source: string, from: string, to: string }>} The changes.
 */
function changesOf(result) {
  const recorded = result?.modelChanges;
  if (!Array.isArray(recorded)) {
    return [];
  }
  return recorded.flatMap((change) => {
    if (typeof change !== 'object' || change === null || typeof change.to !== 'string') {
      return [];
    }
    const text = (/** @type {unknown} */ value) => (typeof value === 'string' ? value : UNKNOWN);
    return [
      {
        reason: text(change.reason),
        source: text(change.source),
        from: text(change.from),
        to: change.to,
      },
    ];
  });
}

/**
 * Groups the model changes of a run by reason, source and the two models.
 * @param {ReadonlyArray<import('./run.js').RunEntry>} entries - The cases, as they ran.
 * @returns {SwitchGroup[]} One group per kind of change, most common first.
 */
export function groupModelSwitches(entries) {
  /** @type {Map<string, SwitchGroup>} */
  const groups = new Map();
  for (const { id, result } of entries) {
    for (const change of changesOf(result)) {
      const key = [change.reason, change.source, change.from, change.to].join('\u0000');
      const group = groups.get(key) ?? { ...change, cases: [] };
      if (!group.cases.includes(id)) {
        group.cases.push(id);
      }
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort(
    (a, b) => b.cases.length - a.cases.length || a.reason.localeCompare(b.reason),
  );
}

/**
 * Lists the cases each model answered, so a result can be read knowing who gave it.
 * @param {ReadonlyArray<import('./run.js').RunEntry>} entries - The cases, as they ran.
 * @returns {Array<{ model: string, cases: string[] }>} One row per model, the busiest first.
 */
export function casesByModel(entries) {
  /** @type {Map<string, string[]>} */
  const byModel = new Map();
  for (const { id, result } of entries) {
    const model = typeof result?.model === 'string' ? result.model : UNKNOWN;
    byModel.set(model, [...(byModel.get(model) ?? []), id]);
  }
  return [...byModel]
    .map(([model, cases]) => ({ model, cases }))
    .sort((a, b) => b.cases.length - a.cases.length || a.model.localeCompare(b.model));
}

/**
 * Writes which models answered and every time the runtime changed the model, with the reason it
 * gave. Without this a change in results cannot be told apart from a change of model.
 * @param {ReadonlyArray<import('./run.js').RunEntry>} entries - The cases, as they ran.
 * @returns {string} Markdown with a table of who answered what and a table of the changes.
 */
export function formatModelSwitches(entries) {
  const answered = table(
    ['Answered by', 'Cases', 'Which'],
    casesByModel(entries).map(({ model, cases }) => [
      model,
      String(cases.length),
      cases.join(', '),
    ]),
  );
  const groups = groupModelSwitches(entries);
  if (groups.length === 0) {
    return `${answered}\n\nThe runtime did not change the model in any case.`;
  }
  const changes = table(
    ['Reason', 'Source', 'From', 'To', 'Cases', 'Which'],
    groups.map(({ reason, source, from, to, cases }) => [
      reason,
      source,
      from,
      to,
      String(cases.length),
      cases.join(', '),
    ]),
  );
  return `${answered}\n\n${changes}`;
}
