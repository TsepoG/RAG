// @ts-check

/** Shown when a conversation cannot take another question. */
export const FULL_MESSAGE = 'This conversation is full — start a new one to keep going.';

/**
 * Why a conversation cannot take another question.
 * @typedef {'busy' | 'ended' | 'turns' | 'budget'} Refusal
 */

/**
 * One question and what became of it. A turn counts toward the cap from the moment it starts,
 * however it ends: it may already have fetched sources under its number.
 * @typedef {object} TurnRecord
 * @property {number} turn - The turn, from 1.
 * @property {string} question - What was asked.
 * @property {import('../roles/index.js').DetailLevel} detailLevel - How much detail was asked for.
 * @property {number} startedAt - When it started, in ms.
 * @property {'running' | 'answered' | 'cancelled' | 'failed'} status - How it went.
 * @property {number} [finishedAt] - When it ended, in ms.
 * @property {Record<string, unknown>} [outcome] - What the caller recorded: the result, the answer id.
 */

/**
 * What a conversation is allowed.
 * @typedef {object} ConversationLimits
 * @property {number} maxTurns - Most questions it may hold.
 * @property {number} maxSourceChars - Most characters of source text it may give the model.
 */

/**
 * A conversation: its role, its citation registry, its turns and its budgets. The open Copilot
 * session lives here too but is set and closed by whoever runs the turns.
 * @typedef {object} Conversation
 * @property {string} id - The conversation id.
 * @property {import('../roles/index.js').Role} role - The role it was started with.
 * @property {import('../citations/index.js').ConversationRegistry} registry - Its citations.
 * @property {number} createdAt - When it started, in ms.
 * @property {() => number} lastActivityAt - When it last did anything, in ms.
 * @property {() => void} touch - Records activity now.
 * @property {() => unknown} session - The open session, if any.
 * @property {(session: unknown) => void} setSession - Keeps the open session.
 * @property {() => unknown} takeSession - Gives up the open session, leaving none.
 * @property {() => boolean} isBusy - Whether a turn is running.
 * @property {(input: { question: string, detailLevel: import('../roles/index.js').DetailLevel }) => { ok: true, turn: number } | { ok: false, refusal: Refusal }} beginTurn - Starts a turn, or says why not.
 * @property {(turn: number, status: 'answered' | 'cancelled' | 'failed', outcome?: Record<string, unknown>) => void} finishTurn - Ends a turn.
 * @property {() => ReadonlyArray<TurnRecord>} turns - Every turn so far.
 * @property {() => number} turnCount - How many turns have started.
 * @property {(chars: number) => void} addSourceChars - Counts source text given to the model.
 * @property {() => number} sourceChars - How much has been given so far.
 * @property {() => 'turns' | 'budget' | undefined} fullReason - Why no more questions fit, if so.
 * @property {() => void} markTruncated - Notes that the runtime dropped part of the history.
 * @property {() => boolean} wasTruncated - Whether it did.
 * @property {(reason: string) => void} end - Closes it to new questions.
 * @property {() => string | undefined} endedReason - Why it was closed, if it was.
 * @property {number} maxTurns - The turn cap.
 */

/**
 * Creates a conversation.
 * @param {object} input - What it is made of.
 * @param {string} input.id - The conversation id.
 * @param {import('../roles/index.js').Role} input.role - The role.
 * @param {import('../citations/index.js').ConversationRegistry} input.registry - Its citation registry.
 * @param {{ now: () => number }} input.clock - The time source.
 * @param {ConversationLimits} input.limits - What it is allowed.
 * @returns {Conversation} A conversation with no turns.
 */
export function createConversation({ id, role, registry, clock, limits }) {
  /** @type {TurnRecord[]} */
  const records = [];
  const createdAt = clock.now();
  let lastActivity = createdAt;
  /** @type {unknown} */
  let session;
  let chars = 0;
  let truncated = false;
  /** @type {string | undefined} */
  let ended;

  const isBusy = () => records.some(({ status }) => status === 'running');
  const fullReason = () => {
    if (records.length >= limits.maxTurns) {
      return 'turns';
    }
    return chars >= limits.maxSourceChars ? 'budget' : undefined;
  };

  return {
    id,
    role,
    registry,
    createdAt,
    maxTurns: limits.maxTurns,
    lastActivityAt: () => lastActivity,
    touch() {
      lastActivity = clock.now();
    },
    session: () => session,
    setSession(next) {
      session = next;
    },
    takeSession() {
      const taken = session;
      session = undefined;
      return taken;
    },
    isBusy,
    beginTurn({ question, detailLevel }) {
      if (ended !== undefined) {
        return { ok: false, refusal: 'ended' };
      }
      if (isBusy()) {
        return { ok: false, refusal: 'busy' };
      }
      const full = fullReason();
      if (full !== undefined) {
        return { ok: false, refusal: full };
      }
      const turn = records.length + 1;
      records.push({ turn, question, detailLevel, startedAt: clock.now(), status: 'running' });
      registry.setTurn(turn);
      lastActivity = clock.now();
      return { ok: true, turn };
    },
    finishTurn(turn, status, outcome) {
      const index = records.findIndex((record) => record.turn === turn);
      if (index >= 0) {
        records[index] = { ...records[index], status, finishedAt: clock.now(), outcome };
        lastActivity = clock.now();
      }
    },
    turns: () => records.map((record) => ({ ...record })),
    turnCount: () => records.length,
    addSourceChars(count) {
      chars += count;
    },
    sourceChars: () => chars,
    fullReason,
    markTruncated() {
      truncated = true;
    },
    wasTruncated: () => truncated,
    end(reason) {
      ended ??= reason;
    },
    endedReason: () => ended,
  };
}
