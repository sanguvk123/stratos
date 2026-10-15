import { describe, expect, it } from 'vitest';
import {
  ALLOWED_QUESTION_POINTS,
  MAX_DIVE_POINTS,
  ScoringInputError,
  summarizeDive,
  TIER_POINTS,
  toDepthMetres,
} from '@/domain/scoring';

describe('toDepthMetres (§7.7)', () => {
  it('is points multiplied by 10', () => {
    expect(toDepthMetres(0)).toBe(0);
    expect(toDepthMetres(10)).toBe(100);
    expect(toDepthMetres(100)).toBe(1_000);
    expect(toDepthMetres(700)).toBe(7_000);
  });

  it('rejects negative or fractional points', () => {
    expect(() => toDepthMetres(-1)).toThrow(ScoringInputError);
    expect(() => toDepthMetres(1.5)).toThrow(ScoringInputError);
  });
});

describe('summarizeDive (§7.12 invariant 3)', () => {
  it('sums the seven question scores and derives depth from the total', () => {
    const summary = summarizeDive([10, 15, 30, 60, 85, 100, 0]);
    expect(summary).toEqual({ totalPoints: 300, depthM: 3_000 });
  });

  it('caps a perfect dive at 700 points and 7,000 metres', () => {
    const summary = summarizeDive(Array(7).fill(TIER_POINTS[6]));
    expect(summary.totalPoints).toBe(MAX_DIVE_POINTS);
    expect(summary.totalPoints).toBe(700);
    expect(summary.depthM).toBe(7_000);
  });

  it('handles a dive with no answers and a partial dive', () => {
    expect(summarizeDive([])).toEqual({ totalPoints: 0, depthM: 0 });
    expect(summarizeDive([0, 0, 0, 0, 0, 0, 0])).toEqual({ totalPoints: 0, depthM: 0 });
    expect(summarizeDive([60, 60])).toEqual({ totalPoints: 120, depthM: 1_200 });
  });

  it('rejects a score that is not one of 0 or the six tier values', () => {
    expect(() => summarizeDive([10, 20])).toThrow(ScoringInputError);
    expect(() => summarizeDive([101])).toThrow(ScoringInputError);
    expect([...ALLOWED_QUESTION_POINTS].sort((a, b) => a - b)).toEqual([0, 10, 15, 30, 60, 85, 100]);
  });

  it('rejects more than seven questions', () => {
    expect(() => summarizeDive(Array(8).fill(10))).toThrow(ScoringInputError);
  });
});
