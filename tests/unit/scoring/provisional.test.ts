import { describe, expect, it } from 'vitest';
import {
  INITIAL_DISPLAY_STATE,
  onEvaluation,
  onNewCandidate,
  ScoringInputError,
  type DisplayState,
  type TierId,
} from '@/domain/scoring';

function run(initial: DisplayState, tiers: TierId[], hold: number): TierId[] {
  const displayed: TierId[] = [];
  let state = initial;
  for (const tier of tiers) {
    state = onEvaluation(state, tier, hold);
    if (state.displayedTier !== null) displayed.push(state.displayedTier);
  }
  return displayed;
}

describe('provisional display hysteresis (§7.8)', () => {
  it('shows a new candidate immediately', () => {
    expect(onNewCandidate(4)).toEqual({ displayedTier: 4, pendingTier: null, pendingCount: 0 });
  });

  it('takes the first raw tier when nothing is displayed yet', () => {
    expect(onEvaluation(INITIAL_DISPLAY_STATE, 3, 2).displayedTier).toBe(3);
  });

  it('holds the displayed tier until the new tier persists for the hold count', () => {
    // hold = 2: one blip to tier 5 is ignored, the second consecutive one moves the display.
    expect(run(onNewCandidate(4), [5, 5], 2)).toEqual([4, 5]);
    expect(run(onNewCandidate(4), [5, 4, 5, 4], 2)).toEqual([4, 4, 4, 4]);
  });

  it('restarts the count when the pending tier changes', () => {
    expect(run(onNewCandidate(4), [5, 6, 5, 6], 2)).toEqual([4, 4, 4, 4]);
    expect(run(onNewCandidate(4), [5, 6, 6], 2)).toEqual([4, 4, 6]);
  });

  it('clears a pending change when the raw tier returns to the displayed one', () => {
    const afterBlip = onEvaluation(onNewCandidate(4), 5, 2);
    expect(afterBlip.pendingTier).toBe(5);
    const recovered = onEvaluation(afterBlip, 4, 2);
    expect(recovered).toEqual({ displayedTier: 4, pendingTier: null, pendingCount: 0 });
  });

  it('with a hold of 1 follows every change immediately', () => {
    expect(run(onNewCandidate(4), [5, 3, 6], 1)).toEqual([5, 3, 6]);
  });

  it('with a larger hold needs that many consecutive evaluations', () => {
    expect(run(onNewCandidate(2), [3, 3, 3], 3)).toEqual([2, 2, 3]);
  });

  it('is deterministic: the same sequence always gives the same display', () => {
    const sequence: TierId[] = [4, 5, 5, 4, 3, 3, 3, 6, 5, 5];
    expect(run(onNewCandidate(4), sequence, 2)).toEqual(run(onNewCandidate(4), sequence, 2));
  });

  it('rejects a non-positive hold count', () => {
    expect(() => onEvaluation(onNewCandidate(4), 5, 0)).toThrow(ScoringInputError);
  });
});
