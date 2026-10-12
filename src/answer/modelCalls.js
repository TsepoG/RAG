// @ts-check

/**
 * The part of a Copilot "fusion" turn that says which concrete model did the work, when the
 * session's model is a router over several.
 * @typedef {object} FusionInfo
 * @property {string | undefined} syntheticModel - The routing model the session selected.
 * @property {string | undefined} sourceModel - The concrete model that produced the call.
 * @property {string | undefined} policy - The routing policy.
 * @property {string | undefined} pattern - The orchestration pattern.
 * @property {string | undefined} phaseKind - The kind of step the call belonged to.
 * @property {string | undefined} role - The role the step had.
 */

/**
 * One model call made while a question was answered.
 * @typedef {object} ModelCall
 * @property {number} index - Where the call came in the question, from 0.
 * @property {string} model - The model the runtime reported for the call.
 * @property {string | undefined} apiCallId - Ties the call to the message it produced.
 * @property {string | undefined} interactionType - The class of call, for example `conversation-agent`.
 * @property {string | undefined} initiator - What started the call; absent for the user's own.
 * @property {FusionInfo | undefined} fusion - Present when a router chose the model.
 * @property {boolean} producedFinal - Whether this call wrote the message used as the answer.
 */

/**
 * What a usage event is read for.
 * @typedef {object} UsageData
 * @property {string} model - The model.
 * @property {string} [apiCallId] - The call's id.
 * @property {string} [interactionType] - The class of call.
 * @property {string} [initiator] - What started it.
 * @property {{ syntheticModel?: string, sourceModel?: string, policy?: string, pattern?: string, phaseKind?: string, role?: string }} [fusion]
 *   Routing details, when a router chose the model.
 */

/**
 * Turns a usage event into the record kept for a question.
 * @param {UsageData} data - The event data.
 * @param {number} index - How many calls came before it.
 * @returns {ModelCall} The call, not yet known to have produced the answer.
 */
export function describeModelCall(data, index) {
  const { fusion } = data;
  return {
    index,
    model: data.model,
    apiCallId: data.apiCallId,
    interactionType: data.interactionType,
    initiator: data.initiator,
    fusion:
      fusion === undefined
        ? undefined
        : {
            syntheticModel: fusion.syntheticModel,
            sourceModel: fusion.sourceModel,
            policy: fusion.policy,
            pattern: fusion.pattern,
            phaseKind: fusion.phaseKind,
            role: fusion.role,
          },
    producedFinal: false,
  };
}

/**
 * Marks the call that wrote the answer. Without an id to match on, none is marked, rather than
 * guessing from order.
 * @param {ReadonlyArray<ModelCall>} calls - The calls, in order.
 * @param {string | undefined} finalApiCallId - The call id on the message used as the answer.
 * @returns {ModelCall[]} Copies, with `producedFinal` set where the ids match.
 */
export function markFinalCall(calls, finalApiCallId) {
  return calls.map((call) => ({
    ...call,
    producedFinal: finalApiCallId !== undefined && call.apiCallId === finalApiCallId,
  }));
}
