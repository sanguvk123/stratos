import { describe, expect, it } from 'vitest';
import { WORKING_SCORING_CONFIG } from '@/server/config';
import { zipf, toPriorPpm } from '@/domain/scoring/calibration/distributions';
import { averageRanks, rankCorrelation, simulateOrderEffect } from '@/domain/scoring/calibration/order';

describe('averageRanks', () => {
  it('ranks ascending from 1 and gives ties the mean of the ranks they span', () => {
    expect(averageRanks([10, 20, 30])).toEqual([1, 2, 3]);
    expect(averageRanks([5, 5, 9])).toEqual([1.5, 1.5, 3]);
    expect(averageRanks([7, 7, 7, 7])).toEqual([2.5, 2.5, 2.5, 2.5]);
    expect(averageRanks([])).toEqual([]);
  });
});

describe('rankCorrelation', () => {
  it('is 1 for the same order, -1 for the reverse, and ignores the scale', () => {
    expect(rankCorrelation([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(rankCorrelation([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
  });

  it('handles ties and constant lists without dividing by zero', () => {
    expect(rankCorrelation([1, 1, 1], [5, 5, 5])).toBe(1);
    expect(rankCorrelation([1, 1, 1], [1, 2, 3])).toBe(0);
    expect(rankCorrelation([1], [2])).toBe(1);
  });

  it('rejects lists of different lengths', () => {
    expect(() => rankCorrelation([1, 2], [1])).toThrow(RangeError);
  });
});

describe('simulateOrderEffect', () => {
  const truth = zipf(300, 1).probs;
  const priors = toPriorPpm(truth);
  const run = (players: number, seed = 7) =>
    simulateOrderEffect(truth, priors, players, 7, 4, WORKING_SCORING_CONFIG, seed);

  it('is deterministic for a seed and changes with the seed', () => {
    expect(run(200)).toEqual(run(200));
    expect(run(200, 8)).not.toEqual(run(200));
  });

  it('reports values in range', () => {
    const e = run(300);
    expect(e.rankCorrelation).toBeGreaterThan(-1);
    expect(e.rankCorrelation).toBeLessThanOrEqual(1);
    expect(e.topDecileOverlap).toBeGreaterThan(0);
    expect(e.topDecileOverlap).toBeLessThanOrEqual(1);
    expect(e.sameTierShare).toBeGreaterThan(0);
    expect(e.sameTierShare).toBeLessThanOrEqual(1);
    expect(e.meanTotal).toBeGreaterThan(0);
    expect(e.meanAbsTotalDifference).toBeGreaterThanOrEqual(0);
  });

  it('shows that arrival order does matter (it is not exactly 1), but leaves most of the ranking intact', () => {
    const e = run(500);
    expect(e.rankCorrelation).toBeLessThan(1);
    expect(e.rankCorrelation).toBeGreaterThan(0.5);
  });

  it('rejects impossible inputs', () => {
    expect(() => simulateOrderEffect(truth, priors, 1, 7, 1, WORKING_SCORING_CONFIG, 1)).toThrow(RangeError);
    expect(() => simulateOrderEffect(truth, priors, 10, 0, 1, WORKING_SCORING_CONFIG, 1)).toThrow(RangeError);
    expect(() => simulateOrderEffect(truth, priors, 10, 7, 0, WORKING_SCORING_CONFIG, 1)).toThrow(RangeError);
  });
});
