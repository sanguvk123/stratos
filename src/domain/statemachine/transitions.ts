import {
  InvalidStateTransitionError,
  type RoundState,
  type SessionState,
  ROUND_STATES,
  SESSION_STATES,
} from './types';

// Legal transitions (ARCHITECTURE.md §4.2). Anything not listed is rejected (§4.3), including every
// backward move, every self-transition and every move out of a terminal state.

const SESSION_TRANSITIONS: Readonly<Record<SessionState, readonly SessionState[]>> = {
  lobby: ['active', 'abandoned'], // active: the first round is issued
  active: ['challenge_complete', 'abandoned'],
  challenge_complete: [], // terminal and immutable
  abandoned: [], // terminal
};

const ROUND_TRANSITIONS: Readonly<Record<RoundState, readonly RoundState[]>> = {
  question_active: ['question_closing'], // now() >= closes_at
  question_closing: ['reveal'], // finalization commits
  reveal: [], // terminal: a finalized round is never reopened
};

export function canTransitionSession(from: SessionState, to: SessionState): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}

export function canTransitionRound(from: RoundState, to: RoundState): boolean {
  return ROUND_TRANSITIONS[from].includes(to);
}

/** Called by every service method that mutates session state, before any database write. */
export function assertSessionTransition(from: SessionState, to: SessionState): void {
  if (!canTransitionSession(from, to)) throw new InvalidStateTransitionError('session', from, to);
}

/** Called by every service method that mutates round state, before any database write. */
export function assertRoundTransition(from: RoundState, to: RoundState): void {
  if (!canTransitionRound(from, to)) throw new InvalidStateTransitionError('round', from, to);
}

export function isTerminalSessionState(state: SessionState): boolean {
  return SESSION_TRANSITIONS[state].length === 0;
}

export function isTerminalRoundState(state: RoundState): boolean {
  return ROUND_TRANSITIONS[state].length === 0;
}

/** Every (from, to) pair that is legal, for tests and for generating the DB constraints. */
export function legalSessionTransitions(): ReadonlyArray<readonly [SessionState, SessionState]> {
  return SESSION_STATES.flatMap((from) =>
    SESSION_TRANSITIONS[from].map((to) => [from, to] as const),
  );
}

export function legalRoundTransitions(): ReadonlyArray<readonly [RoundState, RoundState]> {
  return ROUND_STATES.flatMap((from) => ROUND_TRANSITIONS[from].map((to) => [from, to] as const));
}
