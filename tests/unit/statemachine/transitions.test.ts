import { describe, expect, it } from 'vitest';
import {
  assertRoundTransition,
  assertSessionTransition,
  canTransitionRound,
  canTransitionSession,
  InvalidStateTransitionError,
  isTerminalRoundState,
  isTerminalSessionState,
  legalRoundTransitions,
  legalSessionTransitions,
  ROUND_STATES,
  SESSION_STATES,
  type RoundState,
  type SessionState,
} from '@/domain/statemachine';

const LEGAL_SESSION: Array<[SessionState, SessionState]> = [
  ['lobby', 'active'],
  ['lobby', 'abandoned'],
  ['active', 'challenge_complete'],
  ['active', 'abandoned'],
];
const LEGAL_ROUND: Array<[RoundState, RoundState]> = [
  ['question_active', 'question_closing'],
  ['question_closing', 'reveal'],
];

describe('session transitions (§4.2)', () => {
  it.each(LEGAL_SESSION)('allows %s -> %s', (from, to) => {
    expect(canTransitionSession(from, to)).toBe(true);
    expect(() => assertSessionTransition(from, to)).not.toThrow();
  });

  it('rejects every other pair, exhaustively', () => {
    const legal = new Set(LEGAL_SESSION.map(([a, b]) => `${a}>${b}`));
    let rejected = 0;
    for (const from of SESSION_STATES) {
      for (const to of SESSION_STATES) {
        if (legal.has(`${from}>${to}`)) continue;
        expect(canTransitionSession(from, to)).toBe(false);
        expect(() => assertSessionTransition(from, to)).toThrow(InvalidStateTransitionError);
        rejected += 1;
      }
    }
    expect(rejected).toBe(SESSION_STATES.length ** 2 - LEGAL_SESSION.length);
  });

  it('rejects self-transitions and every move out of a terminal state (§4.3)', () => {
    for (const state of SESSION_STATES) {
      expect(canTransitionSession(state, state)).toBe(false);
    }
    for (const terminal of ['challenge_complete', 'abandoned'] as const) {
      expect(isTerminalSessionState(terminal)).toBe(true);
      for (const to of SESSION_STATES) expect(canTransitionSession(terminal, to)).toBe(false);
    }
    expect(isTerminalSessionState('lobby')).toBe(false);
    expect(isTerminalSessionState('active')).toBe(false);
  });

  it('cannot skip finalization or restart (named cases from §4.3)', () => {
    expect(canTransitionSession('lobby', 'challenge_complete')).toBe(false);
    expect(canTransitionSession('active', 'lobby')).toBe(false);
    expect(canTransitionSession('abandoned', 'active')).toBe(false);
  });

  it('carries the machine and both states on the error', () => {
    try {
      assertSessionTransition('challenge_complete', 'active');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidStateTransitionError);
      const typed = error as InvalidStateTransitionError;
      expect([typed.machine, typed.from, typed.to]).toEqual(['session', 'challenge_complete', 'active']);
      expect(typed.message).toContain('challenge_complete -> active');
    }
  });

  it('lists exactly the legal pairs', () => {
    expect(legalSessionTransitions()).toEqual(LEGAL_SESSION);
  });
});

describe('round transitions (§4.2)', () => {
  it.each(LEGAL_ROUND)('allows %s -> %s', (from, to) => {
    expect(canTransitionRound(from, to)).toBe(true);
    expect(() => assertRoundTransition(from, to)).not.toThrow();
  });

  it('rejects every other pair, exhaustively', () => {
    const legal = new Set(LEGAL_ROUND.map(([a, b]) => `${a}>${b}`));
    for (const from of ROUND_STATES) {
      for (const to of ROUND_STATES) {
        if (legal.has(`${from}>${to}`)) continue;
        expect(canTransitionRound(from, to)).toBe(false);
        expect(() => assertRoundTransition(from, to)).toThrow(InvalidStateTransitionError);
      }
    }
  });

  it('never reopens a closing or finalized round (§4.3)', () => {
    expect(canTransitionRound('question_closing', 'question_active')).toBe(false);
    expect(canTransitionRound('reveal', 'question_active')).toBe(false);
    expect(canTransitionRound('reveal', 'question_closing')).toBe(false);
  });

  it('cannot skip the closing state', () => {
    expect(canTransitionRound('question_active', 'reveal')).toBe(false);
  });

  it('treats reveal as terminal', () => {
    expect(isTerminalRoundState('reveal')).toBe(true);
    expect(isTerminalRoundState('question_active')).toBe(false);
    expect(isTerminalRoundState('question_closing')).toBe(false);
  });

  it('lists exactly the legal pairs', () => {
    expect(legalRoundTransitions()).toEqual(LEGAL_ROUND);
  });

  it('only ever moves forward through the declared order', () => {
    for (const [from, to] of legalRoundTransitions()) {
      expect(ROUND_STATES.indexOf(to)).toBeGreaterThan(ROUND_STATES.indexOf(from));
    }
  });
});
