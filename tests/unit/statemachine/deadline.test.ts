import { describe, expect, it } from 'vitest';
import {
  computeClosesAt,
  effectiveRoundState,
  isFinalizable,
  isSubmissionOpen,
  ROUND_DURATION_MS,
  secondsRemaining,
  StateMachineInputError,
} from '@/domain/statemachine';

const SERVED = 1_700_000_000_000;
const CLOSES = SERVED + 60_000;

describe('the 60-second window (§4.5)', () => {
  it('closes exactly 60 seconds after it was served', () => {
    expect(ROUND_DURATION_MS).toBe(60_000);
    expect(computeClosesAt(SERVED)).toBe(CLOSES);
    expect(computeClosesAt(0)).toBe(60_000);
  });

  it('rejects an invalid served time', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => computeClosesAt(bad)).toThrow(StateMachineInputError);
    }
  });
});

describe('isSubmissionOpen: the boundary belongs to the closed side (§11.2)', () => {
  it('accepts writes strictly before the deadline', () => {
    expect(isSubmissionOpen(SERVED, CLOSES)).toBe(true);
    expect(isSubmissionOpen(CLOSES - 1, CLOSES)).toBe(true);
  });

  it('rejects a write at exactly the deadline and after it', () => {
    expect(isSubmissionOpen(CLOSES, CLOSES)).toBe(false);
    expect(isSubmissionOpen(CLOSES + 1, CLOSES)).toBe(false);
    expect(isSubmissionOpen(CLOSES + 3_600_000, CLOSES)).toBe(false);
  });

  it('is independent of any client clock, because it only takes server instants', () => {
    // The client countdown may show 1 second left while the server already rejects.
    expect(isSubmissionOpen(CLOSES, CLOSES)).toBe(false);
    expect(secondsRemaining(CLOSES - 1, CLOSES)).toBe(1);
  });
});

describe('isFinalizable: a grace period after the deadline (§4.5)', () => {
  it('is not finalizable before the deadline plus the grace', () => {
    expect(isFinalizable(CLOSES - 1, CLOSES, 250)).toBe(false);
    expect(isFinalizable(CLOSES, CLOSES, 250)).toBe(false);
    expect(isFinalizable(CLOSES + 249, CLOSES, 250)).toBe(false);
  });

  it('is finalizable from deadline + grace onwards', () => {
    expect(isFinalizable(CLOSES + 250, CLOSES, 250)).toBe(true);
    expect(isFinalizable(CLOSES + 10_000, CLOSES, 250)).toBe(true);
  });

  it('a zero grace means finalizable at the deadline itself', () => {
    expect(isFinalizable(CLOSES, CLOSES, 0)).toBe(true);
    expect(isFinalizable(CLOSES - 1, CLOSES, 0)).toBe(false);
  });

  it('leaves a window where no write is accepted and nothing has finalized yet', () => {
    const between = CLOSES + 100;
    expect(isSubmissionOpen(between, CLOSES)).toBe(false);
    expect(isFinalizable(between, CLOSES, 250)).toBe(false);
  });
});

describe('effectiveRoundState: closing is lazy (§4.5)', () => {
  it('stays active until the deadline', () => {
    expect(effectiveRoundState('question_active', CLOSES - 1, CLOSES)).toBe('question_active');
  });

  it('is already closing at the deadline even if no worker has written that yet', () => {
    expect(effectiveRoundState('question_active', CLOSES, CLOSES)).toBe('question_closing');
    expect(effectiveRoundState('question_active', CLOSES + 99_999, CLOSES)).toBe('question_closing');
  });

  it('never moves a stored closing or revealed round', () => {
    expect(effectiveRoundState('question_closing', SERVED, CLOSES)).toBe('question_closing');
    expect(effectiveRoundState('reveal', SERVED, CLOSES)).toBe('reveal');
    expect(effectiveRoundState('reveal', CLOSES + 1, CLOSES)).toBe('reveal');
  });

  it('cannot reopen a closed round by refreshing: the answer depends only on stored state and time', () => {
    for (const now of [CLOSES, CLOSES + 1, CLOSES + 1_000_000]) {
      expect(effectiveRoundState('question_active', now, CLOSES)).not.toBe('question_active');
    }
  });
});

describe('secondsRemaining (display only)', () => {
  it('counts down and never goes negative', () => {
    expect(secondsRemaining(SERVED, CLOSES)).toBe(60);
    expect(secondsRemaining(SERVED + 1, CLOSES)).toBe(60); // rounds up
    expect(secondsRemaining(SERVED + 1_000, CLOSES)).toBe(59);
    expect(secondsRemaining(CLOSES - 1, CLOSES)).toBe(1);
    expect(secondsRemaining(CLOSES, CLOSES)).toBe(0);
    expect(secondsRemaining(CLOSES + 5_000, CLOSES)).toBe(0);
  });
});
