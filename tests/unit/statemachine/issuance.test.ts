import { describe, expect, it } from 'vitest';
import {
  decideIssuance,
  nextSessionState,
  shouldAbandon,
  StateMachineInputError,
  type IssuanceRequest,
  type IssuedRound,
  type RoundState,
  type SessionState,
} from '@/domain/statemachine';

const T0 = 1_700_000_000_000;
const REVEAL_WINDOW = 10_000;

function round(questionIndex: number, state: RoundState, servedAtMs: number, finalizedAtMs: number | null = null): IssuedRound {
  return { questionIndex, state, closesAtMs: servedAtMs + 60_000, finalizedAtMs };
}

/** A session that has fully played questions 1..n, each finalized 1 s after its deadline. */
function played(count: number, startMs = T0): IssuedRound[] {
  return Array.from({ length: count }, (_, i) => {
    const served = startMs + i * 120_000;
    return round(i + 1, 'reveal', served, served + 61_000);
  });
}

function request(overrides: Partial<IssuanceRequest> & Pick<IssuanceRequest, 'requestedIndex' | 'nowMs'>): IssuanceRequest {
  return { sessionState: 'active', rounds: [], revealWindowMs: REVEAL_WINDOW, ...overrides };
}

describe('issuing the first question (§4.6.1)', () => {
  it('issues question 1 from the lobby, starts the session, and stamps the deadline', () => {
    expect(decideIssuance(request({ sessionState: 'lobby', requestedIndex: 1, nowMs: T0 }))).toEqual({
      kind: 'issue',
      questionIndex: 1,
      servedAtMs: T0,
      closesAtMs: T0 + 60_000,
      startsSession: true,
    });
  });

  it('refuses to skip ahead to a later question', () => {
    expect(decideIssuance(request({ sessionState: 'lobby', requestedIndex: 2, nowMs: T0 }))).toEqual({
      kind: 'refuse',
      reason: 'OUT_OF_ORDER',
    });
  });
});

describe('idempotent retrieval: a round is never re-issued (§4.6.4)', () => {
  const open = [round(1, 'question_active', T0)];

  it('returns the existing round when the client retries after a lost response', () => {
    const decision = decideIssuance(request({ rounds: open, requestedIndex: 1, nowMs: T0 + 2_000 }));
    expect(decision).toEqual({ kind: 'return_existing', questionIndex: 1 });
  });

  it('returns the SAME round for a second tab or a duplicate concurrent request', () => {
    const first = decideIssuance(request({ rounds: open, requestedIndex: 1, nowMs: T0 + 100 }));
    const second = decideIssuance(request({ rounds: open, requestedIndex: 1, nowMs: T0 + 101 }));
    expect(first).toEqual(second);
    expect(first.kind).toBe('return_existing');
  });

  it('never issues a fresh deadline for an existing round, however late the retry is', () => {
    for (const lateBy of [1, 59_999, 60_000, 60_001, 3_600_000]) {
      const decision = decideIssuance(request({ rounds: open, requestedIndex: 1, nowMs: T0 + lateBy }));
      expect(decision).toEqual({ kind: 'return_existing', questionIndex: 1 });
    }
  });

  it('returns a closing or finalized round rather than a new one', () => {
    const closing = [round(1, 'question_closing', T0)];
    const done = played(1);
    expect(decideIssuance(request({ rounds: closing, requestedIndex: 1, nowMs: T0 + 90_000 })).kind).toBe('return_existing');
    expect(decideIssuance(request({ rounds: done, requestedIndex: 1, nowMs: T0 + 999_999 })).kind).toBe('return_existing');
  });

  it('retrieves an existing round even once the session is complete or abandoned', () => {
    for (const sessionState of ['challenge_complete', 'abandoned'] as SessionState[]) {
      const decision = decideIssuance(request({ sessionState, rounds: played(1), requestedIndex: 1, nowMs: T0 + 1_000_000 }));
      expect(decision).toEqual({ kind: 'return_existing', questionIndex: 1 });
    }
  });

  it('retrieves any earlier round, not just the latest', () => {
    expect(decideIssuance(request({ rounds: played(3), requestedIndex: 2, nowMs: T0 + 9_000_000 })).kind).toBe('return_existing');
  });
});

