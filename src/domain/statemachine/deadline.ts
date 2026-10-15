import { StateMachineInputError, type RoundState } from './types';

// Deadline rules (ARCHITECTURE.md §4.5, §4.6, §11.2).
//
// These functions are the SPECIFICATION and the test oracle for the deadline logic. They are not
// the authority in production: the authoritative check runs in SQL under the round row lock, using
// the database clock (clock_timestamp()), so a submission and the finalizer can never disagree.
// Times here are epoch milliseconds; Task G's integration tests assert the SQL agrees with these
// functions on the boundaries.

export const ROUND_DURATION_MS = 60_000;

function assertInstant(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new StateMachineInputError(`${name} must be a non-negative integer, got ${value}`);
  }
}

/** closes_at = served_at + 60 s. Both are written once and never updated (§4.5). */
export function computeClosesAt(servedAtMs: number): number {
  assertInstant('servedAtMs', servedAtMs);
  return servedAtMs + ROUND_DURATION_MS;
}

/**
 * A write is accepted only strictly before the deadline. At exactly closes_at it is rejected, so
 * a round is open for [served_at, closes_at) and the boundary instant belongs to the closed side.
 */
export function isSubmissionOpen(nowMs: number, closesAtMs: number): boolean {
  assertInstant('nowMs', nowMs);
  assertInstant('closesAtMs', closesAtMs);
  return nowMs < closesAtMs;
}

/**
 * A round may finalize only once `finalize_grace_ms` has passed after the deadline (§4.5), so a
 * write that took the row lock just before closes_at commits before the finalizer reads it.
 */
export function isFinalizable(nowMs: number, closesAtMs: number, graceMs: number): boolean {
  assertInstant('nowMs', nowMs);
  assertInstant('closesAtMs', closesAtMs);
  assertInstant('graceMs', graceMs);
  return nowMs >= closesAtMs + graceMs;
}

/**
 * What a round IS at time `nowMs`, given what is stored. Closing is lazy (§4.5): a stored
 * `question_active` round past its deadline is already `question_closing`, whether or not any
 * worker has written that yet. A reconnecting client therefore always sees the true state and can
 * never reopen a closed round by refreshing.
 */
export function effectiveRoundState(
  stored: RoundState,
  nowMs: number,
  closesAtMs: number,
): RoundState {
  if (stored === 'question_active' && !isSubmissionOpen(nowMs, closesAtMs)) {
    return 'question_closing';
  }
  return stored;
}

/** Whole seconds left for display, never negative. The countdown is presentation only (§4.5). */
export function secondsRemaining(nowMs: number, closesAtMs: number): number {
  assertInstant('nowMs', nowMs);
  assertInstant('closesAtMs', closesAtMs);
  return Math.max(0, Math.ceil((closesAtMs - nowMs) / 1000));
}
