import { describe, expect, it } from 'vitest';
import { computePopularity, ScoringInputError } from '@/domain/scoring';

describe('computePopularity (§7.9)', () => {
  it('is suppressed below the minimum sample, whatever the matches', () => {
    expect(computePopularity(5, 29, 30)).toEqual({ kind: 'suppressed' });
    expect(computePopularity(0, 29, 30)).toEqual({ kind: 'suppressed' });
    expect(computePopularity(0, 0, 30)).toEqual({ kind: 'suppressed' });
  });

  it('is shown once N_prior reaches the minimum', () => {
    expect(computePopularity(15, 30, 30)).toEqual({ kind: 'shown', percentOfEarlierAnswers: 50 });
  });

  it('says none matched when C_prior is 0, never "0%" or "under 1%"', () => {
    expect(computePopularity(0, 30, 30)).toEqual({ kind: 'none_earlier' });
    expect(computePopularity(0, 5_000, 30)).toEqual({ kind: 'none_earlier' });
  });

  it('does not give the first player 100%: the player is excluded from both terms', () => {
    // With minSample 0 and an empty cohort there is nothing to compare against.
    expect(computePopularity(0, 0, 0)).toEqual({ kind: 'none_earlier' });
  });

  it('rounds half up in integer arithmetic', () => {
    expect(computePopularity(1, 8, 0)).toEqual({ kind: 'shown', percentOfEarlierAnswers: 13 }); // 12.5
    expect(computePopularity(1, 200, 0)).toEqual({ kind: 'shown', percentOfEarlierAnswers: 1 }); // 0.5
    expect(computePopularity(50, 100, 0)).toEqual({ kind: 'shown', percentOfEarlierAnswers: 50 });
    expect(computePopularity(1, 3, 0)).toEqual({ kind: 'shown', percentOfEarlierAnswers: 33 }); // 33.3
    expect(computePopularity(2, 3, 0)).toEqual({ kind: 'shown', percentOfEarlierAnswers: 67 }); // 66.7
  });

  it('reports "under 1%" only when matches exist but round to zero', () => {
    expect(computePopularity(1, 201, 30)).toEqual({ kind: 'under_one_percent' }); // 0.4975%
    expect(computePopularity(1, 10_000, 30)).toEqual({ kind: 'under_one_percent' });
  });

  it('reports 100 only when every earlier answer matched', () => {
    expect(computePopularity(40, 40, 30)).toEqual({ kind: 'shown', percentOfEarlierAnswers: 100 });
    expect(computePopularity(399, 400, 30)).toEqual({ kind: 'shown', percentOfEarlierAnswers: 100 }); // 99.75
  });

  it('never returns a shown percent outside 1..100', () => {
    for (let n = 30; n <= 400; n += 7) {
      for (let c = 0; c <= n; c += 3) {
        const stat = computePopularity(c, n, 30);
        if (stat.kind === 'shown') {
          expect(stat.percentOfEarlierAnswers).toBeGreaterThanOrEqual(1);
          expect(stat.percentOfEarlierAnswers).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('rejects impossible or malformed counts', () => {
    expect(() => computePopularity(11, 10, 0)).toThrow(ScoringInputError);
    expect(() => computePopularity(-1, 10, 0)).toThrow(ScoringInputError);
    expect(() => computePopularity(1, 10.5, 0)).toThrow(ScoringInputError);
    expect(() => computePopularity(1, 10, -1)).toThrow(ScoringInputError);
  });
});