describe('issuing the next question (§4.6.5)', () => {
  const afterQ1 = played(1); // finalized at T0 + 61_000

  it('refuses while the previous round has not been finalized', () => {
    for (const state of ['question_active', 'question_closing'] as RoundState[]) {
      const rounds = [round(1, state, T0)];
      expect(decideIssuance(request({ rounds, requestedIndex: 2, nowMs: T0 + 90_000 }))).toEqual({
        kind: 'refuse',
        reason: 'PREVIOUS_NOT_FINALIZED',
      });
    }
  });

  it('refuses a round marked reveal that has no finalization time (corrupt-looking data is not trusted)', () => {
    const rounds = [round(1, 'reveal', T0, null)];
    expect(decideIssuance(request({ rounds, requestedIndex: 2, nowMs: T0 + 999_999 })).kind).toBe('refuse');
  });

  it('enforces the reveal window, and says when the next question becomes available', () => {
    const finalizedAt = T0 + 61_000;
    expect(decideIssuance(request({ rounds: afterQ1, requestedIndex: 2, nowMs: finalizedAt + 9_999 }))).toEqual({
      kind: 'refuse',
      reason: 'TOO_EARLY',
      availableAtMs: finalizedAt + REVEAL_WINDOW,
    });
  });

  it('issues exactly when the reveal window ends, with a fresh 60 s deadline', () => {
    const now = T0 + 61_000 + REVEAL_WINDOW;
    expect(decideIssuance(request({ rounds: afterQ1, requestedIndex: 2, nowMs: now }))).toEqual({
      kind: 'issue',
      questionIndex: 2,
      servedAtMs: now,
      closesAtMs: now + 60_000,
      startsSession: false,
    });
  });

  it('lets the player wait longer than the window: there is no upper limit on the pause here', () => {
    const now = T0 + 61_000 + 100 * REVEAL_WINDOW;
    expect(decideIssuance(request({ rounds: afterQ1, requestedIndex: 2, nowMs: now })).kind).toBe('issue');
  });

  it('refuses to skip a question', () => {
    const now = T0 + 61_000 + REVEAL_WINDOW;
    expect(decideIssuance(request({ rounds: afterQ1, requestedIndex: 3, nowMs: now }))).toEqual({
      kind: 'refuse',
      reason: 'OUT_OF_ORDER',
    });
  });

  it('issues all seven questions in order and then nothing more', () => {
    const rounds = played(6);
    const lastFinalized = rounds[5]!.finalizedAtMs!;
    const now = lastFinalized + REVEAL_WINDOW;
    expect(decideIssuance(request({ rounds, requestedIndex: 7, nowMs: now })).kind).toBe('issue');
    expect(decideIssuance(request({ rounds: played(7), requestedIndex: 8, nowMs: now + 9_999_999 }))).toEqual({
      kind: 'refuse',
      reason: 'INVALID_INDEX',
    });
  });
});

describe('sessions that cannot issue (§4.6)', () => {
  it.each(['challenge_complete', 'abandoned'] as SessionState[])('refuses a new round for a %s session', (sessionState) => {
    const decision = decideIssuance(request({ sessionState, rounds: played(2), requestedIndex: 3, nowMs: T0 + 9_999_999 }));
    expect(decision).toEqual({ kind: 'refuse', reason: 'SESSION_NOT_ISSUABLE' });
  });
});

