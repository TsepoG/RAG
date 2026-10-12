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
 * Names a model call for a reader: the model, and the concrete model behind it when a router chose.
 * @param {{ model: string, fusion?: { sourceModel?: string } }} call - The call.
 * @returns {string} For example `gpt-6-luna` or `gpt-6-luna via some-model`.
 */
function callLabel({ model, fusion }) {
  const behind = fusion?.sourceModel;
  return behind === undefined || behind === model ? model : `${model} via ${behind}`;
}

/**
 * Reads the model calls recorded in an answer, ignoring anything not shaped like one.
 * @param {Record<string, unknown> | undefined} result - A stored answer.
 * @returns {Array<{ model: string, fusion?: { sourceModel?: string }, producedFinal: boolean, interactionType?: string }>} The calls.
 */
function callsOf(result) {
  const recorded = result?.modelCalls;
  if (!Array.isArray(recorded)) {
    return [];
  }
  return recorded.flatMap((call) =>
    typeof call === 'object' && call !== null && typeof call.model === 'string'
      ? [{ ...call, producedFinal: call.producedFinal === true }]
      : [],
  );
}

/**
 * For each case, the models its calls used and the one that wrote the answer.
 * @param {ReadonlyArray<import('./run.js').RunEntry>} entries - The cases, as they ran.
 * @returns {Array<{ id: string, calls: number, models: string[], wrote: string }>} One row per case.
 */
export function callsByCase(entries) {
  return entries.map(({ id, result }) => {
    const calls = callsOf(result);
    const final = calls.find((call) => call.producedFinal);
    return {
      id,
      calls: calls.length,
      models: [...new Set(calls.map(callLabel))],
      wrote: final === undefined ? UNKNOWN : callLabel(final),
    };
  });
}

/**
 * Writes which models answered and every time the runtime changed the model, with the reason it
 * gave. Without this a change in results cannot be told apart from a change of model.
 * @param {ReadonlyArray<import('./run.js').RunEntry>} entries - The cases, as they ran.
 * @returns {string} Markdown with a table of who answered what and a table of the changes.
 */
export function formatModelSwitches(entries) {
  const answered = table(
    ['Last model reported', 'Cases', 'Which'],
    casesByModel(entries).map(({ model, cases }) => [
      model,
      String(cases.length),
      cases.join(', '),
    ]),
  );
  const perCase = table(
    ['Case', 'Model calls', 'Models used', 'Wrote the answer'],
    callsByCase(entries).map(({ id, calls, models, wrote }) => [
      id,
      String(calls),
      models.join(', ') || UNKNOWN,
      wrote,
    ]),
  );
  const groups = groupModelSwitches(entries);
  if (groups.length === 0) {
    return `${answered}\n\n${perCase}\n\nThe runtime did not change the model in any case.`;
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
  return `${answered}\n\n${perCase}\n\n${changes}`;
}
