// State vocabulary for the game (ARCHITECTURE.md §4).
//
// State lives in two tables, so there are two small machines rather than one:
//   - a SESSION (`game_sessions.state`): lobby -> active -> challenge_complete, or -> abandoned;
//   - a ROUND (`question_rounds.state`): question_active -> question_closing -> reveal.
// Both are strictly forward-only. Nothing in this module does I/O or reads a clock: every function
// takes the time it needs as an argument, so each rule is deterministic and testable.

export const SESSION_STATES = ['lobby', 'active', 'challenge_complete', 'abandoned'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const ROUND_STATES = ['question_active', 'question_closing', 'reveal'] as const;
export type RoundState = (typeof ROUND_STATES)[number];

export type MachineName = 'session' | 'round';

export class InvalidStateTransitionError extends Error {
  readonly machine: MachineName;
  readonly from: string;
  readonly to: string;

  constructor(machine: MachineName, from: string, to: string) {
    super(`illegal ${machine} transition: ${from} -> ${to}`);
    this.name = 'InvalidStateTransitionError';
    this.machine = machine;
    this.from = from;
    this.to = to;
  }
}

/** Thrown when inputs are malformed or contradict a documented invariant (corrupt data is loud). */
export class StateMachineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateMachineInputError';
  }
}

/** The shape a service passes in for each round the session has been issued (§4.6). */
export interface IssuedRound {
  /** 1-based position in the challenge. */
  readonly questionIndex: number;
  /** The STORED state. Use effectiveRoundState() for what it is at a given time. */
  readonly state: RoundState;
  /** Epoch milliseconds. */
  readonly closesAtMs: number;
  /** Epoch milliseconds, set once the round reached `reveal`. */
  readonly finalizedAtMs: number | null;
}
