import { computeClosesAt, isFinalizable } from './deadline';
import {
  StateMachineInputError,
  type IssuedRound,
  type SessionState,
} from './types';

// Round issuance and session lifecycle (ARCHITECTURE.md §4.6).
//
// The central rule is IDEMPOTENT RETRIEVAL ONLY: a round is created once, and every later request
// for the same question returns that same round with its original deadline. A round is never
// re-issued, rewritten or reset, because a server cannot know whether a browser received a
// committed response (§4.6.4). Production runs this decision under the session row lock.

export const DEFAULT_QUESTION_COUNT = 7;

export type IssuanceRefusal =
  | 'INVALID_INDEX' //            not an integer in 1..questionCount
  | 'SESSION_NOT_ISSUABLE' //     the session is complete or abandoned
  | 'OUT_OF_ORDER' //             not the next question
  | 'PREVIOUS_NOT_FINALIZED' //   the previous round has not reached reveal
  | 'TOO_EARLY'; //               reveal window not over yet

export type IssuanceDecision =
  | { readonly kind: 'return_existing'; readonly questionIndex: number }
  | {
      readonly kind: 'issue';
      readonly questionIndex: number;
      readonly servedAtMs: number;
      readonly closesAtMs: number;
      /** True for the first round: the session moves lobby -> active in the same transaction. */
      readonly startsSession: boolean;
    }
  | {
      readonly kind: 'refuse';
      readonly reason: IssuanceRefusal;
      /** For TOO_EARLY: when the next question becomes available. */
      readonly availableAtMs?: number;
    };

export interface IssuanceRequest {
  readonly sessionState: SessionState;
  /** Every round already issued to this session. */
  readonly rounds: readonly IssuedRound[];
  /** The question the client asks for. The client always names a specific index. */
  readonly requestedIndex: number;
  readonly nowMs: number;
  readonly revealWindowMs: number;
  readonly questionCount?: number;
}

/** Corrupt round data is loud: rounds must be unique, in range, and contiguous from 1. */
function validateRounds(rounds: readonly IssuedRound[], questionCount: number): IssuedRound[] {
  const sorted = [...rounds].sort((a, b) => a.questionIndex - b.questionIndex);
  sorted.forEach((round, position) => {
    if (!Number.isInteger(round.questionIndex) || round.questionIndex < 1 || round.questionIndex > questionCount) {
      throw new StateMachineInputError(`round index ${round.questionIndex} is out of range`);
    }
    if (round.questionIndex !== position + 1) {
      throw new StateMachineInputError(
        `rounds must be unique and contiguous from 1, found index ${round.questionIndex} at position ${position + 1}`,
      );
    }
  });
  return sorted;
}

export function decideIssuance(request: IssuanceRequest): IssuanceDecision {
  const questionCount = request.questionCount ?? DEFAULT_QUESTION_COUNT;
  const { requestedIndex, nowMs, revealWindowMs, sessionState } = request;

  if (!Number.isInteger(requestedIndex) || requestedIndex < 1 || requestedIndex > questionCount) {
    return { kind: 'refuse', reason: 'INVALID_INDEX' };
  }
  const rounds = validateRounds(request.rounds, questionCount);

  // Retrieval comes first and ignores the session state: handing back an existing round creates
  // nothing, so a retry after a lost response, a second tab, or a request after the deadline all
  // get the same round and the same closes_at.
  if (rounds.some((round) => round.questionIndex === requestedIndex)) {
    return { kind: 'return_existing', questionIndex: requestedIndex };
  }

  if (sessionState === 'challenge_complete' || sessionState === 'abandoned') {
    return { kind: 'refuse', reason: 'SESSION_NOT_ISSUABLE' };
  }

  const nextIndex = rounds.length + 1;
  if (requestedIndex !== nextIndex) return { kind: 'refuse', reason: 'OUT_OF_ORDER' };

  const previous = rounds[rounds.length - 1];
  if (previous !== undefined) {
    if (previous.state !== 'reveal' || previous.finalizedAtMs === null) {
      return { kind: 'refuse', reason: 'PREVIOUS_NOT_FINALIZED' };
    }
    const availableAtMs = previous.finalizedAtMs + revealWindowMs;
    if (nowMs < availableAtMs) return { kind: 'refuse', reason: 'TOO_EARLY', availableAtMs };
  }

  return {
    kind: 'issue',
    questionIndex: requestedIndex,
    servedAtMs: nowMs,
    closesAtMs: computeClosesAt(nowMs),
    startsSession: previous === undefined,
  };
}

/**
 * The state a session should be in, given its rounds. A session completes when every question has
 * been issued and every round has reached reveal. Terminal states never change.
 */
export function nextSessionState(
  sessionState: SessionState,
  rounds: readonly IssuedRound[],
  questionCount: number = DEFAULT_QUESTION_COUNT,
): SessionState {
  if (sessionState === 'challenge_complete' || sessionState === 'abandoned') return sessionState;
  const sorted = validateRounds(rounds, questionCount);
  const everyQuestionRevealed =
    sorted.length === questionCount && sorted.every((round) => round.state === 'reveal');
  if (everyQuestionRevealed) return 'challenge_complete';
  return sessionState;
}

export interface AbandonCheck {
  readonly sessionState: SessionState;
  readonly rounds: readonly IssuedRound[];
  readonly lastActivityMs: number;
  readonly nowMs: number;
  /** A session idle for MORE than this is abandoned (§4.6.6, default 300 s). */
  readonly abandonAfterMs: number;
  readonly questionCount?: number;
}

/**
 * Whether an idle session should be marked abandoned. Abandonment only ends the SESSION: its
 * rounds still finalize on their own, and unserved questions simply have no round row, so an
 * abandoned session can never block a cohort (§4.6.6).
 */
export function shouldAbandon(check: AbandonCheck): boolean {
  const { sessionState, rounds, lastActivityMs, nowMs, abandonAfterMs } = check;
  if (sessionState === 'challenge_complete' || sessionState === 'abandoned') return false;

  // A session that has finished every question is complete, not abandoned.
  if (nextSessionState(sessionState, rounds, check.questionCount) === 'challenge_complete') {
    return false;
  }
  // Never abandon a player who has a question open right now.
  if (rounds.some((round) => round.state === 'question_active' && nowMs < round.closesAtMs)) {
    return false;
  }
  return nowMs - lastActivityMs > abandonAfterMs;
}

/** Re-exported so callers deciding "may the finalizer run" use the same rule as the tests. */
export { isFinalizable };
