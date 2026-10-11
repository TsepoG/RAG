// @ts-check
import { randomUUID } from 'node:crypto';

/** How many answers are remembered. The oldest is forgotten first. */
const DEFAULT_LIMIT = 50;

/**
 * What is remembered about an answer so feedback can refer to it by id. It holds no answer text:
 * feedback is stored on disk and must not copy what the sources said.
 * @typedef {object} AnswerRecord
 * @property {string} question - What was asked.
 * @property {string} role - The role id.
 * @property {import('../roles/index.js').DetailLevel} detailLevel - The level it was answered at.
 * @property {string} status - The final status.
 * @property {string | null} confidence - The final confidence, or null.
 * @property {string[]} citedKeys - Keys of the sources it cited.
 * @property {string | undefined} model - The model that wrote it.
 */

/**
 * The recent answers, by id.
 * @typedef {object} AnswerMemory
 * @property {(record: AnswerRecord) => string} remember - Keeps a record and returns its new id.
 * @property {(answerId: string) => AnswerRecord | undefined} get - The record, if it is still remembered.
 */

/**
 * Creates the memory of recent answers. The server hands out an id with each answer and accepts
 * feedback only for an id it gave out, so a page cannot make up the question, role or sources a
 * piece of feedback is about.
 * @param {{ limit?: number, newId?: () => string }} [options] - How many to keep, and where ids come from.
 * @returns {AnswerMemory} The memory.
 */
export function createAnswerMemory({ limit = DEFAULT_LIMIT, newId = randomUUID } = {}) {
  /** @type {Map<string, AnswerRecord>} */
  const records = new Map();
  return {
    remember(record) {
      const answerId = newId();
      records.set(answerId, Object.freeze({ ...record, citedKeys: [...record.citedKeys] }));
      while (records.size > limit) {
        const [oldest] = records.keys();
        records.delete(oldest);
      }
      return answerId;
    },
    get(answerId) {
      return records.get(answerId);
    },
  };
}