describe('invalid requests and corrupt data', () => {
  it.each([0, -1, 8, 1.5, Number.NaN])('refuses index %s', (requestedIndex) => {
    expect(decideIssuance(request({ requestedIndex, nowMs: T0 }))).toEqual({ kind: 'refuse', reason: 'INVALID_INDEX' });
  });

  it('throws on duplicate, out-of-range, or gapped rounds rather than guessing', () => {
    expect(() => decideIssuance(request({ rounds: [round(1, 'reveal', T0, T0 + 1), round(1, 'reveal', T0, T0 + 1)], requestedIndex: 2, nowMs: T0 }))).toThrow(StateMachineInputError);
    expect(() => decideIssuance(request({ rounds: [round(2, 'reveal', T0, T0 + 1)], requestedIndex: 3, nowMs: T0 }))).toThrow(StateMachineInputError);
    expect(() => decideIssuance(request({ rounds: [round(9, 'reveal', T0, T0 + 1)], requestedIndex: 1, nowMs: T0 }))).toThrow(StateMachineInputError);
  });

  it('does not depend on the order the rounds are listed in', () => {
    const rounds = played(3);
    const shuffled = [rounds[2]!, rounds[0]!, rounds[1]!];
    const now = rounds[2]!.finalizedAtMs! + REVEAL_WINDOW;
    expect(decideIssuance(request({ rounds, requestedIndex: 4, nowMs: now }))).toEqual(
      decideIssuance(request({ rounds: shuffled, requestedIndex: 4, nowMs: now })),
    );
  });

  it('does not change the rounds it is given', () => {
    const rounds = played(2);
    const before = JSON.stringify(rounds);
    decideIssuance(request({ rounds, requestedIndex: 3, nowMs: T0 + 9_999_999 }));
    expect(JSON.stringify(rounds)).toBe(before);
  });
});

describe('nextSessionState', () => {
  it('completes only when all seven questions are issued and revealed', () => {
    expect(nextSessionState('active', played(7))).toBe('challenge_complete');
    expect(nextSessionState('active', played(6))).toBe('active');
    expect(nextSessionState('active', [...played(6), round(7, 'question_closing', T0 + 9e6)])).toBe('active');
    expect(nextSessionState('lobby', [])).toBe('lobby');
  });

  it('never changes a terminal state', () => {
    expect(nextSessionState('abandoned', played(7))).toBe('abandoned');
    expect(nextSessionState('challenge_complete', played(2))).toBe('challenge_complete');
  });
});

describe('shouldAbandon (§4.6.6)', () => {
  const ABANDON_AFTER = 300_000;
  const base = { abandonAfterMs: ABANDON_AFTER };

  it('abandons a session idle for MORE than the limit between questions', () => {
    const rounds = played(2);
    const last = rounds[1]!.finalizedAtMs!;
    expect(shouldAbandon({ ...base, sessionState: 'active', rounds, lastActivityMs: last, nowMs: last + ABANDON_AFTER })).toBe(false);
    expect(shouldAbandon({ ...base, sessionState: 'active', rounds, lastActivityMs: last, nowMs: last + ABANDON_AFTER + 1 })).toBe(true);
  });

  it('abandons a lobby session that never started', () => {
    expect(shouldAbandon({ ...base, sessionState: 'lobby', rounds: [], lastActivityMs: T0, nowMs: T0 + ABANDON_AFTER + 1 })).toBe(true);
    expect(shouldAbandon({ ...base, sessionState: 'lobby', rounds: [], lastActivityMs: T0, nowMs: T0 + 1_000 })).toBe(false);
  });

  it('never abandons a player who has a question open right now', () => {
    const rounds = [round(1, 'question_active', T0)];
    expect(shouldAbandon({ ...base, sessionState: 'active', rounds, lastActivityMs: T0 - 10_000_000, nowMs: T0 + 30_000 })).toBe(false);
  });

  it('does abandon once that open question has passed its deadline and the player has gone quiet', () => {
    const rounds = [round(1, 'question_active', T0)];
    expect(shouldAbandon({ ...base, sessionState: 'active', rounds, lastActivityMs: T0, nowMs: T0 + 60_000 + ABANDON_AFTER + 1 })).toBe(true);
  });

  it('never abandons a finished or already-terminal session', () => {
    expect(shouldAbandon({ ...base, sessionState: 'active', rounds: played(7), lastActivityMs: T0, nowMs: T0 + 9e9 })).toBe(false);
    for (const sessionState of ['challenge_complete', 'abandoned'] as SessionState[]) {
      expect(shouldAbandon({ ...base, sessionState, rounds: played(1), lastActivityMs: T0, nowMs: T0 + 9e9 })).toBe(false);
    }
  });

  it('only ends the session: it does not touch the rounds it was given', () => {
    const rounds = played(2);
    const before = JSON.stringify(rounds);
    shouldAbandon({ ...base, sessionState: 'active', rounds, lastActivityMs: T0, nowMs: T0 + 9e9 });
    expect(JSON.stringify(rounds)).toBe(before);
  });
});
